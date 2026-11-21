import { z } from "zod";
import type { SqlDb } from "../db/sql.ts";
import { listPages } from "../capture/pages.ts";

type Deps = { now: () => number; newId: () => string };

const ThreadItemSchema = z.strictObject({
  kind: z.enum(["explain", "more_detail", "double_check"]),
  text: z.string(),
  at: z.number().int(),
  retention: z.enum(["standard", "zero"]),
  sentId: z.string().min(1), // the sent_log id, which is the request's Idempotency-Key
});
const ThreadSchema = z.array(ThreadItemSchema);

export type ThreadItem = z.infer<typeof ThreadItemSchema>;
// captureId is the page the word was tapped on (null for a recording moment, and for explanations from before it existed).
export type Explanation = {
  id: string;
  sessionId: string;
  t: number;
  term: string;
  thread: ThreadItem[];
  saved: boolean;
  createdAt: number;
  captureId: string | null;
};

type Row = { id: string; session_id: string; t: number; term: string; thread: string; saved: number; created_at: number; capture_id: string | null };

function fromRow(row: Row): Explanation {
  const thread = ThreadSchema.parse(JSON.parse(row.thread));
  return { id: row.id, sessionId: row.session_id, t: row.t, term: row.term, thread, saved: row.saved === 1, createdAt: row.created_at, captureId: row.capture_id };
}

export function getExplanation(db: SqlDb, id: string): Explanation | null {
  const row = db.get<Row>("SELECT id, session_id, t, term, thread, saved, created_at, capture_id FROM explanations WHERE id = ?", [id]);
  return row === null ? null : fromRow(row);
}

// A new, unsaved explanation with an empty thread.
export function startExplanation(db: SqlDb, deps: Deps, sessionId: string, t: number, term: string, captureId?: string | null): Explanation {
  const id = deps.newId();
  db.run("INSERT INTO explanations (id, session_id, t, term, created_at, capture_id) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    sessionId,
    Math.max(0, Math.round(t)),
    term,
    deps.now(),
    captureId ?? null,
  ]);
  const made = getExplanation(db, id);
  if (made === null) throw new Error("explanation missing after insert");
  return made;
}

export function addToThread(db: SqlDb, id: string, item: ThreadItem): Explanation {
  const current = getExplanation(db, id);
  if (current === null) throw new Error("no such explanation");
  const thread = [...current.thread, ThreadItemSchema.parse(item)];
  db.run("UPDATE explanations SET thread = ? WHERE id = ?", [JSON.stringify(thread), id]);
  return { ...current, thread };
}

// Closing the sheet keeps only saved explanations. sent_log rows stay: they record what left the phone.
export function discardIfUnsaved(db: SqlDb, id: string): void {
  db.run("DELETE FROM explanations WHERE id = ? AND saved = 0", [id]);
}

// Save keeps the explanation after the sheet closes and adds the word to the session's terms, with the first answer
// as its meaning. Saving twice changes nothing.
export function saveExplanation(db: SqlDb, deps: Deps, id: string): void {
  db.transaction(() => saveExplanationNow(db, deps, id));
}

// The same save without its own transaction, for a caller that already runs inside one (transactions do not nest).
export function saveExplanationNow(db: SqlDb, deps: Deps, id: string): void {
  const e = getExplanation(db, id);
  if (e === null) throw new Error("no such explanation");
  const first = e.thread.find((item) => item.kind === "explain");
  if (first === undefined) throw new Error("nothing to save yet");
  db.run("UPDATE explanations SET saved = 1 WHERE id = ?", [id]);
  db.run("INSERT OR IGNORE INTO terms (id, session_id, explanation_id, term, meaning, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    deps.newId(),
    e.sessionId,
    id,
    e.term,
    first.text,
    deps.now(),
  ]);
}

// How many explanations are saved: Home shows "Saved answers" when there are no open questions.
export function countSavedExplanations(db: SqlDb): number {
  return db.get<{ n: number }>("SELECT count(*) AS n FROM explanations WHERE saved = 1")?.n ?? 0;
}

export function unsaveExplanation(db: SqlDb, id: string): void {
  db.transaction(() => {
    db.run("DELETE FROM terms WHERE explanation_id = ?", [id]);
    db.run("UPDATE explanations SET saved = 0 WHERE id = ?", [id]);
  });
}

export type SavedExplanation = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  t: number;
  term: string;
  answer: string;
  createdAt: number;
  captureId: string | null;
};

// Saved explanations, newest first. The answer is the first explain item of the thread, as saveExplanation stores it.
export function savedExplanations(db: SqlDb): SavedExplanation[] {
  return db
    .all<{ id: string; session_id: string; session_title: string; t: number; term: string; thread: string; created_at: number; capture_id: string | null }>(
      `SELECT e.id, e.session_id, s.title AS session_title, e.t, e.term, e.thread, e.created_at, e.capture_id
       FROM explanations e JOIN sessions s ON s.id = e.session_id
       WHERE e.saved = 1 ORDER BY e.created_at DESC`,
    )
    .map((row) => {
      const first = ThreadSchema.parse(JSON.parse(row.thread)).find((item) => item.kind === "explain");
      return {
        id: row.id,
        sessionId: row.session_id,
        sessionTitle: row.session_title,
        t: row.t,
        term: row.term,
        answer: first?.text ?? "",
        createdAt: row.created_at,
        captureId: row.capture_id,
      };
    });
}

// The first page (in page order) whose found text contains the term, ignoring case; null when none does. Only a fallback
// for explanations saved before captureId existed.
export function pageForTerm(db: SqlDb, sessionId: string, term: string): string | null {
  const needle = term.toLowerCase();
  return listPages(db, sessionId).find((page) => (page.foundText ?? "").toLowerCase().includes(needle))?.id ?? null;
}

// The explanation the person is looking at: what more detail and double-check send as "answer".
export function shownAnswer(e: Explanation): string | null {
  for (let i = e.thread.length - 1; i >= 0; i--) {
    const item = e.thread[i];
    if (item !== undefined && item.kind === "explain") return item.text;
  }
  return null;
}

// Double-check answers start with one line: Correct, Partly correct, or Not correct (apps/api/src/tasks/double-check.ts).
export function verdictOf(text: string): "correct" | "partly" | "not" | null {
  const first = (text.split("\n")[0] ?? "").trim().toLowerCase().replace(/[.:!*]+$/g, "").replace(/^\*+/, "");
  if (first === "correct") return "correct";
  if (first === "partly correct") return "partly";
  if (first === "not correct") return "not";
  return null;
}
