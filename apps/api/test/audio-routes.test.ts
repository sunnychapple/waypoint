import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { audioRoutes } from "../src/jobs/audio-routes.ts";
import { insertJob, JOB_NOW, makeJobsWorld, memoryBucket } from "./helpers/jobs.ts";

const U1: SessionUser = { id: "u1", clerk_id: "clerk_u1", plan: "free", billing_account_id: "ba_u1", zero_retention: false };
const U2: SessionUser = { id: "u2", clerk_id: "clerk_u2", plan: "free", billing_account_id: "ba_u2", zero_retention: false };

// A world with u1's queued retranscribe job job_1, an overview_script job job_2 and u2's retranscribe job job_3.
async function setup(user: SessionUser = U1) {
  const w = await makeJobsWorld();
  await insertJob(w, { id: "job_1", type: "retranscribe" });
  await insertJob(w, { id: "job_2", type: "overview_script" });
  await w.db
    .prepare(
      "INSERT INTO jobs (id, user_id, type, state, quoted, route, model, retention, bytes_sent, command_key, device_id, created_at, deadline_at) VALUES ('job_3', 'u2', 'retranscribe', 'queued', 40, 'strong', 'm', 'standard', 0, 'key-job-3-0123456789', NULL, ?, ?)",
    )
    .bind(JOB_NOW, JOB_NOW + 600_000)
    .run();
  const { bucket, objects } = memoryBucket();
  const sent: { id: string; event: unknown }[] = [];
  const env = {
    DB: w.db,
    BUCKET: bucket,
    RETRANSCRIBE_WORKFLOW: {
      get: async (id: string) => ({ sendEvent: async (event: unknown) => void sent.push({ id, event }) }),
    },
  };
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", audioRoutes({ now: () => JOB_NOW }));
  return { app, env, bucket, objects, sent, db: w.db };
}

const KEY = "key-audio-0123456789";

function put(app: Hono<AppEnv>, env: object, path: string, options: { type?: string; length?: string; body?: Uint8Array } = {}) {
  return app.request(
    path,
    {
      method: "PUT",
      headers: {
        "Content-Type": options.type ?? "audio/mp4",
        "Content-Length": options.length ?? String(options.body?.length ?? 0),
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: options.body ?? new Uint8Array(),
    },
    env,
  );
}

function done(app: Hono<AppEnv>, env: object, path: string, body: unknown, key: string = KEY) {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("audio routes", () => {
  test("PUT stores a part in R2 with its bytes and content type and answers with its size", async () => {
    const s = await setup();
    const res = await put(s.app, s.env, "/v1/jobs/job_1/audio/0", { body: new Uint8Array([9, 8, 7]) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ chunk: 0, bytes: 3 });
    expect(s.objects.get("tmp/audio/job_1/0")).toEqual({ value: new Uint8Array([9, 8, 7]), contentType: "audio/mp4" });
  });

  test("PUT with a chunk number of 200 or x is 400 and stores nothing", async () => {
    const s = await setup();
    expect((await put(s.app, s.env, "/v1/jobs/job_1/audio/200", { body: new Uint8Array([1]) })).status).toBe(400);
    expect((await put(s.app, s.env, "/v1/jobs/job_1/audio/x", { body: new Uint8Array([1]) })).status).toBe(400);
    expect(s.objects.size).toBe(0);
  });

  test("PUT with Content-Type audio/wav is 400", async () => {
    const s = await setup();
    const res = await put(s.app, s.env, "/v1/jobs/job_1/audio/0", { type: "audio/wav", body: new Uint8Array([1]) });
    expect(res.status).toBe(400);
  });

  test("PUT with Content-Length 0 or 4194305 is 400 and stores nothing", async () => {
    const s = await setup();
    expect((await put(s.app, s.env, "/v1/jobs/job_1/audio/0", { length: "0" })).status).toBe(400);
    expect((await put(s.app, s.env, "/v1/jobs/job_1/audio/0", { length: "4194305", body: new Uint8Array([1]) })).status).toBe(400);
    expect(s.objects.size).toBe(0);
  });

  test("PUT to another user's job, to an overview_script job and to an unknown job is 404", async () => {
    const s = await setup();
    expect((await put(s.app, s.env, "/v1/jobs/job_3/audio/0", { body: new Uint8Array([1]) })).status).toBe(404);
    expect((await put(s.app, s.env, "/v1/jobs/job_2/audio/0", { body: new Uint8Array([1]) })).status).toBe(404);
    expect((await put(s.app, s.env, "/v1/jobs/job_missing/audio/0", { body: new Uint8Array([1]) })).status).toBe(404);
    expect(s.objects.size).toBe(0);
  });

  test("PUT after the job has started running is 409 'upload closed'", async () => {
    const s = await setup();
    await s.db.prepare("UPDATE jobs SET state = 'running' WHERE id = 'job_1'").run();
    const res = await put(s.app, s.env, "/v1/jobs/job_1/audio/0", { body: new Uint8Array([1]) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "conflict", message: "upload closed" });
  });

  test("POST done with parts 0 and 1 stored is 202 with the totals, and sends one audio_uploaded event", async () => {
    const s = await setup();
    await put(s.app, s.env, "/v1/jobs/job_1/audio/0", { body: new Uint8Array([1, 2, 3]) });
    await put(s.app, s.env, "/v1/jobs/job_1/audio/1", { body: new Uint8Array([4, 5]) });
    const res = await done(s.app, s.env, "/v1/jobs/job_1/audio/done", { chunks: 2 });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ chunks: 2, bytes: 5 });
    expect(s.sent).toEqual([{ id: "job_1", event: { type: "audio_uploaded", payload: { chunks: 2, bytes: 5 } } }]);
  });

  test("POST done with part 1 missing is 400 'chunk 1 missing' and sends no event", async () => {
    const s = await setup();
    await put(s.app, s.env, "/v1/jobs/job_1/audio/0", { body: new Uint8Array([1]) });
    const res = await done(s.app, s.env, "/v1/jobs/job_1/audio/done", { chunks: 2 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad_request", message: "chunk 1 missing" });
    expect(s.sent).toEqual([]);
  });

  test("POST done with chunks: 0 is 400 and sends no event", async () => {
    const s = await setup();
    const res = await done(s.app, s.env, "/v1/jobs/job_1/audio/done", { chunks: 0 });
    expect(res.status).toBe(400);
    expect(s.sent).toEqual([]);
  });

  test("POST done sent twice with the same Idempotency-Key gives the same 202 and sends one event", async () => {
    const s = await setup();
    await put(s.app, s.env, "/v1/jobs/job_1/audio/0", { body: new Uint8Array([1, 2, 3]) });
    const first = await done(s.app, s.env, "/v1/jobs/job_1/audio/done", { chunks: 1 }, "key-done-0123456789");
    const second = await done(s.app, s.env, "/v1/jobs/job_1/audio/done", { chunks: 1 }, "key-done-0123456789");
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual(await first.json());
    expect(s.sent).toHaveLength(1);
  });

  test("POST done on a running job is 409 and sends no event", async () => {
    const s = await setup();
    await put(s.app, s.env, "/v1/jobs/job_1/audio/0", { body: new Uint8Array([1]) });
    await s.db.prepare("UPDATE jobs SET state = 'running' WHERE id = 'job_1'").run();
    const res = await done(s.app, s.env, "/v1/jobs/job_1/audio/done", { chunks: 1 });
    expect(res.status).toBe(409);
    expect(s.sent).toEqual([]);
  });
});
