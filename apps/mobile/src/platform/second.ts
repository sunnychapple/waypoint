import { File, Paths } from "expo-file-system";
import { MAX_AUDIO_CHUNK_BYTES, RetranscribeResultSchema } from "@waypoint/contracts";
import { ApiCallError } from "@waypoint/api-client";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { audioMinutes, saveCloudTranscript, uploadParts } from "../core/capture/second.ts";
import { setDetail, type LocalJob } from "../core/jobs/jobs.ts";
import { api } from "./api.ts";
import { getDb, writeDb } from "./db.ts";
import { cancelJob, startJob } from "./jobs.ts";
import { BEFORE_FOLLOW, RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";

// The most the server takes (QuoteRequestSchema: minutes ≤ 600; MAX_AUDIO_CHUNKS: 200 parts).
export const MAX_SECOND_MINUTES = 600;

// complete: every part is on this iPhone and within the size the server takes. Otherwise nothing may be sent.
export type SecondPlan = { minutes: number; parts: number; bytes: number; complete: boolean } | null;

// What a second transcript of this session would send. null: no audio parts.
export function secondPlan(sessionId: string): SecondPlan {
  const parts = uploadParts(getDb(), sessionId);
  if (parts.length === 0) return null;
  let bytes = 0;
  let complete = true;
  for (const p of parts) {
    const file = new File(Paths.document, p.file);
    const size = file.exists ? (file.size ?? 0) : 0;
    if (size === 0 || size > MAX_AUDIO_CHUNK_BYTES) complete = false;
    bytes += size;
  }
  return { minutes: audioMinutes(parts), parts: parts.length, bytes, complete };
}

// key: made when the sheet opened; the same key on "Try again" after Out of credits.
export async function startSecondTranscript(sessionId: string, key: string): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const plan = secondPlan(sessionId);
  if (plan === null || !plan.complete || plan.minutes > MAX_SECOND_MINUTES) return { ok: false, failure: { kind: "failed" } };
  return startJob({
    request: { type: "retranscribe", minutes: plan.minutes },
    key,
    sessionId,
    detail: { parts: plan.parts, uploaded: 0, done: false },
    sent: { type: "retranscribe", minutes: plan.minutes, parts: plan.parts, audio_bytes: plan.bytes },
  });
}

function progress(job: LocalJob): { uploaded: number; done: boolean } {
  try {
    const d = JSON.parse(job.detail) as { uploaded?: unknown; done?: unknown };
    return { uploaded: typeof d.uploaded === "number" ? d.uploaded : 0, done: d.done === true };
  } catch {
    return { uploaded: 0, done: false };
  }
}

// Uploads the parts not sent yet, then says it is done (PR 23). Runs before every follow of a retranscribe job, so an
// upload cut off by the app closing goes on from the next part.
async function uploadRest(job: LocalJob): Promise<void> {
  const { uploaded, done } = progress(job);
  if (done || job.state !== "queued" || job.sessionId === null) return;
  const parts = uploadParts(getDb(), job.sessionId);
  for (let n = uploaded; n < parts.length; n++) {
    const part = parts[n];
    if (part === undefined) break;
    const bytes = await new File(Paths.document, part.file).bytes();
    if (bytes.length === 0 || bytes.length > MAX_AUDIO_CHUNK_BYTES) {
      await cancelJob(job.id); // nothing is charged; the local job is recorded as cancelled
      return;
    }
    await api.uploadAudio(job.id, n, bytes);
    writeDb((db) => setDetail(db, job.id, { uploaded: n + 1 }, Date.now()));
  }
  // The key is stored with the job, so a repeat after a cut-off reply is the same request to the server.
  try {
    await api.audioDone(job.id, parts.length, `${job.requestKey}-done`);
  } catch (error) {
    // "upload closed" (409): an earlier "done" was already accepted, so there is nothing left to send.
    if (!(error instanceof ApiCallError && error.status === 409 && error.message === "upload closed")) throw error;
  }
  writeDb((db) => setDetail(db, job.id, { done: true }, Date.now()));
}

BEFORE_FOLLOW.retranscribe = uploadRest;
RESULT_SAVERS.retranscribe = (db, job, text) => {
  const result = RetranscribeResultSchema.parse(JSON.parse(text));
  if (job.sessionId === null) return;
  saveCloudTranscript(db, job.sessionId, uploadParts(db, job.sessionId), result);
  setDetail(db, job.id, { truncated: result.truncated }, Date.now());
};
RESULT_ROUTES.retranscribe = (job) => (job.sessionId === null ? "/jobs" : `/session/${job.sessionId}?view=second`);
