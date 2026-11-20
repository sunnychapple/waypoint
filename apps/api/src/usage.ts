import type { InstantTask, JobType } from "@waypoint/contracts";
import type { Tier } from "@waypoint/router";

// One event per finished cloud task: instant tasks (PR 14, 15) and jobs (PR 20 on). PR 33 writes each one to
// D1 activity and Analytics Engine. Sizes, credits and route only: never the text sent or the answer.
export type UsageEvent = {
  v: 1;
  // The task's hold id. Unique per run, so a redelivered event is written once.
  id: string;
  at: number;
  user_id: string;
  task: InstantTask | JobType | "sync_extra";
  // cancelled: the person cancelled a job (DELETE /v1/jobs/:id) before it finished; nothing is charged.
  outcome: "ok" | "model_failed" | "cancelled";
  credits: number;
  tier: Tier;
  model: string;
  retention: "standard" | "zero";
  router: "ok" | "failed" | "skipped";
  bytes_sent: number;
  tokens_in: number | null;
  tokens_out: number | null;
};

// The part of a Queue producer binding this Worker uses. Queue<UsageEvent> satisfies this type.
export type UsageQueue = { send(event: UsageEvent): Promise<unknown> };

// A lost usage event must never fail or change the person's request.
export async function sendUsage(queue: UsageQueue, event: UsageEvent): Promise<void> {
  try {
    await queue.send(event);
  } catch {
    // Dropped; the wallet ledger still has the charge.
  }
}
