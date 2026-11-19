import { decodePublicKey, MAX_RESULT_BYTES, sealResult } from "@waypoint/crypto";
import type { Db } from "../storage.ts";

// The part of R2 this module uses. R2Bucket satisfies this type.
export type ResultBucket = {
  put(key: string, value: Uint8Array, options: { customMetadata: Record<string, string> }): Promise<unknown>;
};

export class SealError extends Error {
  constructor(readonly reason: "no_job" | "no_device" | "too_large") {
    super(`cannot seal result: ${reason}`);
    this.name = "SealError";
  }
}

type Target = { device_id: string; box_pub: string };

// Seals a finished job's result to the device that asked for it, stores it at results/{job}, and records the key.
// The caller must not keep, log or return the plaintext; this function overwrites it with zeros.
export async function sealJobResult(
  deps: { db: Db; bucket: ResultBucket },
  input: { jobId: string; plaintext: Uint8Array },
): Promise<{ result_key: string; bytes: number }> {
  try {
    if (input.plaintext.length > MAX_RESULT_BYTES) throw new SealError("too_large");
    const job = await deps.db.prepare("SELECT user_id, device_id FROM jobs WHERE id = ?").bind(input.jobId).first<{ user_id: string; device_id: string | null }>();
    if (job === null) throw new SealError("no_job");
    const target =
      job.device_id === null
        ? null
        : await deps.db
            .prepare(
              "SELECT id AS device_id, box_pub FROM devices WHERE id = ? AND user_id = ? AND kind = 'device' AND approved_at IS NOT NULL AND removed_at IS NULL",
            )
            .bind(job.device_id, job.user_id)
            .first<Target>();
    if (target === null) throw new SealError("no_device");
    const sealed = await sealResult({
      jobId: input.jobId,
      deviceId: target.device_id,
      deviceBoxPub: decodePublicKey(target.box_pub),
      plaintext: input.plaintext,
    });
    const key = `results/${input.jobId}`;
    await deps.bucket.put(key, sealed, { customMetadata: { format: "sealed-result-v1", device_id: target.device_id } });
    await deps.db.prepare("UPDATE jobs SET result_key = ? WHERE id = ?").bind(key, input.jobId).run();
    return { result_key: key, bytes: sealed.length };
  } finally {
    input.plaintext.fill(0);
  }
}
