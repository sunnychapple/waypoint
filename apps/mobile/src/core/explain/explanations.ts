import { z } from "zod";
import type { SqlDb } from "../db/sql.ts";

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
export type Explanation = { id: string; sessionId: string; t: number; term: string; thread: ThreadItem[]; saved: boolean; createdAt: number };

type Row = { id: string; session_id: string; t: number; term: string; thread: string; saved: number; created_at: number };

function fromRow(row: Row): Explanation {
  const thread = ThreadSchema.parse(JSON.parse(row.thread));
  return { id: row.id, sessionId: row.session_id, t: row.t, term: row.term, thread, saved: row.saved === 1, createdAt: row.created_at };
}

export function getExplanation(db: SqlDb, id: string): Explanation | null {
  const row = db.get<Row>("SELECT id, session_id, t, term, thread, saved, created_at FROM explanations WHERE id = ?", [id]);
  return row === null ? null : fromRow(row);
}

// A new, unsaved explanation with an empty thread.
export function startExplanation(db: SqlDb, deps: Deps, sessionId: string, t: number, term: string): Explanation {
  const id = deps.newId();
  db.run("INSERT INTO explanations (id, session_id, t, term, created_at) VALUES (?, ?, ?, ?, ?)", [id, sessionId, Math.max(0, Math.round(t)), term, deps.now()]);
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
  const e = getExplanation(db, id);
  if (e === null) throw new Error("no such explanation");
  const first = e.thread.find((item) => item.kind === "explain");
  if (first === undefined) throw new Error("nothing to save yet");
  db.transaction(() => {
    db.run("UPDATE explanations SET saved = 1 WHERE id = ?", [id]);
    db.run("INSERT OR IGNORE INTO terms (id, session_id, explanation_id, term, meaning, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
      deps.newId(),
      e.sessionId,
      id,
      e.term,
      first.text,
      deps.now(),
    ]);
  });
}

export function unsaveExplanation(db: SqlDb, id: string): void {
  db.transaction(() => {
    db.run("DELETE FROM terms WHERE explanation_id = ?", [id]);
    db.run("UPDATE explanations SET saved = 0 WHERE id = ?", [id]);
  });
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
