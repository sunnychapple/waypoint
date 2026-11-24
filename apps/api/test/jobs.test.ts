import { InsufficientCreditsErrorSchema, JobResponseSchema, type ApiError } from "@waypoint/contracts";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { readJobInput } from "../src/jobs/input.ts";
import { jobIdFor } from "../src/jobs/job.ts";
import { jobsRoutes } from "../src/jobs/routes.ts";
import { JOB_RETENTION, WHISPER_MODEL, type JobRunInput, type JobWorkflows } from "../src/jobs/start.ts";
import { HOLD_MARGIN_MS } from "../src/tasks/instant.ts";
import { insertJob, JOB_NOW, makeJobsWorld } from "./helpers/jobs.ts";
import { signedInit, type TestDevice } from "./helpers/signing.ts";

type World = Awaited<ReturnType<typeof makeJobsWorld>>;

const KEY = "key-create-0123456789";
const PATH = "/v1/jobs";
const U1: SessionUser = { id: "u1", clerk_id: "clerk_u1", plan: "free", billing_account_id: "ba_u1", zero_retention: false };
const U2: SessionUser = { id: "u2", clerk_id: "clerk_u2", plan: "free", billing_account_id: "ba_u2", zero_retention: false };
const MINUTE = 60_000;
const resultPath = (id: string) => `/v1/jobs/${id}/result`;

const utf8 = (text: string): number => new TextEncoder().encode(text).byteLength;

function appFor(user: SessionUser, w: World, workflows: JobWorkflows = () => w.workflow): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", jobsRoutes({ now: () => w.clock.now, workflows }));
  return app;
}

// Records the retention each Workflow create was given, then calls the fake.
function recordRetention(w: World): unknown[] {
  const seen: unknown[] = [];
  const create = w.workflow.create;
  w.workflow.create = async (options) => {
    seen.push(options.retention);
    return create(options);
  };
  return seen;
}

async function post(
  w: World,
  app: Hono<AppEnv>,
  body: unknown,
  options: { device?: TestDevice; key?: string; env?: World["env"] } = {},
): Promise<Response> {
  const init = await signedInit(options.device ?? w.phone, { method: "POST", path: PATH, body, now: w.clock.now, idempotencyKey: options.key ?? KEY });
  return app.request(PATH, init, options.env ?? w.env);
}

async function postJob(w: World, body: unknown, key: string = KEY): Promise<Response> {
  return post(w, appFor(U1, w), body, { key });
}

async function jobRow(w: World, id: string): Promise<Record<string, unknown> | null> {
  return w.db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<Record<string, unknown>>();
}

function holdCommands(w: World) {
  return w.commands.filter((command) => command.type === "hold");
}

async function errorOf(res: Response): Promise<ApiError> {
  return (await res.json()) as ApiError;
}

const OVERVIEW = { type: "overview_script", text: "Photosynthesis turns light into sugar. MARKER-plant-text" } as const;

