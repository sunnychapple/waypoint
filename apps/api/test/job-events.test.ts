import { JobViewSchema } from "@waypoint/contracts";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { jobEventsRoute, JOB_EVENTS_MAX_MS } from "../src/jobs/events.ts";
import { insertJob, JOB_NOW, makeJobsWorld } from "./helpers/jobs.ts";

type World = Awaited<ReturnType<typeof makeJobsWorld>>;

const U1: SessionUser = { id: "u1", clerk_id: "clerk_u1", plan: "free", billing_account_id: "ba_u1", zero_retention: false };
const U2: SessionUser = { id: "u2", clerk_id: "clerk_u2", plan: "free", billing_account_id: "ba_u2", zero_retention: false };
const DAY = 86_400_000;

type Block = { kind: "state"; id: string; data: unknown } | { kind: "keep-alive" };

// Splits an SSE body into its blocks: "state" events (with their id and parsed data) and ": keep-alive" comments.
function blocksOf(text: string): Block[] {
  return text
    .split("\n\n")
    .filter((block) => block !== "")
    .map((block): Block => {
      if (block.startsWith(": keep-alive")) return { kind: "keep-alive" };
      const fields: Record<string, string> = Object.fromEntries(
        block.split("\n").map((line) => {
          const at = line.indexOf(": ");
          return [line.slice(0, at), line.slice(at + 2)];
        }),
      );
      expect(fields.event).toBe("state");
      return { kind: "state", id: String(fields.id), data: JSON.parse(String(fields.data)) };
    });
}

function stateBlocks(text: string): Extract<Block, { kind: "state" }>[] {
  return blocksOf(text).filter((block): block is Extract<Block, { kind: "state" }> => block.kind === "state");
}

function appFor(user: SessionUser, w: World, sleep: (ms: number) => Promise<void>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", jobEventsRoute({ now: () => w.clock.now, sleep }));
  return app;
}

// A sleep that moves the test clock on, counts its calls and runs a hook on each call.
function clockSleep(w: World, hook: (call: number) => Promise<void> | void = () => undefined) {
  const calls = { n: 0 };
  const sleep = async (ms: number) => {
    w.clock.now += ms;
    calls.n += 1;
    await hook(calls.n);
  };
  return { sleep, calls };
}

async function run(w: World, user: SessionUser, id: string, sleep: (ms: number) => Promise<void>): Promise<Response> {
  return appFor(user, w, sleep).request(`/v1/jobs/${id}/events`, {}, w.env);
}

