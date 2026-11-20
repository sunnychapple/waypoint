import { File, Paths } from "expo-file-system";
import { MAX_AUDIO_CHUNK_BYTES, RetranscribeResultSchema } from "@waypoint/contracts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { audioMinutes, saveCloudTranscript, uploadParts } from "../core/capture/second.ts";
import { setDetail, type LocalJob } from "../core/jobs/jobs.ts";
import { api } from "./api.ts";
import { getDb, writeDb } from "./db.ts";
import { startJob } from "./jobs.ts";
import { BEFORE_FOLLOW, RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";

// The most the server takes (QuoteRequestSchema: minutes ≤ 600; MAX_AUDIO_CHUNKS: 200 parts).
export const MAX_SECOND_MINUTES = 600;

export type SecondPlan = { minutes: number; parts: number; bytes: number } | null;

// What a second transcript of this session would send. null: no audio parts.
export function secondPlan(sessionId: string): SecondPlan {
  const parts = uploadParts(getDb(), sessionId);
  if (parts.length === 0) return null;
  const bytes = parts.reduce((sum, p) => sum + (new File(Paths.document, p.file).size ?? 0), 0);
  return { minutes: audioMinutes(parts), parts: parts.length, bytes };
}

// key: made when the sheet opened; the same key on "Try again" after Out of credits.
export async function startSecondTranscript(sessionId: string, key: string): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const plan = secondPlan(sessionId);
  if (plan === null || plan.minutes > MAX_SECOND_MINUTES) return { ok: false, failure: { kind: "failed" } };
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
      await api.deleteJob(job.id); // nothing is charged; the job screen shows it cancelled
      throw new Error("audio part missing or too large");
    }
    await api.uploadAudio(job.id, n, bytes);
    writeDb((db) => setDetail(db, job.id, { uploaded: n + 1 }, Date.now()));
  }
  await api.audioDone(job.id, parts.length);
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