describe("POST /v1/jobs", () => {
  test("overview_script gives 201 with a queued job that passes JobResponseSchema", async () => {
    const w = await makeJobsWorld();
    const res = await postJob(w, OVERVIEW);
    expect(res.status).toBe(201);
    const body = JobResponseSchema.parse(await res.json());
    expect(body.job.state).toBe("queued");
    expect(body.job.quoted).toBe(40);
    expect(body.job.tier).toBe("strong");
    expect(body.job.result_ready).toBe(false);
    expect(body.job.id).toBe(await jobIdFor("u1", KEY));
  });

  test("overview_script creates one Workflow with the job id, JOB_RETENTION and the full JobRunInput", async () => {
    const w = await makeJobsWorld();
    const retention = recordRetention(w);
    await postJob(w, OVERVIEW);
    const id = await jobIdFor("u1", KEY);
    expect(w.workflow.created).toHaveLength(1);
    const created = w.workflow.created[0]!;
    expect(created.id).toBe(id);
    expect(retention).toEqual([JOB_RETENTION]);
    const params: JobRunInput = created.params;
    expect(params.input_key).toHaveLength(43);
    expect(params).toEqual({
      v: 1,
      job_id: id,
      type: "overview_script",
      user_id: "u1",
      billing_account_id: "ba_u1",
      credits: 40,
      hold_id: `job:u1:${KEY}`,
      settle_id: `job_settle:u1:${KEY}`,
      release_id: `job_release:u1:${KEY}`,
      deadline: JOB_NOW + 1_800_000,
      tier: "strong",
      model: "workers-ai/kimi-k2.6",
      retention: "standard",
      zero_retention: false,
      depth: null,
      minutes: null,
      input_key: params.input_key,
      bytes_sent: utf8(OVERVIEW.text),
    });
  });

  test("the Workflow params never contain the text sent", async () => {
    const w = await makeJobsWorld();
    await postJob(w, OVERVIEW);
    expect(JSON.stringify(w.workflow.created[0]!.params)).not.toContain("MARKER");
  });

  test("overview_script holds 40 credits with the job's hold id and expiry, leaving 60", async () => {
    const w = await makeJobsWorld();
    await postJob(w, OVERVIEW);
    expect(w.commands).toEqual([
      {
        type: "hold",
        id: `job:u1:${KEY}`,
        hold_id: `job:u1:${KEY}`,
        user_id: "u1",
        task: "overview_script",
        credits: 40,
        expires_at: JOB_NOW + 1_800_000 + HOLD_MARGIN_MS,
      },
    ]);
    expect(w.store.read().monthly).toBe(60);
  });

  test("the jobs row has the device, key, route, sizes and deadline the request made", async () => {
    const w = await makeJobsWorld();
    const id = await jobIdFor("u1", KEY);
    await postJob(w, OVERVIEW);
    const row = await jobRow(w, id);
    expect(row).toMatchObject({
      device_id: "dev_phone",
      command_key: KEY,
      model: "workers-ai/kimi-k2.6",
      retention: "standard",
      bytes_sent: utf8(OVERVIEW.text),
      deadline_at: JOB_NOW + 1_800_000,
      route: "strong",
    });
  });

  test("the input is stored encrypted in tmp/input and reads back with the params key", async () => {
    const w = await makeJobsWorld();
    await postJob(w, OVERVIEW);
    const id = await jobIdFor("u1", KEY);
    const stored = w.objects.get(`tmp/input/${id}`);
    expect(stored).toBeDefined();
    expect(new TextDecoder().decode(stored!.value)).not.toContain("MARKER");
    const key = w.workflow.created[0]!.params.input_key!;
    expect(await readJobInput(w.bucket, id, key)).toEqual({ text: OVERVIEW.text, prompt: null });
  });

  test("a prompt is stored with the text and counts in bytes_sent", async () => {
    const w = await makeJobsWorld();
    const prompt = "Focus on plants";
    await postJob(w, { ...OVERVIEW, prompt });
    const id = await jobIdFor("u1", KEY);
    const key = w.workflow.created[0]!.params.input_key!;
    expect(await readJobInput(w.bucket, id, key)).toEqual({ text: OVERVIEW.text, prompt });
    expect(w.workflow.created[0]!.params.bytes_sent).toBe(utf8(OVERVIEW.text) + utf8(prompt));
  });

  test("research deep with a question only quotes 125, has a 60-minute deadline and stores the question as prompt", async () => {
    const w = await makeJobsWorld({ monthly: 200 });
    const question = "How do bees find flowers?";
    const res = await postJob(w, { type: "research", depth: "deep", question });
    expect(res.status).toBe(201);
    expect(JobResponseSchema.parse(await res.json()).job.quoted).toBe(125);
    const params = w.workflow.created[0]!.params;
    expect(params.depth).toBe("deep");
    expect(params.deadline).toBe(JOB_NOW + 60 * MINUTE);
    expect(await readJobInput(w.bucket, await jobIdFor("u1", KEY), params.input_key!)).toEqual({ text: "", prompt: question });
  });

  test("research quick with text quotes 15", async () => {
    const w = await makeJobsWorld();
    const res = await postJob(w, { type: "research", depth: "quick", question: "Why?", text: "Some notes" });
    expect(JobResponseSchema.parse(await res.json()).job.quoted).toBe(15);
  });

  test("when JOB_STARTS says no: 429 with retry_after 60, keyed by the user id, and no hold, row or Workflow", async () => {
    const w = await makeJobsWorld();
    const keys: string[] = [];
    const limit = async (options: { key: string }) => {
      keys.push(options.key);
      return { success: false };
    };
    const env = { ...w.env, JOB_STARTS: { limit } };
    const res = await post(w, appFor(U1, w), OVERVIEW, { env });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await errorOf(res)).toEqual({ code: "rate_limited", message: "too many jobs", retry_after: 60 });
    expect(keys).toEqual(["u1"]);
    expect(holdCommands(w)).toHaveLength(0);
    expect(w.workflow.created).toHaveLength(0);
    expect(await w.db.prepare("SELECT count(*) AS n FROM jobs").first<{ n: number }>()).toEqual({ n: 0 });
  });

  test("fallback_voice true gives 400 with no hold, no row and no Workflow; false quotes 50 as without it", async () => {
    const w = await makeJobsWorld();
    for (const type of ["overview_script", "video_slides"] as const) {
      const res = await postJob(w, { type, text: "Slides text", fallback_voice: true }, `key-voice-${type}-0123`);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toEqual({ code: "bad_request", message: "fallback voice not available", retry_after: null });
    }
    expect(holdCommands(w)).toHaveLength(0);
    expect(w.workflow.created).toHaveLength(0);
    expect(await w.db.prepare("SELECT count(*) AS n FROM jobs").first<{ n: number }>()).toEqual({ n: 0 });
    const res = await postJob(w, { type: "video_slides", text: "Slides text", fallback_voice: false });
    expect(JobResponseSchema.parse(await res.json()).job.quoted).toBe(50);
  });

  test("diagram quotes 18", async () => {
    const w = await makeJobsWorld();
    const res = await postJob(w, { type: "diagram", text: "A cell" });
    expect(JobResponseSchema.parse(await res.json()).job.quoted).toBe(18);
  });

  test("mini_app quotes 40", async () => {
    const w = await makeJobsWorld();
    const res = await postJob(w, { type: "mini_app", text: "A quiz" });
    expect(JobResponseSchema.parse(await res.json()).job.quoted).toBe(40);
  });

  test("problem_help quotes 5 on standard with a 20-minute deadline, and stores the problem as prompt with the page text", async () => {
    const w = await makeJobsWorld();
    const body = { type: "problem_help", problem: "Find the missing value.", text: "Exercise 4. Find the missing value." };
    const res = await postJob(w, body);
    expect(res.status).toBe(201);
    const job = JobResponseSchema.parse(await res.json()).job;
    expect(job.quoted).toBe(5);
    expect(job.tier).toBe("standard");
    const params = w.workflow.created[0]!.params;
    expect(params.deadline).toBe(JOB_NOW + 20 * MINUTE);
    expect(params.bytes_sent).toBe(utf8(body.text) + utf8(body.problem));
    expect(await readJobInput(w.bucket, await jobIdFor("u1", KEY), params.input_key!)).toEqual({ text: body.text, prompt: body.problem });
    expect((await jobRow(w, await jobIdFor("u1", KEY)))!.type).toBe("problem_help");
  });

  test("practice quotes 8", async () => {
    const w = await makeJobsWorld();
    const res = await postJob(w, { type: "practice", text: "Fractions" });
    expect(JobResponseSchema.parse(await res.json()).job.quoted).toBe(8);
  });

  test("retranscribe with 4.2 minutes quotes 5 on Whisper with no stored input and a 5,450,000 ms deadline", async () => {
    const w = await makeJobsWorld();
    const id = await jobIdFor("u1", KEY);
    const res = await postJob(w, { type: "retranscribe", minutes: 4.2 });
    expect(res.status).toBe(201);
    const job = JobResponseSchema.parse(await res.json()).job;
    expect(job.quoted).toBe(5);
    expect(job.tier).toBe("light");
    expect((await jobRow(w, id))!.model).toBe(WHISPER_MODEL);
    expect(w.objects.has(`tmp/input/${id}`)).toBe(false);
    const params = w.workflow.created[0]!.params;
    expect(params.input_key).toBeNull();
    expect(params.minutes).toBe(4.2);
    expect(params.bytes_sent).toBe(0);
    expect(params.deadline).toBe(JOB_NOW + 5_450_000);
  });

  test("a request signed by the iPad records dev_ipad1 as the job's device", async () => {
    const w = await makeJobsWorld();
    await postJob(w, OVERVIEW, KEY);
    const res = await post(w, appFor(U1, w), OVERVIEW, { device: w.ipad, key: "key-ipad-0123456789" });
    expect(res.status).toBe(201);
    expect((await jobRow(w, await jobIdFor("u1", "key-ipad-0123456789")))!.device_id).toBe("dev_ipad1");
  });

  test("the same key and body again gives the stored 201 with Idempotent-Replayed, one create and one hold", async () => {
    const w = await makeJobsWorld();
    const first = await postJob(w, OVERVIEW);
    const firstBody = await first.text();
    const second = await post(w, appFor(U1, w), OVERVIEW, { key: KEY });
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await second.text()).toBe(firstBody);
    expect(w.workflow.created).toHaveLength(1);
    expect(holdCommands(w)).toHaveLength(1);
  });

  test("the same key after its idempotency row is deleted gives the same job, one create and one hold", async () => {
    const w = await makeJobsWorld();
    const first = JobResponseSchema.parse(await (await postJob(w, OVERVIEW)).json());
    await w.db.prepare("DELETE FROM idempotency").run();
    const again = await postJob(w, OVERVIEW);
    expect(again.status).toBe(201);
    expect(JobResponseSchema.parse(await again.json())).toEqual(first);
    expect(w.workflow.created).toHaveLength(1);
    expect(holdCommands(w)).toHaveLength(1);
  });

  test("with 10 monthly credits, overview_script gives 402 with shortfall 30 and writes nothing", async () => {
    const w = await makeJobsWorld({ monthly: 10 });
    const res = await postJob(w, OVERVIEW);
    expect(res.status).toBe(402);
    expect(InsufficientCreditsErrorSchema.parse(await res.json()).shortfall).toBe(30);
    expect(await jobRow(w, await jobIdFor("u1", KEY))).toBeNull();
    expect(w.workflow.created).toHaveLength(0);
    expect(w.objects.size).toBe(0);
  });

  test("after 100 credits are granted, the same key gives 201", async () => {
    const w = await makeJobsWorld({ monthly: 10 });
    await postJob(w, OVERVIEW);
    w.store.apply({ type: "grant", id: "grant-2", bucket: "monthly", credits: 100, ref: "test" }, JOB_NOW);
    expect((await postJob(w, OVERVIEW)).status).toBe(201);
  });

  test("a zero-retention user asking for diagram gives 403 with no wallet command", async () => {
    const w = await makeJobsWorld({ zeroRetention: true });
    const zero: SessionUser = { ...U1, zero_retention: true };
    const res = await post(w, appFor(zero, w), { type: "diagram", text: "A cell" });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toEqual({ code: "forbidden", message: "no zero-retention route for this task", retry_after: null });
    expect(w.commands).toHaveLength(0);
  });

  test("a zero-retention user asking for retranscribe gives 403", async () => {
    const w = await makeJobsWorld({ zeroRetention: true });
    const zero: SessionUser = { ...U1, zero_retention: true };
    const res = await post(w, appFor(zero, w), { type: "retranscribe", minutes: 2 });
    expect(res.status).toBe(403);
    expect(w.commands).toHaveLength(0);
  });

  test("a job type with no Workflow gives 400 job type not available and no wallet command", async () => {
    const w = await makeJobsWorld();
    const res = await post(w, appFor(U1, w, () => null), OVERVIEW);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toEqual({ code: "bad_request", message: "job type not available", retry_after: null });
    expect(w.commands).toHaveLength(0);
  });

  test("a request with no body gives 400 invalid request", async () => {
    const w = await makeJobsWorld();
    const init = await signedInit(w.phone, { method: "POST", path: PATH, now: w.clock.now, idempotencyKey: KEY });
    const res = await appFor(U1, w).request(PATH, init, w.env);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
  });

  test("a body whose type is unknown gives 400 invalid request", async () => {
    const w = await makeJobsWorld();
    const res = await postJob(w, { type: "nope", text: "MARKER" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
  });

  test("overview_script without text gives 400 invalid request", async () => {
    const w = await makeJobsWorld();
    const res = await postJob(w, { type: "overview_script" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
  });

  test("a body with an extra key gives 400 invalid request, and no reply contains the text sent", async () => {
    const w = await makeJobsWorld();
    const res = await postJob(w, { type: "diagram", text: "MARKER-diagram", extra: true });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("MARKER");
  });

  test("config:current missing gives 500 config unavailable", async () => {
    const w = await makeJobsWorld();
    const env = { ...w.env, CONFIG: { get: async () => null } };
    const res = await post(w, appFor(U1, w), OVERVIEW, { env });
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toEqual({ code: "internal", message: "config unavailable", retry_after: null });
  });

  test("a Workflow create that fails gives 500 job could not start, releases the hold and marks the row failed", async () => {
    const w = await makeJobsWorld();
    w.workflow.failCreate = true;
    const res = await postJob(w, OVERVIEW);
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toEqual({ code: "internal", message: "job could not start", retry_after: null });
    expect(w.store.read().monthly).toBe(100);
    const row = await jobRow(w, await jobIdFor("u1", KEY));
    expect(row).toMatchObject({ state: "failed", spent: 0, finished_at: JOB_NOW });
    expect(w.objects.size).toBe(0);
    expect(w.usage).toHaveLength(0);
  });

  test("an R2 put that fails gives 500 job could not start, keeps the balance and writes no row", async () => {
    const w = await makeJobsWorld();
    w.bucket.failPut = true;
    const res = await postJob(w, OVERVIEW);
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toEqual({ code: "internal", message: "job could not start", retry_after: null });
    expect(w.store.read().monthly).toBe(100);
    expect(await jobRow(w, await jobIdFor("u1", KEY))).toBeNull();
  });

  // A start that failed before its row was written: its hold was released, and no job exists for the key.
  function releasedStart(w: World, walletKey: string): void {
    const hold = `job:u1:${walletKey}`;
    w.store.apply({ type: "hold", id: hold, hold_id: hold, user_id: "u1", task: "overview_script", credits: 40, expires_at: JOB_NOW + 9_000_000 }, JOB_NOW);
    w.store.apply({ type: "release", id: `job_release:u1:${walletKey}`, hold_id: hold }, JOB_NOW);
  }

  test("a start that failed before its row was written runs as new under the next hold id, and its row keeps that id", async () => {
    const w = await makeJobsWorld();
    releasedStart(w, KEY);
    const res = await postJob(w, OVERVIEW);
    expect(res.status).toBe(201);
    expect(JobResponseSchema.parse(await res.json()).job.state).toBe("queued");
    const params: JobRunInput = w.workflow.created[0]!.params;
    expect(params).toMatchObject({
      hold_id: `job:u1:${KEY}:1`,
      settle_id: `job_settle:u1:${KEY}:1`,
      release_id: `job_release:u1:${KEY}:1`,
    });
    expect(holdCommands(w).at(-1)).toMatchObject({ id: `job:u1:${KEY}:1`, credits: 40 });
    expect(await jobRow(w, await jobIdFor("u1", KEY))).toMatchObject({ state: "queued", command_key: `${KEY}:1` });
  });

  test("an input upload that fails (no row written), then the same key again, starts the job", async () => {
    const w = await makeJobsWorld();
    w.bucket.failPut = true;
    expect((await postJob(w, OVERVIEW)).status).toBe(500);
    expect(await jobRow(w, await jobIdFor("u1", KEY))).toBeNull();
    w.bucket.failPut = false;
    const res = await postJob(w, OVERVIEW);
    expect(res.status).toBe(201);
    expect(JobResponseSchema.parse(await res.json()).job.state).toBe("queued");
    expect(w.workflow.created).toHaveLength(1);
    expect(w.workflow.created[0]!.params).toMatchObject({ hold_id: `job:u1:${KEY}:1` });
  });

  test("the same key again after a successful start returns that job, with no new hold", async () => {
    const w = await makeJobsWorld();
    await postJob(w, OVERVIEW);
    const holds = holdCommands(w).length;
    const res = await postJob(w, OVERVIEW);
    expect(res.status).toBe(201);
    expect(holdCommands(w)).toHaveLength(holds);
    expect(w.workflow.created).toHaveLength(1);
  });

  test("starts that failed under every id the key can take give 500 job could not start, with no row", async () => {
    const w = await makeJobsWorld();
    releasedStart(w, KEY);
    for (let n = 1; n <= 4; n++) releasedStart(w, `${KEY}:${n}`);
    const res = await postJob(w, OVERVIEW);
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toEqual({ code: "internal", message: "job could not start", retry_after: null });
    expect(await jobRow(w, await jobIdFor("u1", KEY))).toBeNull();
    expect(w.workflow.created).toHaveLength(0);
  });

  test("a request without Waypoint headers gives 401 device signature required", async () => {
    const w = await makeJobsWorld();
    const res = await appFor(U1, w).request(
      PATH,
      { method: "POST", headers: { "Idempotency-Key": KEY, "Content-Type": "application/json" }, body: JSON.stringify(OVERVIEW) },
      w.env,
    );
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toEqual({ code: "unauthorized", message: "device signature required", retry_after: null });
  });
});

describe("GET /v1/jobs/:id", () => {
  test("the user's own job gives 200 that passes JobResponseSchema", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_mine" });
    const res = await appFor(U1, w).request(`/v1/jobs/job_mine`, { method: "GET" }, w.env);
    expect(res.status).toBe(200);
    expect(JobResponseSchema.parse(await res.json()).job.id).toBe("job_mine");
  });

  test("another user's job gives 404 no such job", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_mine" });
    const res = await appFor(U2, w).request(`/v1/jobs/job_mine`, { method: "GET" }, w.env);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toEqual({ code: "not_found", message: "no such job", retry_after: null });
  });

  test("an unknown id gives 404 no such job", async () => {
    const w = await makeJobsWorld();
    const res = await appFor(U1, w).request(`/v1/jobs/job_none`, { method: "GET" }, w.env);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toEqual({ code: "not_found", message: "no such job", retry_after: null });
  });

  test("a running job more than 60 s past its deadline gives 200 with state failed", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_late", state: "running", deadlineAt: JOB_NOW + 600_000 });
    w.clock.now = JOB_NOW + 600_000 + MINUTE + 1;
    const res = await appFor(U1, w).request(`/v1/jobs/job_late`, { method: "GET" }, w.env);
    expect(res.status).toBe(200);
    expect(JobResponseSchema.parse(await res.json()).job.state).toBe("failed");
  });
});

