import type { JobType } from "@waypoint/contracts";
import { describe, expect, test } from "vitest";
import type { Env } from "../src/env.ts";
import { deleteJobInput, putJobInput, readJobInput, type InputBucket } from "../src/jobs/input.ts";
import {
  cancelJob,
  deleteJobInputs,
  isOverdue,
  jobIdFor,
  jobView,
  jobWalletIds,
  loadJob,
  type JobBucket,
} from "../src/jobs/job.ts";
import type { ResultBucket } from "../src/jobs/seal.ts";
import { JOB_WORKFLOWS, jobTimeLimitMs, jobWorkflow, type JobRunInput, type JobWorkflow } from "../src/jobs/start.ts";
import { insertJob, JOB_NOW, makeJobsWorld, memoryBucket } from "./helpers/jobs.ts";

// Compile-time checks: the Cloudflare bindings are accepted where the jobs code expects them.
export const jobBucketFits: (bucket: R2Bucket) => JobBucket = (bucket) => bucket;
export const inputBucketFits: (bucket: R2Bucket) => InputBucket = (bucket) => bucket;
export const workflowFits: (workflow: Workflow<JobRunInput>) => JobWorkflow = (workflow) => workflow;
export const memoryFits: (bucket: ReturnType<typeof memoryBucket>["bucket"]) => JobBucket & InputBucket & ResultBucket = (
  bucket,
) => bucket;

const ALL_TYPES: JobType[] = ["research", "overview_script", "video_slides", "diagram", "mini_app", "practice", "retranscribe"];
const KEY = "key-job_run-0123456789";
const MARKER = "MARKER-the-cell-takes-in-water";

// Runs a cancel on the job as it is in the row, with a stop that counts its calls.
function stopCounter() {
  const calls = { count: 0 };
  const stop = async () => {
    calls.count += 1;
  };
  return { calls, stop };
}

describe("workflow registry and time limits", () => {
  test("jobWorkflow returns null for each of the seven types; with JOB_WORKFLOWS.diagram set, it returns what that function returns", () => {
    for (const type of ALL_TYPES) {
      expect(jobWorkflow({} as Env, type)).toBeNull();
    }
    const fake = { create: async () => ({}), get: async () => ({ terminate: async () => {}, sendEvent: async () => {} }) };
    const saved = JOB_WORKFLOWS.diagram;
    JOB_WORKFLOWS.diagram = () => fake;
    try {
      expect(jobWorkflow({} as Env, "diagram")).toBe(fake);
    } finally {
      if (saved === undefined) delete JOB_WORKFLOWS.diagram;
      else JOB_WORKFLOWS.diagram = saved;
    }
  });

  test("jobTimeLimitMs: research quick, standard and deep are 20, 30 and 60 minutes; retranscribe of 4.2 minutes is 90 minutes + 50 s; diagram and practice 20 minutes; the other three 30 minutes", () => {
    const MIN = 60_000;
    expect(jobTimeLimitMs({ type: "research", depth: "quick", minutes: null })).toBe(20 * MIN);
    expect(jobTimeLimitMs({ type: "research", depth: "standard", minutes: null })).toBe(30 * MIN);
    expect(jobTimeLimitMs({ type: "research", depth: "deep", minutes: null })).toBe(60 * MIN);
    expect(jobTimeLimitMs({ type: "retranscribe", depth: null, minutes: 4.2 })).toBe(90 * MIN + 50_000);
    expect(jobTimeLimitMs({ type: "diagram", depth: null, minutes: null })).toBe(20 * MIN);
    expect(jobTimeLimitMs({ type: "practice", depth: null, minutes: null })).toBe(20 * MIN);
    for (const type of ["overview_script", "video_slides", "mini_app"] as const) {
      expect(jobTimeLimitMs({ type, depth: null, minutes: null })).toBe(30 * MIN);
    }
  });
});

describe("job ids and wallet ids", () => {
  test("jobIdFor gives job_ and 22 base64url characters, the same twice, different for another user or another key", async () => {
    const id = await jobIdFor("u1", KEY);
    expect(id).toMatch(/^job_[A-Za-z0-9_-]{22}$/);
    expect(await jobIdFor("u1", KEY)).toBe(id);
    expect(await jobIdFor("u2", KEY)).not.toBe(id);
    expect(await jobIdFor("u1", "another-key-0123456789")).not.toBe(id);
  });

  test("jobWalletIds gives job:u1:K, job_settle:u1:K and job_release:u1:K, each at most 128 characters for a 36-character user id and a 64-character key", () => {
    expect(jobWalletIds("u1", "K")).toEqual({ hold: "job:u1:K", settle: "job_settle:u1:K", release: "job_release:u1:K" });
    const user = "u".repeat(36);
    const longKey = "k".repeat(64);
    const ids = jobWalletIds(user, longKey);
    for (const id of Object.values(ids)) {
      expect(id.length).toBeLessThanOrEqual(128);
    }
  });
});

