import type { SqlDb } from "../db/sql.ts";

// The Review tab's two lists of made things: what is being made now (cloud jobs still working) and what is ready
// (finished overviews, practice sets, research, diagrams and mini apps from the last 14 days).

export type MadeThing = "audio" | "video" | "practice" | "research" | "diagram" | "mini_app";

// The words the session's made list and its tool buttons use.
export const MADE_LABELS: Record<MadeThing, string> = {
  audio: "Audio overview",
  video: "Video overview",
  practice: "Practice set",
  research: "Research",
  diagram: "Diagram",
  mini_app: "Mini app",
};

// Where each finished thing opens (the same routes the session's made list uses).
export function viewerRoute(kind: MadeThing, id: string): string {
  const prefix: Record<MadeThing, string> = {
    audio: "/overview/",
    video: "/video/",
    practice: "/practice/",
    research: "/research/",
    diagram: "/diagram/",
    mini_app: "/mini-app/",
  };
  return `${prefix[kind]}${encodeURIComponent(id)}`;
}

export const READY_DAYS = 14;
export const READY_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

// Diagrams and mini apps are listed only while their flags are on (as the session's made list does).
export type MadeFlags = { miniApps: boolean; diagrams: boolean };

export type BeingMade = { id: string; kind: MadeThing; sessionTitle: string | null; createdAt: number };
export type ReadyThing = { id: string; kind: MadeThing; title: string; sessionId: string | null; createdAt: number };

// A cloud job row as the queries below return it. Job types that are not made things (second transcripts) are dropped.
export type WorkingJobRow = { id: string; type: string; sessionTitle: string | null; createdAt: number };
export type FinishedRow = { id: string; kind: MadeThing; title: string; sessionId: string | null; createdAt: number };

const JOB_KIND: Record<string, MadeThing | undefined> = {
  overview_script: "audio",
  video_slides: "video",
  research: "research",
  practice: "practice",
  diagram: "diagram",
  mini_app: "mini_app",
};

function allowed(kind: MadeThing, flags: MadeFlags): boolean {
  if (kind === "mini_app") return flags.miniApps;
  if (kind === "diagram") return flags.diagrams;
  return true;
}

// Jobs in progress, newest first.
// A job whose result is already saved (its finished row has the same id) is not also listed as working.
export function beingMadeItems(rows: WorkingJobRow[], flags: MadeFlags, finishedIds: ReadonlySet<string> = new Set()): BeingMade[] {
  const items: BeingMade[] = [];
  for (const row of rows) {
    if (finishedIds.has(row.id)) continue;
    const kind = JOB_KIND[row.type];
    if (kind === undefined || !allowed(kind, flags)) continue;
    items.push({ id: row.id, kind, sessionTitle: row.sessionTitle, createdAt: row.createdAt });
  }
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

// Finished things made in the last 14 days, newest first, at most 8.
export function readyItems(rows: FinishedRow[], now: number, flags: MadeFlags): ReadyThing[] {
  const cutoff = now - READY_DAYS * DAY_MS;
  return rows
    .filter((row) => row.createdAt >= cutoff && allowed(row.kind, flags))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, READY_LIMIT);
}

// Queries. Jobs that are queued or running and not deleted; overviews only once their voices are rendered.
// A job still "working" after a day is stale (the server gave up on it or lost it), so it is not listed.
export const WORKING_MAX_HOURS = 24;

export function listWorkingJobs(db: SqlDb, now: number): WorkingJobRow[] {
  return db
    .all<{ id: string; type: string; session_title: string | null; created_at: number }>(
      `SELECT j.id, j.type, s.title AS session_title, j.created_at
       FROM jobs j LEFT JOIN sessions s ON s.id = j.session_id
       WHERE j.state IN ('queued', 'running') AND j.deleted_at IS NULL AND j.type != 'retranscribe' AND j.created_at >= ?
       ORDER BY j.created_at DESC`,
      [now - WORKING_MAX_HOURS * 60 * 60 * 1000],
    )
    .map((r) => ({ id: r.id, type: r.type, sessionTitle: r.session_title, createdAt: r.created_at }));
}

export function listFinished(db: SqlDb, now: number): FinishedRow[] {
  const cutoff = now - READY_DAYS * DAY_MS;
  const made = db
    .all<{ id: string; kind: "diagram" | "mini_app" | "practice"; title: string; session_id: string | null; created_at: number }>(
      "SELECT id, kind, title, session_id, created_at FROM made WHERE created_at >= ?",
      [cutoff],
    )
    .map((r) => ({ id: r.id, kind: r.kind, title: r.title, sessionId: r.session_id, createdAt: r.created_at }));
  const overviews = db
    .all<{ id: string; kind: "audio" | "video"; title: string; session_id: string | null; created_at: number }>(
      "SELECT id, kind, title, session_id, created_at FROM overviews WHERE state = 'ready' AND created_at >= ?",
      [cutoff],
    )
    .map((r) => ({ id: r.id, kind: r.kind, title: r.title, sessionId: r.session_id, createdAt: r.created_at }));
  const research = db
    .all<{ id: string; question: string; session_id: string | null; created_at: number }>(
      "SELECT id, question, session_id, created_at FROM research WHERE created_at >= ?",
      [cutoff],
    )
    .map((r) => ({ id: r.id, kind: "research" as const, title: r.question, sessionId: r.session_id, createdAt: r.created_at }));
  return [...made, ...overviews, ...research];
}