describe("GET /v1/jobs/:id/result", () => {
  // A succeeded job of u1 whose result is sealed to dev_phone, with three bytes in R2.
  async function succeeded(w: World, id: string, options: { withObject?: boolean } = {}): Promise<void> {
    await insertJob(w, { id });
    await w.db
      .prepare("UPDATE jobs SET state = 'succeeded', spent = 40, finished_at = ?, expires_at = ?, result_key = ? WHERE id = ?")
      .bind(JOB_NOW, JOB_NOW + 7 * 24 * 60 * MINUTE, `results/${id}`, id)
      .run();
    if (options.withObject !== false) {
      w.objects.set(`results/${id}`, { value: new Uint8Array([7, 8, 9]), contentType: null });
    }
  }

  test("signed by the phone gives 200 with the three bytes, octet-stream and no-store", async () => {
    const w = await makeJobsWorld();
    await succeeded(w, "job_ok");
    const res = await appFor(U1, w).request(resultPath("job_ok"), await signedInit(w.phone, { method: "GET", path: resultPath("job_ok"), now: w.clock.now }), w.env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Length")).toBe("3");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
  });

  test("signed by the iPad, another device of the same user, gives 404 no such result", async () => {
    const w = await makeJobsWorld();
    await succeeded(w, "job_ok");
    const res = await appFor(U1, w).request(resultPath("job_ok"), await signedInit(w.ipad, { method: "GET", path: resultPath("job_ok"), now: w.clock.now }), w.env);
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toEqual({ code: "not_found", message: "no such result", retry_after: null });
  });

  test("a running job gives 404", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_run", state: "running" });
    const res = await appFor(U1, w).request(resultPath("job_run"), await signedInit(w.phone, { method: "GET", path: resultPath("job_run"), now: w.clock.now }), w.env);
    expect(res.status).toBe(404);
  });

  test.each(["running", "failed", "cancelled"])(
    "a %s job with a result key and an object at that key gives 404 when signed by the phone",
    async (state) => {
      const w = await makeJobsWorld();
      const id = `job_${state}`;
      await insertJob(w, { id, state });
      await w.db.prepare("UPDATE jobs SET result_key = ? WHERE id = ?").bind(`results/${id}`, id).run();
      w.objects.set(`results/${id}`, { value: new Uint8Array([7, 8, 9]), contentType: null });
      const res = await appFor(U1, w).request(resultPath(id), await signedInit(w.phone, { method: "GET", path: resultPath(id), now: w.clock.now }), w.env);
      expect(res.status).toBe(404);
    },
  );

  test("a succeeded job whose object is gone gives 404", async () => {
    const w = await makeJobsWorld();
    await succeeded(w, "job_gone", { withObject: false });
    const res = await appFor(U1, w).request(resultPath("job_gone"), await signedInit(w.phone, { method: "GET", path: resultPath("job_gone"), now: w.clock.now }), w.env);
    expect(res.status).toBe(404);
  });

  test("another user's job gives 404 even when signed by that user's own device", async () => {
    const w = await makeJobsWorld();
    await succeeded(w, "job_ok");
    const res = await appFor(U2, w).request(resultPath("job_ok"), await signedInit(w.other, { method: "GET", path: resultPath("job_ok"), now: w.clock.now }), w.env);
    expect(res.status).toBe(404);
  });

  test("without a signature gives 401", async () => {
    const w = await makeJobsWorld();
    await succeeded(w, "job_ok");
    const res = await appFor(U1, w).request(resultPath("job_ok"), { method: "GET" }, w.env);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /v1/jobs/:id", () => {
  const DELETE_KEY = "key-delete-0123456789";
  const pathFor = (id: string) => `/v1/jobs/${id}`;

  async function del(w: World, app: Hono<AppEnv>, id: string, options: { device?: TestDevice; key?: string } = {}): Promise<Response> {
    const path = pathFor(id);
    const init = await signedInit(options.device ?? w.phone, { method: "DELETE", path, now: w.clock.now, idempotencyKey: options.key ?? DELETE_KEY });
    return app.request(path, init, w.env);
  }

  // Input and two audio parts of a job in R2.
  function putJobObjects(w: World, id: string): void {
    w.objects.set(`tmp/input/${id}`, { value: new Uint8Array([1]), contentType: null });
    w.objects.set(`tmp/audio/${id}/0`, { value: new Uint8Array([2]), contentType: null });
    w.objects.set(`tmp/audio/${id}/1`, { value: new Uint8Array([3]), contentType: null });
  }

  test("a running job with its input and two audio parts gives 200 cancelled, with nothing left in R2", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_cancel", state: "running" });
    putJobObjects(w, "job_cancel");
    const res = await del(w, appFor(U1, w), "job_cancel");
    expect(res.status).toBe(200);
    expect(JobResponseSchema.parse(await res.json()).job.state).toBe("cancelled");
    expect(w.workflow.terminated).toEqual(["job_cancel"]);
    expect(w.store.read().monthly).toBe(100);
    expect(w.usage).toHaveLength(1);
    expect(w.usage[0]!.outcome).toBe("cancelled");
    expect([...w.objects.keys()].filter((key) => key.includes("job_cancel"))).toEqual([]);
  });

  test("a succeeded job gives 200 with its charge kept and result_ready false; its result is then gone", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_done" });
    await w.db
      .prepare("UPDATE jobs SET state = 'succeeded', spent = 40, finished_at = ?, expires_at = ?, result_key = 'results/job_done' WHERE id = 'job_done'")
      .bind(JOB_NOW, JOB_NOW + 7 * 24 * 60 * MINUTE)
      .run();
    w.objects.set("results/job_done", { value: new Uint8Array([4]), contentType: null });
    const res = await del(w, appFor(U1, w), "job_done");
    expect(res.status).toBe(200);
    const job = JobResponseSchema.parse(await res.json()).job;
    expect(job).toMatchObject({ state: "succeeded", spent: 40, result_ready: false });
    const result = await appFor(U1, w).request(
      resultPath("job_done"),
      await signedInit(w.phone, { method: "GET", path: resultPath("job_done"), now: w.clock.now }),
      w.env,
    );
    expect(result.status).toBe(404);
  });

  test("the same key again gives the stored reply, and terminate ran once", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_twice", state: "running" });
    const app = appFor(U1, w);
    const first = await del(w, app, "job_twice");
    const firstBody = await first.text();
    const second = await del(w, app, "job_twice");
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await second.text()).toBe(firstBody);
    expect(w.workflow.terminated).toEqual(["job_twice"]);
  });

  test("with no Workflow for the type, a running job is still cancelled", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_nowf", state: "running" });
    const res = await del(w, appFor(U1, w, () => null), "job_nowf");
    expect(res.status).toBe(200);
    expect(JobResponseSchema.parse(await res.json()).job.state).toBe("cancelled");
    expect(w.workflow.terminated).toEqual([]);
  });

  test("another user's job gives 404 no such job", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_mine", state: "running" });
    const res = await del(w, appFor(U2, w), "job_mine", { device: w.other });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toEqual({ code: "not_found", message: "no such job", retry_after: null });
    expect(await jobRow(w, "job_mine")).toMatchObject({ state: "running" });
    expect(w.store.read().monthly).toBe(60);
    expect(w.workflow.terminated).toEqual([]);
    expect(w.commands).toEqual([]);
  });

  test("an unknown id gives 404 no such job", async () => {
    const w = await makeJobsWorld();
    const res = await del(w, appFor(U1, w), "job_none");
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toEqual({ code: "not_found", message: "no such job", retry_after: null });
  });

  test("without a signature gives 401", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_nosig", state: "running" });
    const res = await appFor(U1, w).request(pathFor("job_nosig"), { method: "DELETE", headers: { "Idempotency-Key": DELETE_KEY } }, w.env);
    expect(res.status).toBe(401);
  });
});