describe("GET /v1/jobs/:id/events", () => {
  test("a queued job that runs and then succeeds streams three state events in order, then ends", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_a", state: "queued" });
    const { sleep, calls } = clockSleep(w, async (call) => {
      if (call === 1) await w.db.prepare("UPDATE jobs SET state = 'running' WHERE id = ?").bind("job_a").run();
      if (call === 30) {
        await w.db
          .prepare("UPDATE jobs SET state = 'succeeded', spent = 40, result_key = ?, finished_at = ?, expires_at = ? WHERE id = ?")
          .bind("results/job_a", JOB_NOW + 30_000, JOB_NOW + 7 * DAY, "job_a")
          .run();
      }
    });
    const res = await run(w, U1, "job_a", sleep);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const states = stateBlocks(await res.text());
    expect(states.map((block) => block.id)).toEqual(["1", "2", "3"]);
    expect(states.map((block) => JobViewSchema.parse(block.data).state)).toEqual(["queued", "running", "succeeded"]);
    expect(JobViewSchema.parse(states[2]?.data).result_ready).toBe(true);
    expect(calls.n).toBe(30);
  });

  test("a job that is already cancelled gives one state event and never sleeps", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_a", state: "cancelled" });
    const { sleep, calls } = clockSleep(w);
    const states = stateBlocks(await (await run(w, U1, "job_a", sleep)).text());
    expect(states).toHaveLength(1);
    expect(JobViewSchema.parse(states[0]?.data).state).toBe("cancelled");
    expect(calls.n).toBe(0);
  });

  test("a keep-alive comment comes once 20 s pass without a change, and not before", async () => {
    const w = await makeJobsWorld();
    // Stopped at the 9th sleep (18 s): no keep-alive yet.
    await insertJob(w, { id: "job_a", state: "queued" });
    const early = clockSleep(w, async (call) => {
      if (call === 9) await w.db.prepare("UPDATE jobs SET state = 'cancelled', spent = 0, finished_at = ? WHERE id = ?").bind(w.clock.now, "job_a").run();
    });
    const earlyBlocks = blocksOf(await (await run(w, U1, "job_a", early.sleep)).text());
    expect(earlyBlocks.map((block) => block.kind)).toEqual(["state", "state"]);
    // Stopped at the 11th sleep (22 s): one keep-alive, after the first state event and before the last.
    await insertJob(w, { id: "job_b", state: "queued" });
    const late = clockSleep(w, async (call) => {
      if (call === 11) await w.db.prepare("UPDATE jobs SET state = 'cancelled', spent = 0, finished_at = ? WHERE id = ?").bind(w.clock.now, "job_b").run();
    });
    const lateBlocks = blocksOf(await (await run(w, U1, "job_b", late.sleep)).text());
    expect(lateBlocks.map((block) => block.kind)).toEqual(["state", "keep-alive", "state"]);
  });

  test("a job that never changes ends after JOB_EVENTS_MAX_MS, with one state event", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_a", state: "queued" });
    const { sleep, calls } = clockSleep(w);
    const states = stateBlocks(await (await run(w, U1, "job_a", sleep)).text());
    expect(states).toHaveLength(1);
    expect(calls.n).toBe(JOB_EVENTS_MAX_MS / 2_000);
    expect(calls.n).toBe(300);
  });

  test("a running job that goes overdue streams failed and ends", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_a", state: "running" });
    // Deadline is JOB_NOW + 600,000; the hold expires 60,000 ms later.
    const { sleep, calls } = clockSleep(w, (call) => {
      if (call === 1) w.clock.now = JOB_NOW + 660_001;
    });
    const states = stateBlocks(await (await run(w, U1, "job_a", sleep)).text());
    expect(states.map((block) => JobViewSchema.parse(block.data).state)).toEqual(["running", "failed"]);
    expect(calls.n).toBe(1);
  });

  test("a client that cancels the stream stops the polling", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_a", state: "running" });
    let calls = 0;
    const sleep = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
    };
    const res = await run(w, U1, "job_a", sleep);
    if (res.body === null) throw new Error("no stream body");
    const reader = res.body.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const atCancel = calls;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toBe(atCancel);
  });

  test("a job whose user is deleted mid-stream ends the stream after one state event", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_a", state: "queued" });
    const { sleep, calls } = clockSleep(w, async (call) => {
      if (call === 2) await w.db.prepare("DELETE FROM users WHERE id = ?").bind("u1").run();
    });
    const states = stateBlocks(await (await run(w, U1, "job_a", sleep)).text());
    expect(states).toHaveLength(1);
    expect(calls.n).toBe(2);
  });

  test("another user's job and an unknown id give 404 JSON, not a stream", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_a", state: "queued" });
    const { sleep, calls } = clockSleep(w);
    for (const [user, id] of [
      [U2, "job_a"],
      [U1, "job_nope"],
    ] as const) {
      const res = await run(w, user, id, sleep);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await res.json()).toEqual({ code: "not_found", message: "no such job", retry_after: null });
    }
    expect(calls.n).toBe(0);
  });

  test("every event's data has exactly the JobView keys and no content", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_a", state: "queued" });
    const { sleep } = clockSleep(w, async (call) => {
      if (call === 1) {
        await w.db
          .prepare("UPDATE jobs SET state = 'succeeded', spent = 40, result_key = ?, finished_at = ?, expires_at = ? WHERE id = ?")
          .bind("results/job_a", JOB_NOW + 1_000, JOB_NOW + 7 * DAY, "job_a")
          .run();
      }
    });
    const text = await (await run(w, U1, "job_a", sleep)).text();
    const states = stateBlocks(text);
    expect(states).toHaveLength(2);
    for (const block of states) {
      expect(Object.keys(block.data as object).sort()).toEqual(Object.keys(JobViewSchema.shape).sort());
      JobViewSchema.parse(block.data);
    }
    expect(text).not.toContain("results/");
    expect(text).not.toContain("tmp/input");
  });
});
