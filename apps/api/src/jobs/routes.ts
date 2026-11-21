import { CreateJobRequestSchema, IDEMPOTENCY_KEY_HEADER, type CreateJobRequest, type JobResponse } from "@waypoint/contracts";
import { quoteCredits } from "@waypoint/pricing";
import { decideRoute, type Tier } from "@waypoint/router";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import { ConfigError, loadConfig, type LoadedConfig } from "../config/load.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure, InsufficientCredits } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { HOLD_MARGIN_MS, readTaskBody, utf8Bytes } from "../tasks/instant.ts";
import { deleteJobInput, putJobInput, type JobInput } from "./input.ts";
import { cancelJob, jobDeps, jobIdFor, jobView, jobWalletIds, loadJob } from "./job.ts";
import { JOB_RETENTION, jobTimeLimitMs, WHISPER_MODEL, type JobRunInput, type JobWorkflows } from "./start.ts";

type JobRoute = { tier: Tier; model: string; retention: "standard" | "zero" };

// Seconds to wait after JOB_STARTS says no (its period is 60 s, wrangler.jsonc).
export const JOB_STARTS_RETRY_AFTER = 60;

// The route is picked before anything is held or run. Jobs have a fixed tier per type (routes.fixed); retranscribe
// always uses Whisper, which is not confirmed zero-retention. null: the user has zero retention on and no route fits.
// How many starts one key may make when earlier ones failed before their row was written (each takes a fresh hold id).
export const MAX_START_ATTEMPTS = 5;

export function jobRoute(config: LoadedConfig, type: CreateJobRequest["type"], zeroRetention: boolean): JobRoute | null {
  if (type === "retranscribe") return zeroRetention ? null : { tier: "light", model: WHISPER_MODEL, retention: "standard" };
  const decision = decideRoute({ task: type, zeroRetention, routes: config.routes, minConfidence: config.router.min_confidence });
  return decision.ok ? { tier: decision.tier, model: decision.model, retention: decision.retention } : null;
}

function jobInput(request: CreateJobRequest): JobInput | null {
  if (request.type === "retranscribe") return null;
  if (request.type === "research") return { text: request.text ?? "", prompt: request.question };
  return { text: request.text, prompt: request.prompt ?? null };
}

