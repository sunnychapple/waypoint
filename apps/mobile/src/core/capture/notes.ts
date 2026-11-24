import type { SqlDb } from "../db/sql.ts";

type Deps = { now: () => number; newId: () => string };

export const NOTE_MAX_CHARS = 2000;
export const QUOTE_MAX_CHARS = 300;

// Cuts text to max characters (code points), so a surrogate pair is never split.
const cut = (text: string, max: number): string => Array.from(text).slice(0, max).join("");

// A note the person typed in a recording (note 13), t ms into it. quote holds the words it was made from, or "".
export type Note = { id: string; sessionId: string; t: number; text: string; quote: string; createdAt: number };

type Row = { id: string; session_id: string; t: number; text: string; quote: string; created_at: number };
const COLUMNS = "id, session_id, t, text, quote, created_at";

function fromRow(row: Row): Note {
  return { id: row.id, sessionId: row.session_id, t: row.t, text: row.text, quote: row.quote, createdAt: row.created_at };
}

export function notesForSession(db: SqlDb, sessionId: string): Note[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM notes WHERE session_id = ? ORDER BY t, created_at, id`, [sessionId]).map(fromRow);
}

export function getNote(db: SqlDb, id: string): Note | null {
  const row = db.get<Row>(`SELECT ${COLUMNS} FROM notes WHERE id = ?`, [id]);
  return row === null ? null : fromRow(row);
}

// Returns the new note's id, or null when it has no text. A t that is not a finite number is stored as 0.
// Viewer checks (who may add or edit a note) are done by the screens, not here.
export function addNote(db: SqlDb, deps: Deps, sessionId: string, t: number, text: string, quote = ""): string | null {
  const clean = cut(text.trim(), NOTE_MAX_CHARS);
  if (clean === "") return null;
  const id = deps.newId();
  db.run("INSERT INTO notes (id, session_id, t, text, quote, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    sessionId,
    Number.isFinite(t) ? Math.max(0, Math.round(t)) : 0,
    clean,
    cut(quote.replace(/\s+/g, " ").trim(), QUOTE_MAX_CHARS),
    deps.now(),
  ]);
  return id;
}

// A note emptied of text is deleted.
// Viewer checks are done by the screens, not here.
export function updateNote(db: SqlDb, id: string, text: string): void {
  const clean = cut(text.trim(), NOTE_MAX_CHARS);
  if (clean === "") deleteNote(db, id);
  else db.run("UPDATE notes SET text = ? WHERE id = ?", [clean, id]);
}

export function deleteNote(db: SqlDb, id: string): void {
  db.run("DELETE FROM notes WHERE id = ?", [id]);
}
