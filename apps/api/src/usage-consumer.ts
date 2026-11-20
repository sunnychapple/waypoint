import { INSTANT_TASKS, JOB_TYPES } from "@waypoint/contracts";
import { TIERS } from "@waypoint/router";
import { z } from "zod";
import type { QueueBatch } from "./queue.ts";
import type { Db } from "./storage.ts";
import type { UsageEvent } from "./usage.ts";

export const USAGE_QUEUE_NAME = "waypoint-usage";

// Checks a message on the usage queue. It is exactly the UsageEvent that src/usage.ts (PR 14) sends:
// `satisfies` and the test's eventFits check fail to compile if the two drift apart.
export const UsageEventSchema = z.strictObject({
  v: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9_:-]{1,128}$/),
  at: z.number().int().min(0),
  user_id: z.string().min(1).max(128),
  task: z.enum([...INSTANT_TASKS, ...JOB_TYPES]),
  outcome: z.enum(["ok", "model_failed", "cancelled"]),
  credits: z.number().int().min(0),
  tier: z.enum(TIERS),
  model: z.string().min(1).max(256),
  retention: z.enum(["standard", "zero"]),
  router: z.enum(["ok", "failed", "skipped"]),
  bytes_sent: z.number().int().min(0),
  tokens_in: z.number().int().min(0).nullable(),
  tokens_out: z.number().int().min(0).nullable(),
}) satisfies z.ZodType<UsageEvent>;

// The part of an Analytics Engine dataset this Worker uses. AnalyticsEngineDataset satisfies this type.
export type UsageDataset = { writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void };

export type UsageEnv = { DB: Db; ANALYTICS: UsageDataset };

// Writes each event to D1 activity (what GET /v1/activity shows the person; route is the tier) and, the first
// time only, one Analytics Engine data point with no user id:
//   indexes [task]; blobs [task, tier, retention, outcome, model, router];
//   doubles [credits, bytes_sent, tokens_in, tokens_out] (a token count the model did not report is -1).
export async function handleUsageBatch(batch: QueueBatch, env: UsageEnv): Promise<void> {
  for (const message of batch.messages) {
    const parsed = UsageEventSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack();
      continue;
    }
    const e = parsed.data;
    try {
      const { meta } = await env.DB.prepare(
        "INSERT INTO activity (id, user_id, task, bytes_sent, credits, route, retention, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
      )
        .bind(e.id, e.user_id, e.task, e.bytes_sent, e.credits, e.tier, e.retention, e.at)
        .run();
      if (meta.changes === 1) {
        env.ANALYTICS.writeDataPoint({
          indexes: [e.task],
          blobs: [e.task, e.tier, e.retention, e.outcome, e.model, e.router],
          doubles: [e.credits, e.bytes_sent, e.tokens_in ?? -1, e.tokens_out ?? -1],
        });
      }
      message.ack();
    } catch {
      message.retry({ delaySeconds: 30 });
    }
  }
}