export function jobsRoutes(deps: { now: () => number; workflows: JobWorkflows }) {
  return new Hono<AppEnv>()
    .post("/v1/jobs", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const user = c.get("user");
      // At most 30 new jobs a minute per person (open question 29). A job cancelled before it settles costs nothing,
      // so this bounds how often a modified client can run the models for free.
      const starts = await c.env.JOB_STARTS.limit({ key: user.id });
      if (!starts.success) throw new ApiFailure("rate_limited", "too many jobs", JOB_STARTS_RETRY_AFTER);
      const device = c.get("device");
      const key = c.req.header(IDEMPOTENCY_KEY_HEADER) ?? "";
      const request = await readTaskBody(c, CreateJobRequestSchema);
      const config = await loadConfig(c.env.CONFIG).catch((err: unknown) => {
        if (err instanceof ConfigError) throw new ApiFailure("internal", "config unavailable");
        throw err;
      });
      const workflow = deps.workflows(c.env, request.type);
      if (workflow === null) throw new ApiFailure("bad_request", "job type not available");
      const route = jobRoute(config, request.type, user.zero_retention);
      if (route === null) throw new ApiFailure("forbidden", "no zero-retention route for this task");
      // The cloud fallback voice has a price but no Workflow yet (open question 36): nothing may be charged for it.
      if ((request.type === "overview_script" || request.type === "video_slides") && request.fallback_voice === true) {
        throw new ApiFailure("bad_request", "fallback voice not available");
      }
      const credits = quoteCredits(config.prices, {
        task: request.type,
        depth: request.type === "research" ? request.depth : undefined,
        minutes: request.type === "retranscribe" ? request.minutes : undefined,
        fallback_voice: request.type === "overview_script" || request.type === "video_slides" ? request.fallback_voice : undefined,
      });

      const db = c.env.DB;
      const now = deps.now();
      const id = await jobIdFor(user.id, key);
      // The same request run again (its stored reply was lost) finds the job it made.
      const existing = await loadJob(db, id, user.id);
      if (existing !== null) return c.json({ job: jobView(existing, now) } satisfies JobResponse, 201);

      const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
      const depth = request.type === "research" ? request.depth : null;
      const minutes = request.type === "retranscribe" ? request.minutes : null;
      const deadline = now + jobTimeLimitMs({ type: request.type, depth, minutes });
      // A start that failed before its row was written released its hold, and a released hold never opens again under
      // the same id. Then no job exists for this key, so the start is new: it holds under the next id in the series.
      // command_key keeps the key the hold was made under, so cancel releases the right one.
      let walletKey = key;
      let ids = jobWalletIds(user.id, walletKey);
      for (let attempt = 1; ; attempt++) {
        const held = await wallet.apply({
          type: "hold",
          id: ids.hold,
          hold_id: ids.hold,
          user_id: user.id,
          task: request.type,
          credits,
          expires_at: deadline + HOLD_MARGIN_MS,
        });
        if (held.ok) break;
        if ("shortfall" in held) throw new InsufficientCredits(held.shortfall);
        if (held.reason === "hold_in_progress") throw new ApiFailure("conflict", "request in progress", 1);
        if (held.reason !== "hold_closed") throw new ApiFailure("internal", "something went wrong");
        // Closed: the job exists (the same request run again, its reply lost) or an earlier start failed and left no row.
        const made = await loadJob(db, id, user.id);
        if (made !== null) return c.json({ job: jobView(made, now) } satisfies JobResponse, 201);
        if (attempt >= MAX_START_ATTEMPTS) throw new ApiFailure("internal", "job could not start");
        walletKey = `${key}:${attempt}`;
        ids = jobWalletIds(user.id, walletKey);
      }

      const input = jobInput(request);
      const bytesSent = input === null ? 0 : utf8Bytes(input.text, input.prompt ?? "");
      try {
        const inputKey = input === null ? null : await putJobInput(c.env.BUCKET, id, input);
        await db
          .prepare(
            "INSERT INTO jobs (id, user_id, type, state, quoted, route, model, retention, bytes_sent, command_key, device_id, created_at, deadline_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(id, user.id, request.type, credits, route.tier, route.model, route.retention, bytesSent, walletKey, device.id, now, deadline)
          .run();
        const params: JobRunInput = {
          v: 1,
          job_id: id,
          type: request.type,
          user_id: user.id,
          billing_account_id: user.billing_account_id,
          credits,
          hold_id: ids.hold,
          settle_id: ids.settle,
          release_id: ids.release,
          deadline,
          tier: route.tier,
          model: route.model,
          retention: route.retention,
          zero_retention: user.zero_retention,
          depth,
          minutes,
          input_key: inputKey,
          bytes_sent: bytesSent,
        };
        await workflow.create({ id, params, retention: JOB_RETENTION });
      } catch {
        // Nothing ran: release the hold, delete the locked input, and mark the row failed if it was written.
        await wallet.apply({ type: "release", id: ids.release, hold_id: ids.hold }).catch(() => undefined);
        await deleteJobInput(c.env.BUCKET, id).catch(() => undefined);
        await db
          .prepare("UPDATE jobs SET state = 'failed', spent = 0, finished_at = ? WHERE id = ?")
          .bind(now, id)
          .run()
          .catch(() => undefined);
        throw new ApiFailure("internal", "job could not start");
      }
      const job = await loadJob(db, id, user.id);
      if (job === null) throw new ApiFailure("internal", "something went wrong");
      return c.json({ job: jobView(job, now) } satisfies JobResponse, 201);
    })
    .get("/v1/jobs/:id", async (c) => {
      const job = await loadJob(c.env.DB, c.req.param("id"), c.get("user").id);
      if (job === null) throw new ApiFailure("not_found", "no such job");
      return c.json({ job: jobView(job, deps.now()) } satisfies JobResponse);
    })
    .get("/v1/jobs/:id/result", requireDeviceSignature(deps), async (c) => {
      const job = await loadJob(c.env.DB, c.req.param("id"), c.get("user").id);
      // Only the device the result is sealed to may fetch it; anyone else learns nothing.
      if (job === null || job.state !== "succeeded" || job.result_key === null || job.device_id !== c.get("device").id) {
        throw new ApiFailure("not_found", "no such result");
      }
      const object = await c.env.BUCKET.get(job.result_key);
      if (object === null) throw new ApiFailure("not_found", "no such result");
      return new Response(object.body, {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(object.size), "Cache-Control": "no-store" },
      });
    })
    .delete("/v1/jobs/:id", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const user = c.get("user");
      const job = await loadJob(c.env.DB, c.req.param("id"), user.id);
      if (job === null) throw new ApiFailure("not_found", "no such job");
      const workflow = deps.workflows(c.env, job.type);
      await cancelJob(jobDeps(c.env, job.billing_account_id, deps.now), job, async () => {
        if (workflow !== null) await (await workflow.get(job.id)).terminate();
      });
      const after = await loadJob(c.env.DB, job.id, user.id);
      if (after === null) throw new ApiFailure("not_found", "no such job");
      return c.json({ job: jobView(after, deps.now()) } satisfies JobResponse);
    });
}
