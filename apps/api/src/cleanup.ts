import type { Db } from "./storage.ts";

export const RESULTS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const TMP_AUDIO_KEEP_MS = 24 * 60 * 60 * 1000;
// Locked job input (PR 20). A job deletes its own when it ends; this catches the ones whose job never ended.
export const TMP_INPUT_KEEP_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_ROWS_KEEP_MS = 24 * 60 * 60 * 1000;
// A blob reservation (PR 29) whose upload never finished: the Worker stopped between the reservation and the end of
// the upload. After a day it no longer counts against the uploader's media storage.
export const PENDING_BLOB_KEEP_MS = 24 * 60 * 60 * 1000;
// The card's cap: a run deletes at most MAX_LIST_PAGES pages of 1,000 objects per prefix.
export const MAX_LIST_PAGES = 20;
// A safety limit on pages listed per prefix per run, so a run always ends.
export const MAX_SCAN_PAGES = 100;
const MAX_DELETES_PER_RUN = MAX_LIST_PAGES * 1000;

// The parts of an R2 bucket the cleanup uses. R2Bucket satisfies this type.
export type CleanupBucket = {
  list(options: { prefix: string; limit: number; cursor?: string }): Promise<{
    objects: { key: string; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
};

// Deletes objects under prefix uploaded before cutoff. Lists pages (following the cursor) until the listing ends,
// MAX_DELETES_PER_RUN objects are deleted, or MAX_SCAN_PAGES pages are listed. Each run starts from the top of the
// prefix; deleted objects leave the listing, so an old object not reached in one run is reached in a later one.
// Returns how many were deleted.
export async function deleteOlderThan(bucket: CleanupBucket, prefix: string, cutoff: number): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SCAN_PAGES && deleted < MAX_DELETES_PER_RUN; page++) {
    const listed = await bucket.list(cursor === undefined ? { prefix, limit: 1000 } : { prefix, limit: 1000, cursor });
    const old = listed.objects.filter((object) => object.uploaded.getTime() < cutoff).map((object) => object.key);
    if (old.length > 0) {
      await bucket.delete(old);
      deleted += old.length;
    }
    if (!listed.truncated || listed.cursor === undefined) break;
    cursor = listed.cursor;
  }
  return deleted;
}

export type CleanupEnv = { DB: Db; BUCKET: CleanupBucket };

export async function cleanup(
  env: CleanupEnv,
  now: number,
): Promise<{ results: number; tmp_audio: number; tmp_input: number; idempotency: number; request_nonces: number; pending_blobs: number }> {
  const results = await deleteOlderThan(env.BUCKET, "results/", now - RESULTS_KEEP_MS);
  const tmpAudio = await deleteOlderThan(env.BUCKET, "tmp/audio/", now - TMP_AUDIO_KEEP_MS);
  const tmpInput = await deleteOlderThan(env.BUCKET, "tmp/input/", now - TMP_INPUT_KEEP_MS);
  const idempotency = await env.DB.prepare("DELETE FROM idempotency WHERE created_at < ?").bind(now - IDEMPOTENCY_ROWS_KEEP_MS).run();
  // Nonces of signed requests (S1A) whose timestamp has left the 5-minute window.
  const nonces = await env.DB.prepare("DELETE FROM request_nonces WHERE expires_at < ?").bind(now).run();
  const pendingBlobs = await env.DB.prepare("DELETE FROM blobs WHERE stored_at IS NULL AND created_at < ?").bind(now - PENDING_BLOB_KEEP_MS).run();
  return {
    results,
    tmp_audio: tmpAudio,
    tmp_input: tmpInput,
    idempotency: idempotency.meta.changes,
    request_nonces: nonces.meta.changes,
    pending_blobs: pendingBlobs.meta.changes,
  };
}
