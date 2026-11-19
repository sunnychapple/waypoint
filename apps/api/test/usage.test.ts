import { describe, expect, test } from "vitest";
import { z } from "zod";
import type { QueueBatch, QueueMessage } from "../src/queue.ts";
import type { UsageEvent } from "../src/usage.ts";
import { handleUsageBatch, UsageEventSchema, type UsageDataset } from "../src/usage-consumer.ts";
import type { Db } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";

// Compile-time checks: an AnalyticsEngineDataset is accepted as UsageDataset, and a UsageEvent is accepted by the schema's type.
export const aeFits: (dataset: AnalyticsEngineDataset) => UsageDataset = (dataset) => dataset;
export const eventFits: (event: UsageEvent) => z.infer<typeof UsageEventSchema> = (event) => event;

const GOOD: UsageEvent = {
  v: 1,
  id: "explain:u1:abcdefghijklmnop",
  at: 1000,
  user_id: "u1",
  task: "explain",
  outcome: "ok",
  credits: 1,
  tier: "light",
  model: "@cf/example/light",
  retention: "standard",
  router: "ok",
  bytes_sent: 40,
  tokens_in: 120,
  tokens_out: 9,
};

type Point = { indexes: string[]; blobs: string[]; doubles: number[] };

// Records every message's ack and retry, and every Analytics Engine data point.
function harness(body: (index: number) => unknown, count = 1) {
  const acks: number[] = [];
  const retries: { index: number; options: unknown }[] = [];
  const messages: QueueMessage[] = Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    body: body(index),
    attempts: 1,
    ack: () => acks.push(index),
    retry: (options) => retries.push({ index, options }),
  }));
  const points: Point[] = [];
  const analytics: UsageDataset = { writeDataPoint: (point) => points.push(point) };
  const batch: QueueBatch = { queue: "waypoint-usage", messages };
  return { batch, acks, retries, points, analytics };
}

async function dbWithUser(): Promise<Db> {
  const db = createTestDb();
  await db
    .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
    .bind("u1", "clerk_u1", 1, "ba_u1")
    .run();
  return db;
}

async function activityRows(db: Db) {
  const { results } = await db.prepare("SELECT * FROM activity ORDER BY id").all();
  return results;
}

describe("usage consumer", () => {
  test("a good event writes one activity row, one data point and is acked", async () => {
    const db = await dbWithUser();
    const h = harness(() => GOOD);
    await handleUsageBatch(h.batch, { DB: db, ANALYTICS: h.analytics });
    expect(await activityRows(db)).toEqual([
      {
        id: GOOD.id,
        user_id: "u1",
        task: "explain",
        bytes_sent: 40,
        credits: 1,
        route: "light",
        retention: "standard",
        at: 1000,
      },
    ]);
    expect(h.points).toEqual([
      {
        indexes: ["explain"],
        blobs: ["explain", "light", "standard", "ok", "@cf/example/light", "ok"],
        doubles: [1, 40, 120, 9],
      },
    ]);
    expect(h.acks).toEqual([0]);
    expect(h.retries).toEqual([]);
  });

  test("the same event twice in one batch writes one row and one data point, and both are acked", async () => {
    const db = await dbWithUser();
    const h = harness(() => GOOD, 2);
    await handleUsageBatch(h.batch, { DB: db, ANALYTICS: h.analytics });
    expect(await activityRows(db)).toHaveLength(1);
    expect(h.points).toHaveLength(1);
    expect(h.acks).toEqual([0, 1]);
  });

  test("a model_failed event is written with credits 0 and -1 for the missing token counts", async () => {
    const db = await dbWithUser();
    const failed: UsageEvent = { ...GOOD, outcome: "model_failed", credits: 0, tokens_in: null, tokens_out: null };
    const h = harness(() => failed);
    await handleUsageBatch(h.batch, { DB: db, ANALYTICS: h.analytics });
    expect(await activityRows(db)).toEqual([expect.objectContaining({ id: GOOD.id, credits: 0 })]);
    expect(h.points[0]?.doubles).toEqual([0, 40, -1, -1]);
  });

  test("a job event is written", async () => {
    const db = await dbWithUser();
    const job: UsageEvent = { ...GOOD, id: "job:u1:abcdefghijklmnop", task: "overview_script", router: "skipped" };
    const h = harness(() => job);
    await handleUsageBatch(h.batch, { DB: db, ANALYTICS: h.analytics });
    expect(await activityRows(db)).toEqual([expect.objectContaining({ id: job.id, task: "overview_script" })]);
    expect(h.points[0]?.blobs[5]).toBe("skipped");
    expect(h.acks).toEqual([0]);
  });

  test("an event with an extra text key, an unknown task, an unknown tier, v 2 or a bad id is acked and writes nothing", async () => {
    const db = await dbWithUser();
    const bad: unknown[] = [
      { ...GOOD, text: "a note" },
      { ...GOOD, task: "summarize" },
      { ...GOOD, tier: "gpt" },
      { ...GOOD, v: 2 },
      { ...GOOD, id: "has a space" },
    ];
    const h = harness((index) => bad[index], bad.length);
    await handleUsageBatch(h.batch, { DB: db, ANALYTICS: h.analytics });
    expect(await activityRows(db)).toEqual([]);
    expect(h.points).toEqual([]);
    expect(h.acks).toEqual([0, 1, 2, 3, 4]);
    expect(h.retries).toEqual([]);
  });

  test("an event for a user that does not exist is retried after 30 seconds and writes no data point", async () => {
    const db = await dbWithUser();
    const orphan: UsageEvent = { ...GOOD, user_id: "nobody" };
    const h = harness(() => orphan);
    await handleUsageBatch(h.batch, { DB: db, ANALYTICS: h.analytics });
    expect(h.retries).toEqual([{ index: 0, options: { delaySeconds: 30 } }]);
    expect(h.acks).toEqual([]);
    expect(h.points).toEqual([]);
  });

  test("no data point holds the user id", async () => {
    const db = await dbWithUser();
    const h = harness(() => GOOD);
    await handleUsageBatch(h.batch, { DB: db, ANALYTICS: h.analytics });
    expect(JSON.stringify(h.points)).not.toContain("u1");
  });
});
