import { RESULTS_KEEP_MS } from "../cleanup.ts";
import { sendPush } from "../push/messages.ts";
import type { Db } from "../storage.ts";
import { sendUsage } from "../usage.ts";
import { deleteJobInputs, resultObjectKey, type JobDeps } from "./job.ts";
import type { SealError } from "./seal.ts";
import type { JobRunInput } from "./start.ts";

// How one Workflow step is retried and how long it may run (ms). WorkflowStepConfig accepts this shape.
export type StepConfig = {
  retries: { limit: number; delay: number; backoff: "constant" | "linear" | "exponential" };
  timeout: number;
};

// The part of a Workflow step this module uses. Each Workflow class adapts its WorkflowStep to it; tests pass a fake
// that runs fn once. A step's return value is stored by Workflows, so it must never hold note text.
export type Steps = {
  do<T extends Rpc.Serializable<T>>(name: string, config: StepConfig, fn: () => Promise<T>): Promise<T>;
};

// D1, R2 and wallet steps: no model call, so retried often.
export const BOOKKEEPING_STEP: StepConfig = { retries: { limit: 5, delay: 2_000, backoff: "exponential" }, timeout: 60_000 };

export type FailReason = "model_failed" | "no_input" | "no_upload" | "no_route" | "deadline" | SealError["reason"];

// What the step that makes the result returns: the R2 key and sizes, never text.
export type Made =
  | { ok: true; result_key: string; credits: number; bytes_sent: number; tokens_in: number | null; tokens_out: number | null }
  | { ok: false; reason: FailReason; tokens_in: number | null; tokens_out: number | null };

export type Finished = { ok: boolean; charged: number; device_id: string | null };

export function failed(
  reason: FailReason,
  tokens: { tokens_in: number | null; tokens_out: number | null } = { tokens_in: null, tokens_out: null },
): Made {
  return { ok: false, reason, tokens_in: tokens.tokens_in, tokens_out: tokens.tokens_out };
}

// queued -> running (running stays running, for a retried step). False when the job was cancelled.
export async function markRunning(db: Db, jobId: string): Promise<boolean> {
  const updated = await db.prepare("UPDATE jobs SET state = 'running' WHERE id = ? AND state IN ('queued', 'running')").bind(jobId).run();
  return updated.meta.changes === 1;
}

// Settles the hold at the made result's credits (never above the quote) or releases it, and records the job's end.
// A result whose hold is gone (expired, or released by a cancel) is deleted and the job fails.
export async function finishJob(deps: JobDeps, input: JobRunInput, made: Made): Promise<Finished> {
  const now = deps.now();
  const resultKey = resultObjectKey(input.job_id);
  if (made.ok) {
    const settled = await deps.wallet.apply({
      type: "settle",
      id: input.settle_id,
      hold_id: input.hold_id,
      actual: Math.min(made.credits, input.credits),
    });
    if (settled.ok && "charged" in settled) {
      // 'succeeded' too, so a retried finish step finds its own row again.
      const updated = await deps.db
        .prepare(
          "UPDATE jobs SET state = 'succeeded', spent = ?, finished_at = ?, expires_at = ? WHERE id = ? AND state IN ('running', 'succeeded')",
        )
        .bind(settled.charged, now, now + RESULTS_KEEP_MS, input.job_id)
        .run();
      if (updated.meta.changes === 1) {
        const job = await deps.db.prepare("SELECT device_id FROM jobs WHERE id = ?").bind(input.job_id).first<{ device_id: string | null }>();
        return { ok: true, charged: settled.charged, device_id: job?.device_id ?? null };
      }
      // Cancelled while it ran: the work was done and stays charged, but nobody may fetch the result.
      await deps.bucket.delete(resultKey);
      return { ok: false, charged: settled.charged, device_id: null };
    }
    await deps.bucket.delete(resultKey);
  } else {
    await deps.wallet.apply({ type: "release", id: input.release_id, hold_id: input.hold_id });
  }
  await deps.db
    .prepare("UPDATE jobs SET state = 'failed', spent = 0, finished_at = ?, result_key = NULL WHERE id = ? AND state IN ('queued', 'running')")
    .bind(now, input.job_id)
    .run();
  return { ok: false, charged: 0, device_id: null };
}

// The push (only for a result that is ready) and then the usage event. Neither holds any text.
export async function notifyJob(deps: JobDeps, input: JobRunInput, made: Made, finished: Finished): Promise<void> {
  if (finished.ok && finished.device_id !== null) {
    await sendPush(deps.push, { user_id: input.user_id, kind: "job_ready", ref: input.job_id, device_id: finished.device_id });
  }
  await sendUsage(deps.usage, {
    v: 1,
    id: input.hold_id,
    at: deps.now(),
    user_id: input.user_id,
    task: input.type,
    outcome: finished.ok ? "ok" : "model_failed",
    credits: finished.charged,
    tier: input.tier,
    model: input.model,
    retention: input.retention,
    router: "skipped",
    bytes_sent: made.ok ? made.bytes_sent : input.bytes_sent,
    tokens_in: made.tokens_in,
    tokens_out: made.tokens_out,
  });
}

// One job from start to end: start, make (the only step that sees plaintext; it seals the result itself), cleanup
// (deletes what the person sent: the locked input and any audio parts), finish (settle or release), notify.
// Returns whether a result was delivered.
export async function runJob(deps: JobDeps, steps: Steps, input: JobRunInput, make: { config: StepConfig; run: () => Promise<Made> }): Promise<boolean> {
  const running = await steps.do("start", BOOKKEEPING_STEP, () => markRunning(deps.db, input.job_id));
  if (!running) {
    await steps.do("cleanup", BOOKKEEPING_STEP, async () => {
      await deleteJobInputs(deps.bucket, input.job_id);
      return true;
    });
    return false;
  }
  let made: Made;
  try {
    made = await steps.do("make", make.config, async () => (deps.now() > input.deadline ? failed("deadline") : make.run()));
  } catch {
    // The make step threw on every try (model failure, invalid reply): nothing to settle.
    made = failed("model_failed");
  }
  await steps.do("cleanup", BOOKKEEPING_STEP, async () => {
    await deleteJobInputs(deps.bucket, input.job_id);
    return true;
  });
  const finished = await steps.do("finish", BOOKKEEPING_STEP, () => finishJob(deps, input, made));
  await steps.do("notify", BOOKKEEPING_STEP, async () => {
    await notifyJob(deps, input, made, finished);
    return true;
  });
  return finished.ok;
}