describe("locked job input", () => {
  test("putJobInput then readJobInput gives { text, prompt } back; the key is 43 characters; the stored bytes do not contain the text", async () => {
    const w = await makeJobsWorld();
    const key = await putJobInput(w.bucket, "job_a", { text: MARKER, prompt: "short" });
    expect(key).toHaveLength(43);
    expect(await readJobInput(w.bucket, "job_a", key)).toEqual({ text: MARKER, prompt: "short" });
    const stored = w.objects.get("tmp/input/job_a");
    expect(stored).toBeDefined();
    expect(new TextDecoder().decode(stored?.value ?? new Uint8Array()).includes(MARKER)).toBe(false);
  });

  test("readJobInput with another job's id, another key, one changed stored byte, or no object gives null; deleteJobInput removes the object", async () => {
    const w = await makeJobsWorld();
    const key = await putJobInput(w.bucket, "job_a", { text: MARKER, prompt: null });
    const otherKey = await putJobInput(w.bucket, "job_b", { text: "other", prompt: null });
    expect(await readJobInput(w.bucket, "job_b", key)).toBeNull();
    expect(await readJobInput(w.bucket, "job_a", otherKey)).toBeNull();
    const stored = w.objects.get("tmp/input/job_a");
    if (stored === undefined) throw new Error("expected the stored input");
    stored.value[20] = (stored.value[20] ?? 0) ^ 1;
    expect(await readJobInput(w.bucket, "job_a", key)).toBeNull();
    expect(await readJobInput(w.bucket, "job_missing", key)).toBeNull();
    await deleteJobInput(w.bucket, "job_a");
    expect(w.objects.has("tmp/input/job_a")).toBe(false);
  });

  test("deleteJobInputs deletes tmp/input/{job} and every tmp/audio/{job}/{n}, and keeps results/{job}, another job's input and tmp/audio/{job}x/0", async () => {
    const w = await makeJobsWorld();
    for (const key of ["tmp/input/job_1", "tmp/audio/job_1/0", "tmp/audio/job_1/1", "results/job_1", "tmp/input/job_2", "tmp/audio/job_1x/0"]) {
      await w.bucket.put(key, new Uint8Array([1]));
    }
    await deleteJobInputs(w.bucket, "job_1");
    expect([...w.objects.keys()].sort()).toEqual(["results/job_1", "tmp/audio/job_1x/0", "tmp/input/job_2"]);
  });
});

describe("job rows", () => {
  test("loadJob returns the row with billing_account_id ba_u1; for user u2 it is null; an unknown id is null", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_run", key: KEY, state: "running" });
    const row = await loadJob(w.db, "job_run", "u1");
    expect(row?.billing_account_id).toBe("ba_u1");
    expect(await loadJob(w.db, "job_run", "u2")).toBeNull();
    expect(await loadJob(w.db, "job_missing")).toBeNull();
  });

  test("jobView maps the row with tier from route; result_ready is true for a succeeded job with a result_key before expires_at, false at expires_at, false with no result_key", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_ok", key: "key-job_ok-0123456789", state: "succeeded" });
    await w.db.prepare("UPDATE jobs SET result_key = 'results/job_ok', expires_at = ? WHERE id = 'job_ok'").bind(JOB_NOW + 1000).run();
    const row = await loadJob(w.db, "job_ok", "u1");
    if (row === null) throw new Error("expected the job");
    expect(jobView(row, JOB_NOW)).toMatchObject({ id: "job_ok", state: "succeeded", tier: "strong", retention: "standard", result_ready: true });
    expect(jobView(row, JOB_NOW + 1000).result_ready).toBe(false);
    await w.db.prepare("UPDATE jobs SET result_key = NULL WHERE id = 'job_ok'").run();
    const noResult = await loadJob(w.db, "job_ok", "u1");
    if (noResult === null) throw new Error("expected the job");
    expect(jobView(noResult, JOB_NOW).result_ready).toBe(false);
  });

  test("isOverdue: a running job at exactly deadline + 60,000 ms is not overdue, 1 ms later it is and its view says failed; a succeeded job is never overdue", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_run", key: KEY, state: "running" });
    await insertJob(w, { id: "job_ok", key: "key-job_ok-0123456789", state: "succeeded" });
    const running = await loadJob(w.db, "job_run", "u1");
    const done = await loadJob(w.db, "job_ok", "u1");
    if (running === null || done === null) throw new Error("expected the jobs");
    const deadline = running.deadline_at;
    expect(isOverdue(running, deadline + 60_000)).toBe(false);
    expect(isOverdue(running, deadline + 60_001)).toBe(true);
    expect(jobView(running, deadline + 60_001).state).toBe("failed");
    expect(isOverdue(done, deadline + 10 * 60_000)).toBe(false);
  });
});

