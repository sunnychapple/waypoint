import type { JobType, JobView } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";
import { creditsLabel } from "../config/config.ts";

// Cloud jobs this iPhone started (PR 20). The server forgets a job's result after 7 days and after DELETE; this
// table is how the app finds its jobs again (there is no GET /v1/jobs list) and what each one is for.

export type LocalJob = {
  id: string;
  type: JobType;
  sessionId: string | null;
  requestKey: string;
  state: JobView["state"];
  quoted: number;
  spent: number | null;
  resultReady: boolean;
  detail: string; // JSON the job's card defines (for example the research question); never the text sent
  savedAt: number | null;
  deletedAt: number | null;
  problem: "unreadable" | null;
  createdAt: number;
  updatedAt: number;
};

type Row = {
  id: string;
  type: JobType;
  session_id: string | null;
  request_key: string;
  state: JobView["state"];
  quoted: number;
  spent: number | null;
  result_ready: number;
  detail: string;
  saved_at: number | null;
  deleted_at: number | null;
  problem: "unreadable" | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS = "id, type, session_id, request_key, state, quoted, spent, result_ready, detail, saved_at, deleted_at, problem, created_at, updated_at";

function fromRow(r: Row): LocalJob {
  return {
    id: r.id,
    type: r.type,
    sessionId: r.session_id,
    requestKey: r.request_key,
    state: r.state,
    quoted: r.quoted,
    spent: r.spent,
    resultReady: r.result_ready === 1,
    detail: r.detail,
    savedAt: r.saved_at,
    deletedAt: r.deleted_at,
    problem: r.problem,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// The job POST /v1/jobs returned. A repeat of the same job (same id) only refreshes its state.
export function recordJob(db: SqlDb, job: JobView, info: { sessionId: string | null; requestKey: string; detail: unknown; now: number }): void {
  db.run(
    `INSERT INTO jobs (id, type, session_id, request_key, state, quoted, spent, result_ready, detail, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET state = excluded.state, spent = excluded.spent, result_ready = excluded.result_ready, updated_at = excluded.updated_at`,
    [job.id, job.type, info.sessionId, info.requestKey, job.state, job.quoted, job.spent, job.result_ready ? 1 : 0, JSON.stringify(info.detail ?? {}), info.now, info.now],
  );
}

// A newer view of a job (events stream, GET /v1/jobs/:id). Unknown ids are ignored.
export function updateJob(db: SqlDb, job: JobView, now: number): void {
  db.run("UPDATE jobs SET state = ?, spent = ?, result_ready = ?, updated_at = ? WHERE id = ?", [job.state, job.spent, job.result_ready ? 1 : 0, now, job.id]);
}

export function getJob(db: SqlDb, id: string): LocalJob | null {
  const row = db.get<Row>(`SELECT ${COLUMNS} FROM jobs WHERE id = ?`, [id]);
  return row === null ? null : fromRow(row);
}

export function listJobs(db: SqlDb, limit = 50): LocalJob[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM jobs ORDER BY created_at DESC LIMIT ?`, [limit]).map(fromRow);
}

export function jobsForSession(db: SqlDb, sessionId: string): LocalJob[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM jobs WHERE session_id = ? ORDER BY created_at DESC`, [sessionId]).map(fromRow);
}

export function markSaved(db: SqlDb, id: string, now: number): void {
  db.run("UPDATE jobs SET saved_at = COALESCE(saved_at, ?), updated_at = ? WHERE id = ?", [now, now, id]);
}

// The result arrived but could not be opened or read on this iPhone: nothing more can be done with it.
export function markUnreadable(db: SqlDb, id: string, now: number): void {
  db.run("UPDATE jobs SET problem = 'unreadable', saved_at = COALESCE(saved_at, ?), updated_at = ? WHERE id = ?", [now, now, id]);
}

// Merges keys into the job's detail JSON (an upload's progress, for example).
export function setDetail(db: SqlDb, id: string, detail: Record<string, unknown>, now: number): void {
  const job = getJob(db, id);
  if (job === null) return;
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(job.detail);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch {
    current = {};
  }
  db.run("UPDATE jobs SET detail = ?, updated_at = ? WHERE id = ?", [JSON.stringify({ ...current, ...detail }), now, id]);
}

export const JOB_LABELS: Record<JobType, string> = {
  research: "Research",
  overview_script: "Audio overview",
  video_slides: "Video overview",
  diagram: "Diagram",
  mini_app: "Mini app",
  practice: "Practice set",
  retranscribe: "Better transcript",
};

// One line for the jobs list and the job screen.
export function jobLine(job: LocalJob): string {
  if (job.problem === "unreadable") return "Couldn't open the result on this iPhone";
  switch (job.state) {
    case "queued":
    case "running":
      return "Working on it";
    case "succeeded":
      if (job.savedAt !== null) return `Ready · ${creditsLabel(job.spent ?? job.quoted)}`;
      // Deleted before its result was saved: it finished just as it was cancelled, or its result had expired.
      return job.deletedAt !== null ? `Finished, but the result is gone · ${creditsLabel(job.spent ?? job.quoted)}` : "Getting the result";
    case "failed":
      return "Didn't work · nothing charged";
    case "cancelled":
      return job.spent !== null && job.spent > 0 ? `Cancelled · ${creditsLabel(job.spent)} used` : "Cancelled · nothing charged";
  }
}

export function markDeleted(db: SqlDb, id: string, now: number): void {
  db.run("UPDATE jobs SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?", [now, now, id]);
}

// What the app still has to do for a job, in order.
export type JobNext = "follow" | "fetch" | "delete" | "done";

export function nextStep(job: LocalJob): JobNext {
  if (job.deletedAt !== null) return "done";
  if (job.state === "queued" || job.state === "running") return "follow";
  if (job.state === "succeeded" && job.resultReady && job.savedAt === null) return "fetch";
  // Saved, or finished without a result (failed, cancelled, or the result is gone): tell the server we are done.
  return "delete";
}

// Jobs to pick up again at launch: anything not done.
export function openJobs(db: SqlDb): LocalJob[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM jobs WHERE deleted_at IS NULL ORDER BY created_at`).map(fromRow).filter((j) => nextStep(j) !== "done");
}
