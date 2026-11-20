import type { WorkflowStep } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { RESULTS_KEEP_MS } from "../src/cleanup.ts";
import { BOOKKEEPING_STEP, finishJob, markRunning, notifyJob, runJob, type Made, type Steps } from "../src/jobs/run.ts";
import type { Db } from "../src/storage.ts";
import { fakeSteps, JOB_NOW, makeJobFixture } from "./helpers/jobs.ts";

// Compile-time check: a Workflow step is accepted where the jobs code expects a Steps (no cast needed).
export const stepFits: (step: WorkflowStep) => Steps = (step) => ({ do: (name, config, fn) => step.do(name, config, fn) });

const TEXT = "Osmosis moves water across a membrane.";
const RESULT_TEXT = "RESULT TEXT THAT MUST NOT LEAK";

const madeOk = (credits: number): Made => ({
  ok: true,
  result_key: "results/job_1",
  credits,
  bytes_sent: 38,
  tokens_in: 10,
  tokens_out: 5,
});

async function setState(db: Db, state: string) {
  await db.prepare("UPDATE jobs SET state = ? WHERE id = 'job_1'").bind(state).run();
}

describe("job run steps", () => {
  test("markRunning turns a queued job into running and returns true", async () => {
    const f = await makeJobFixture("overview_script");
    expect(await markRunning(f.db, "job_1")).toBe(true);
    expect((await f.jobRow())?.state).toBe("running");
  });

  test("markRunning on a running job returns true and keeps it running", async () => {
    const f = await makeJobFixture("overview_script");
    await setState(f.db, "running");
    expect(await markRunning(f.db, "job_1")).toBe(true);
    expect((await f.jobRow())?.state).toBe("running");
  });

  test("markRunning on a cancelled job returns false and leaves it cancelled", async () => {
    const f = await makeJobFixture("overview_script");
    await setState(f.db, "cancelled");
    expect(await markRunning(f.db, "job_1")).toBe(false);
    expect((await f.jobRow())?.state).toBe("cancelled");
  });

  test("finishJob with a made result of 40 credits settles 40 and records the job as succeeded", async () => {
    const f = await makeJobFixture("overview_script");
    await setState(f.db, "running");
    const finished = await finishJob(f.deps, f.input, madeOk(40));
    expect(f.store.read().monthly).toBe(60);
    expect(await f.jobRow()).toEqual({
      state: "succeeded",
      spent: 40,
      finished_at: JOB_NOW,
      expires_at: JOB_NOW + RESULTS_KEEP_MS,
      result_key: null,
    });
    expect(finished).toEqual({ ok: true, charged: 40, device_id: "device_1" });
  });

  test("finishJob with made.credits 55 on a 40-credit quote charges 40", async () => {
    const f = await makeJobFixture("overview_script");
    await setState(f.db, "running");
    const finished = await finishJob(f.deps, f.input, madeOk(55));
    expect(finished).toEqual({ ok: true, charged: 40, device_id: "device_1" });
    expect(f.store.read().monthly).toBe(60);
  });

  test("finishJob with made.credits 12 on a 40-credit quote charges 12 and gives back 28", async () => {
    const f = await makeJobFixture("overview_script");
    await setState(f.db, "running");
    const finished = await finishJob(f.deps, f.input, madeOk(12));
    expect(finished).toEqual({ ok: true, charged: 12, device_id: "device_1" });
    expect(f.store.read().monthly).toBe(88);
  });

  test("finishJob run twice for the same job returns the same success both times and keeps the result", async () => {
    const f = await makeJobFixture("overview_script");
    await setState(f.db, "running");
    await f.bucket.put("results/job_1", new TextEncoder().encode("sealed"));
    const first = await finishJob(f.deps, f.input, madeOk(40));
    const second = await finishJob(f.deps, f.input, madeOk(40));
    expect(first).toEqual({ ok: true, charged: 40, device_id: "device_1" });
    expect(second).toEqual({ ok: true, charged: 40, device_id: "device_1" });
    expect(f.objects.has("results/job_1")).toBe(true);
  });

  test("finishJob when the hold was released by a cancel first deletes the result and leaves the row cancelled", async () => {
    const f = await makeJobFixture("overview_script");
    await f.bucket.put("results/job_1", new TextEncoder().encode("sealed"));
    await setState(f.db, "cancelled");
    f.store.apply({ type: "release", id: "job_release:u1:k1", hold_id: "job:u1:k1" }, JOB_NOW);
    const finished = await finishJob(f.deps, f.input, madeOk(40));
    expect(finished).toEqual({ ok: false, charged: 0, device_id: null });
    expect(f.objects.has("results/job_1")).toBe(false);
    expect((await f.jobRow())?.state).toBe("cancelled");
  });

  test("finishJob when the row was cancelled but the hold is still open charges 40, deletes the result and leaves the row cancelled", async () => {
    const f = await makeJobFixture("overview_script");
    await f.bucket.put("results/job_1", new TextEncoder().encode("sealed"));
    await setState(f.db, "cancelled");
    const finished = await finishJob(f.deps, f.input, madeOk(40));
    expect(finished).toEqual({ ok: false, charged: 40, device_id: null });
    expect(f.objects.has("results/job_1")).toBe(false);
    expect((await f.jobRow())?.state).toBe("cancelled");
  });

  test("finishJob with a failure releases the hold and records the job as failed", async () => {
    const f = await makeJobFixture("overview_script");
    const finished = await finishJob(f.deps, f.input, { ok: false, reason: "model_failed", tokens_in: null, tokens_out: null });
    expect(f.store.read().monthly).toBe(100);
    expect(await f.jobRow()).toEqual({ state: "failed", spent: 0, finished_at: JOB_NOW, expires_at: null, result_key: null });
    expect(finished).toEqual({ ok: false, charged: 0, device_id: null });
  });

  test("notifyJob after success sends the job_ready push and one usage event", async () => {
    const f = await makeJobFixture("overview_script");
    await notifyJob(f.deps, f.input, madeOk(40), { ok: true, charged: 40, device_id: "device_1" });
    expect(f.pushes).toEqual([{ user_id: "u1", kind: "job_ready", ref: "job_1", device_id: "device_1" }]);
    expect(f.usage).toEqual([
      {
        v: 1,
        id: "job:u1:k1",
        at: JOB_NOW,
        user_id: "u1",
        task: "overview_script",
        outcome: "ok",
        credits: 40,
        tier: "strong",
        model: "@cf/test/strong",
        retention: "standard",
        router: "skipped",
        bytes_sent: 38,
        tokens_in: 10,
        tokens_out: 5,
      },
    ]);
  });

  test("notifyJob after a failure sends no push and a model_failed usage event with 0 credits and the input's bytes", async () => {
    const f = await makeJobFixture("overview_script");
    const made: Made = { ok: false, reason: "model_failed", tokens_in: null, tokens_out: null };
    await notifyJob(f.deps, f.input, made, { ok: false, charged: 0, device_id: null });
    expect(f.pushes).toEqual([]);
    expect(f.usage).toHaveLength(1);
    expect(f.usage[0]).toMatchObject({ outcome: "model_failed", credits: 0, bytes_sent: 38 });
  });

  test("notifyJob after success with device_id null sends no push and still sends the usage event", async () => {
    const f = await makeJobFixture("overview_script");
    await notifyJob(f.deps, f.input, madeOk(40), { ok: true, charged: 40, device_id: null });
    expect(f.pushes).toEqual([]);
    expect(f.usage).toHaveLength(1);
  });

  test("notifyJob with a push queue that throws still sends the usage event and resolves", async () => {
    const f = await makeJobFixture("overview_script");
    const deps = { ...f.deps, push: { send: async () => Promise.reject(new Error("queue down")) } };
    await expect(notifyJob(deps, f.input, madeOk(40), { ok: true, charged: 40, device_id: "device_1" })).resolves.toBeUndefined();
    expect(f.usage).toHaveLength(1);
  });

  test("runJob with a made result runs the five steps, deletes the input and audio parts, keeps the result, and holds no text", async () => {
    const f = await makeJobFixture("overview_script");
    await f.bucket.put("results/job_1", new TextEncoder().encode("sealed"));
    await f.bucket.put("tmp/audio/job_1/0", new Uint8Array([1]));
    await f.bucket.put("tmp/audio/job_1/1", new Uint8Array([2]));
    const steps = fakeSteps();
    const ok = await runJob(f.deps, steps.steps, f.input, {
      config: BOOKKEEPING_STEP,
      run: async () => {
        await f.bucket.put("results/job_1", new TextEncoder().encode(RESULT_TEXT));
        return madeOk(40);
      },
    });
    expect(ok).toBe(true);
    expect(steps.names).toEqual(["start", "make", "cleanup", "finish", "notify"]);
    expect(f.objects.has("tmp/input/job_1")).toBe(false);
    expect(f.objects.has("tmp/audio/job_1/0")).toBe(false);
    expect(f.objects.has("tmp/audio/job_1/1")).toBe(false);
    expect(f.objects.has("results/job_1")).toBe(true);
    const recorded = JSON.stringify(steps.results);
    expect(recorded).not.toContain(TEXT);
    expect(recorded).not.toContain(RESULT_TEXT);
  });

  test("runJob when the make step throws on every try releases the hold, fails the job, still deletes the input and returns false", async () => {
    const f = await makeJobFixture("overview_script");
    let ran = false;
    const steps = fakeSteps(["make"]);
    const ok = await runJob(f.deps, steps.steps, f.input, {
      config: BOOKKEEPING_STEP,
      run: async () => {
        ran = true;
        return madeOk(40);
      },
    });
    expect(ok).toBe(false);
    expect(ran).toBe(false);
    expect(f.store.read().monthly).toBe(100);
    expect((await f.jobRow())?.state).toBe("failed");
    expect(f.usage).toHaveLength(1);
    expect(f.usage[0]).toMatchObject({ outcome: "model_failed", tokens_in: null, tokens_out: null });
    expect(f.objects.has("tmp/input/job_1")).toBe(false);
  });

  test("runJob with a deadline already passed never calls the model, releases the hold and fails the job", async () => {
    const f = await makeJobFixture("overview_script");
    let ran = false;
    const input = { ...f.input, deadline: JOB_NOW - 1 };
    const ok = await runJob(f.deps, fakeSteps().steps, input, {
      config: BOOKKEEPING_STEP,
      run: async () => {
        ran = true;
        return madeOk(40);
      },
    });
    expect(ok).toBe(false);
    expect(ran).toBe(false);
    expect(f.store.read().monthly).toBe(100);
    expect((await f.jobRow())?.state).toBe("failed");
  });

  test("runJob on a cancelled job runs only start and cleanup, applies no wallet command, sends no usage event and returns false", async () => {
    const f = await makeJobFixture("overview_script");
    await setState(f.db, "cancelled");
    const before = f.store.read().monthly;
    let ran = false;
    const steps = fakeSteps();
    const ok = await runJob(f.deps, steps.steps, f.input, {
      config: BOOKKEEPING_STEP,
      run: async () => {
        ran = true;
        return madeOk(40);
      },
    });
    expect(ok).toBe(false);
    expect(steps.names).toEqual(["start", "cleanup"]);
    expect(ran).toBe(false);
    expect(f.store.read().monthly).toBe(before);
    expect(f.usage).toEqual([]);
  });

  test("runJob passes the given make config to the make step and BOOKKEEPING_STEP to the other four", async () => {
    const f = await makeJobFixture("overview_script");
    const makeConfig = { retries: { limit: 1, delay: 1_000, backoff: "constant" as const }, timeout: 900_000 };
    const steps = fakeSteps();
    await runJob(f.deps, steps.steps, f.input, { config: makeConfig, run: async () => madeOk(40) });
    expect(steps.configs).toEqual([BOOKKEEPING_STEP, makeConfig, BOOKKEEPING_STEP, BOOKKEEPING_STEP, BOOKKEEPING_STEP]);
  });
});
