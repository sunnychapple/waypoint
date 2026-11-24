import { JOB_PROBLEM_MAX_CHARS, JOB_TEXT_MAX_CHARS, ProblemHelpResultSchema, type CreateJobRequest, type ProblemHelpResult } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";
import type { HelpDraft } from "./drafts.ts";
import type { Problem } from "./help.ts";

// Step-by-step help on one problem from NotePath's cloud (job type problem_help). Asked for only with a tap that shows
// the price and what is sent. The answer is kept on this iPhone only, like a practice set: it is sealed to this iPhone
// and is not synced to the other members of a shared space.

export type ProblemHelpRequest = Extract<CreateJobRequest, { type: "problem_help" }>;

// What is sent: the problem and the text around it on its page, each cut to the server's cap.
export function cloudHelpRequest(problem: Problem): ProblemHelpRequest {
  return {
    type: "problem_help",
    problem: problem.text.slice(0, JOB_PROBLEM_MAX_CHARS).trim(),
    text: problem.context.slice(0, JOB_TEXT_MAX_CHARS.problem_help).trim(),
  };
}

// Where the problem came from, kept in the job's detail so the result and "Try again" can find it again.
// block is null for a problem the student typed.
export type HelpWhere = { captureId: string; block: number | null; problem: string };

export function helpWhere(detail: string): HelpWhere | null {
  let value: unknown;
  try {
    value = JSON.parse(detail);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { captureId, block, problem } = value as Record<string, unknown>;
  if (typeof captureId !== "string" || typeof problem !== "string") return null;
  return { captureId, block: typeof block === "number" && Number.isInteger(block) && block >= 0 ? block : null, problem };
}

export type CloudHelp = { id: string; sessionId: string | null; captureId: string | null; problem: string; result: ProblemHelpResult; createdAt: number };

type Row = { id: string; session_id: string | null; capture_id: string | null; problem: string; body: string; created_at: number };

// The opened result of a problem_help job (RESULT_SAVERS). Throws when it is not the contract, so the job is marked unreadable.
// Saves nothing, without throwing, when the job's session or its page was deleted while the job ran.
export function saveCloudHelp(db: SqlDb, job: { id: string; sessionId: string | null; detail: string }, text: string, now: number): void {
  const result = ProblemHelpResultSchema.parse(JSON.parse(text));
  const where = helpWhere(job.detail);
  // The session or the page may have been deleted while the job ran. The answer is made from them, so it is not kept
  // without them: nothing is inserted, and this returns without throwing.
  if (job.sessionId !== null && db.get("SELECT id FROM sessions WHERE id = ?", [job.sessionId]) === null) return;
  if (where !== null && db.get("SELECT id FROM captures WHERE id = ?", [where.captureId]) === null) return;
  db.run("INSERT OR REPLACE INTO help_answers (id, session_id, capture_id, problem, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    job.id,
    job.sessionId,
    where?.captureId ?? null,
    where?.problem ?? "",
    JSON.stringify(result),
    now,
  ]);
}

export function getCloudHelp(db: SqlDb, id: string): CloudHelp | null {
  const row = db.get<Row>("SELECT id, session_id, capture_id, problem, body, created_at FROM help_answers WHERE id = ?", [id]);
  if (row === null) return null;
  const result = ProblemHelpResultSchema.safeParse(JSON.parse(row.body));
  if (!result.success) return null;
  return { id: row.id, sessionId: row.session_id, captureId: row.capture_id, problem: row.problem, result: result.data, createdAt: row.created_at };
}

// The cloud's help in the shape the step screen shows: each step, with its why under it. null when the cloud could not
// read the problem.
export function cloudHelpDraft(result: ProblemHelpResult): HelpDraft | null {
  if (!result.readable) return null;
  return { steps: result.steps.map((step) => ({ title: step.step, detail: step.why })), answer: result.answer };
}
