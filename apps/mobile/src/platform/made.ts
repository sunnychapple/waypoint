import { JOB_TEXT_MAX_CHARS } from "@waypoint/contracts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { saveMade, type MadeKind } from "../core/made/made.ts";
import { notesAreCut, notesForResearch } from "../core/research/research.ts";
import { getDb } from "./db.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

// The session's text for a made item, cut at the type's cap.
export function madeText(sessionId: string, kind: MadeKind): string {
  return notesForResearch(getDb(), sessionId, JOB_TEXT_MAX_CHARS[kind]);
}

export function madeTextIsCut(sessionId: string, kind: MadeKind): boolean {
  return notesAreCut(getDb(), sessionId, JOB_TEXT_MAX_CHARS[kind]);
}

export function startMade(kind: MadeKind, sessionId: string, key: string, prompt: string | null): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const text = madeText(sessionId, kind);
  const request = prompt === null || prompt.trim() === "" ? { type: kind, text } : { type: kind, text, prompt: prompt.trim() };
  return startJob({ request, key, sessionId, detail: { kind } });
}

RESULT_SAVERS.practice = (db, job, text) => saveMade(db, "practice", job, text, Date.now());
RESULT_SAVERS.diagram = (db, job, text) => saveMade(db, "diagram", job, text, Date.now());
RESULT_SAVERS.mini_app = (db, job, text) => saveMade(db, "mini_app", job, text, Date.now());
RESULT_ROUTES.practice = (job) => `/practice/${job.id}`;
RESULT_ROUTES.diagram = (job) => `/diagram/${job.id}`;
RESULT_ROUTES.mini_app = (job) => `/mini-app/${job.id}`;