describe("cancelJob", () => {
  test("cancelling a running job calls stop once, releases its hold, marks it cancelled with spent 0, writes one cancelled usage event and deletes its result, input and two audio parts", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_run", key: KEY, state: "running" });
    await w.bucket.put("results/job_run", new Uint8Array([1]));
    await w.bucket.put("tmp/input/job_run", new Uint8Array([1]));
    await w.bucket.put("tmp/audio/job_run/0", new Uint8Array([1]));
    await w.bucket.put("tmp/audio/job_run/1", new Uint8Array([1]));
    const row = await loadJob(w.db, "job_run", "u1");
    if (row === null) throw new Error("expected the job");
    const { calls, stop } = stopCounter();
    await cancelJob(w.deps, row, stop);
    expect(calls.count).toBe(1);
    expect(w.store.read().monthly).toBe(100);
    const after = await loadJob(w.db, "job_run", "u1");
    expect(after).toMatchObject({ state: "cancelled", spent: 0, finished_at: JOB_NOW, result_key: null });
    expect(w.usage).toHaveLength(1);
    expect(w.usage[0]).toMatchObject({
      id: `job:u1:${KEY}`,
      outcome: "cancelled",
      credits: 0,
      task: "overview_script",
      tier: "strong",
      router: "skipped",
      bytes_sent: 12,
      tokens_in: null,
      tokens_out: null,
    });
    expect([...w.objects.keys()]).toEqual([]);
  });

  test("cancelling a running job still cancels when its stop rejects", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_run", key: KEY, state: "running" });
    const row = await loadJob(w.db, "job_run", "u1");
    if (row === null) throw new Error("expected the job");
    await cancelJob(w.deps, row, async () => {
      throw new Error("instance gone");
    });
    expect(w.store.read().monthly).toBe(100);
    expect((await loadJob(w.db, "job_run", "u1"))?.state).toBe("cancelled");
  });

  test("cancelling a succeeded job does not stop it or send any wallet command; spent is kept and results/{job} is deleted", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_ok", key: "key-job_ok-0123456789", state: "succeeded" });
    await w.db.prepare("UPDATE jobs SET spent = 30, result_key = 'results/job_ok', finished_at = ? WHERE id = 'job_ok'").bind(JOB_NOW).run();
    await w.bucket.put("results/job_ok", new Uint8Array([1]));
    const row = await loadJob(w.db, "job_ok", "u1");
    if (row === null) throw new Error("expected the job");
    const { calls, stop } = stopCounter();
    await cancelJob(w.deps, row, stop);
    expect(calls.count).toBe(0);
    expect(w.commands).toHaveLength(0);
    expect(await loadJob(w.db, "job_ok", "u1")).toMatchObject({ state: "succeeded", spent: 30, result_key: null });
    expect(w.objects.has("results/job_ok")).toBe(false);
  });

  test("cancelling a running job whose hold was already settled keeps the state running and the charge, deletes the objects and sends no usage event", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_run", key: KEY, state: "running" });
    w.store.apply({ type: "settle", id: `job_settle:u1:${KEY}`, hold_id: `job:u1:${KEY}`, actual: 30 }, JOB_NOW);
    await w.bucket.put("results/job_run", new Uint8Array([1]));
    const row = await loadJob(w.db, "job_run", "u1");
    if (row === null) throw new Error("expected the job");
    await cancelJob(w.deps, row, async () => {});
    expect((await loadJob(w.db, "job_run", "u1"))?.state).toBe("running");
    expect(w.store.read().monthly).toBe(70);
    expect(w.usage).toHaveLength(0);
    expect(w.objects.has("results/job_run")).toBe(false);
  });

  test("cancelling an overdue running job whose hold has expired and been swept marks it failed and charges nothing", async () => {
    const w = await makeJobsWorld();
    const deadline = JOB_NOW + 600_000;
    await insertJob(w, { id: "job_run", key: KEY, state: "running", deadlineAt: deadline });
    const row = await loadJob(w.db, "job_run", "u1");
    if (row === null) throw new Error("expected the job");
    w.clock.now = deadline + 60_001;
    w.store.apply({ type: "release_expired", id: "expire-1" }, w.clock.now);
    await cancelJob(w.deps, row, async () => {});
    expect(await loadJob(w.db, "job_run", "u1")).toMatchObject({ state: "failed", spent: 0 });
    expect(w.store.read().monthly).toBe(100);
    expect(w.usage).toHaveLength(0);
  });

  test("cancelling twice writes one usage event and makes one release", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_run", key: KEY, state: "running" });
    const first = await loadJob(w.db, "job_run", "u1");
    if (first === null) throw new Error("expected the job");
    await cancelJob(w.deps, first, async () => {});
    const second = await loadJob(w.db, "job_run", "u1");
    if (second === null) throw new Error("expected the job");
    await cancelJob(w.deps, second, async () => {});
    expect(w.usage).toHaveLength(1);
    expect(w.commands.filter((command) => command.type === "release")).toHaveLength(1);
  });
});
