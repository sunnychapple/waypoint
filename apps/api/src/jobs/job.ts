import type { JobState, JobType, JobView } from "@waypoint/contracts";
import { context, sha256, toBase64Url } from "@waypoint/crypto";
import type { Tier } from "@waypoint/router";
import type { WalletCommands } from "../apple/purchases.ts";
import type { Env } from "../env.ts";
import type { PushQueue } from "../push/messages.ts";
import type { Db } from "../storage.ts";
import { HOLD_MARGIN_MS } from "../tasks/instant.ts";
import { sendUsage, type UsageQueue } from "../usage.ts";
import { JOB_INPUT_PREFIX } from "./input.ts";

// The parts of R2 the jobs code uses. R2Bucket satisfies this type.
export type JobBucket = {
  get(key: string): Promise<{ body: ReadableStream; size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; limit: number }): Promise<{ objects: { key: string }[] }>;
};

// Everything that runs or ends a job needs: the routes (cancelJob) and every job Workflow (PR 22A's runJob).
export type JobDeps = {
  db: Db;
  bucket: JobBucket;
  wallet: WalletCommands;
  usage: UsageQueue;
  push: PushQueue;
  now: () => number;
};

export function jobDeps(env: Env, billingAccountId: string, now: () => number): JobDeps {
  return {
    db: env.DB,
    bucket: env.BUCKET,
    wallet: env.WALLET.get(env.WALLET.idFromName(billingAccountId)),
    usage: env.USAGE_QUEUE,
    push: env.PUSH_QUEUE,
    now,
  };
}

export type JobRow = {
  id: string;
  user_id: string;
  billing_account_id: string;
  type: JobType;
  state: JobState;
  quoted: number;
  spent: number | null;
  route: Tier;
  model: string;
  retention: "standard" | "zero";
  bytes_sent: number;
  result_key: string | null;
  device_id: string | null;
  command_key: string;
  created_at: number;
  deadline_at: number;
  finished_at: number | null;
  expires_at: number | null;
};

const JOB_COLUMNS =
  "j.id, j.user_id, u.billing_account_id, j.type, j.state, j.quoted, j.spent, j.route, j.model, j.retention, j.bytes_sent, j.result_key, j.device_id, j.command_key, j.created_at, j.deadline_at, j.finished_at, j.expires_at";

// One job, or null. With userId, only that user's job.
export async function loadJob(db: Db, jobId: string, userId?: string): Promise<JobRow | null> {
  const where = userId === undefined ? "j.id = ?" : "j.id = ? AND j.user_id = ?";
  const values = userId === undefined ? [jobId] : [jobId, userId];
  return db
    .prepare(`SELECT ${JOB_COLUMNS} FROM jobs j JOIN users u ON u.id = j.user_id WHERE ${where}`)
    .bind(...values)
    .first<JobRow>();
}

// The job id is made from the user and the Idempotency-Key, so a request that is run again finds its own job.
export async function jobIdFor(userId: string, key: string): Promise<string> {
  const digest = await sha256(context("job-id", userId, key));
  return `job_${toBase64Url(digest.slice(0, 16))}`;
}

// The wallet command ids of a job (op at most 24 characters, docs/build-plan.md "Conventions").
export function jobWalletIds(userId: string, key: string): { hold: string; settle: string; release: string } {
  return { hold: `job:${userId}:${key}`, settle: `job_settle:${userId}:${key}`, release: `job_release:${userId}:${key}` };
}

export const resultObjectKey = (jobId: string): string => `results/${jobId}`;
// The second transcript's audio, one object per recording part: tmp/audio/{job}/{n} (PR 23).
export const audioPrefix = (jobId: string): string => `tmp/audio/${jobId}/`;

// Deletes what the person sent with a job: its locked input and any uploaded audio parts (at most 1,000, one
// listing page; PR 23 allows 200). Every job Workflow calls it when the job ends, and so does cancelJob.
export async function deleteJobInputs(bucket: JobBucket, jobId: string): Promise<void> {
  const listed = await bucket.list({ prefix: audioPrefix(jobId), limit: 1000 });
  await bucket.delete([`${JOB_INPUT_PREFIX}${jobId}`, ...listed.objects.map((object) => object.key)]);
}

// A queued or running job whose hold has expired has stopped, whatever its row says.
export function isOverdue(job: Pick<JobRow, "state" | "deadline_at">, now: number): boolean {
  return (job.state === "queued" || job.state === "running") && now > job.deadline_at + HOLD_MARGIN_MS;
}

export function jobView(job: JobRow, now: number): JobView {
  return {
    id: job.id,
    type: job.type,
    state: isOverdue(job, now) ? "failed" : job.state,
    quoted: job.quoted,
    spent: job.spent,
    tier: job.route,
    retention: job.retention,
    result_ready: job.state === "succeeded" && job.result_key !== null && (job.expires_at === null || now < job.expires_at),
    created_at: job.created_at,
    finished_at: job.finished_at,
    expires_at: job.expires_at,
  };
}

// DELETE /v1/jobs/:id. A queued or running job is stopped (stop terminates its Workflow instance; errors ignored)
// and its hold released: nothing is charged, and one usage event says "cancelled". A finished job keeps what it was
// charged. Either way the result, the locked input and any uploaded audio are deleted.
export async function cancelJob(deps: JobDeps, job: JobRow, stop: () => Promise<void>): Promise<void> {
  const now = deps.now();
  if (job.state === "queued" || job.state === "running") {
    await stop().catch(() => undefined);
    const ids = jobWalletIds(job.user_id, job.command_key);
    const released = await deps.wallet.apply({ type: "release", id: ids.release, hold_id: ids.hold });
    if (released.ok) {
      const { meta } = await deps.db
        .prepare("UPDATE jobs SET state = 'cancelled', spent = 0, finished_at = ? WHERE id = ? AND state IN ('queued', 'running')")
        .bind(now, job.id)
        .run();
      if (meta.changes === 1) {
        await sendUsage(deps.usage, {
          v: 1,
          id: ids.hold,
          at: now,
          user_id: job.user_id,
          task: job.type,
          outcome: "cancelled",
          credits: 0,
          tier: job.route,
          model: job.model,
          retention: job.retention,
          router: "skipped",
          bytes_sent: job.bytes_sent,
          tokens_in: null,
          tokens_out: null,
        });
      }
    } else if (isOverdue(job, now)) {
      // The hold expired with the job unfinished.
      await deps.db
        .prepare("UPDATE jobs SET state = 'failed', spent = 0, finished_at = ? WHERE id = ? AND state IN ('queued', 'running')")
        .bind(now, job.id)
        .run();
    }
    // Otherwise the job settled a moment ago; its Workflow marks it succeeded and the credits stay charged.
  }
  await deleteJobInputs(deps.bucket, job.id);
  await deps.bucket.delete(resultObjectKey(job.id));
  await deps.db.prepare("UPDATE jobs SET result_key = NULL WHERE id = ?").bind(job.id).run();
}
