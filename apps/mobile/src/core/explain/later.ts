import { WORD_MAX_CHARS } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";
import { lineAt, studyLines } from "../capture/segments.ts";

// Offline (or after a failed answer): keep the question as a flag at that moment. A word tapped on a page keeps the page.
// The same question still open at the same place is not added twice.
export function askLater(db: SqlDb, deps: { newId: () => string }, sessionId: string, t: number, word: string, captureId?: string | null): void {
  const at = Math.max(0, Math.round(t));
  const question = questionFor(word);
  const page = captureId ?? null;
  if (db.get("SELECT 1 AS ok FROM flags WHERE session_id = ? AND t = ? AND question = ? AND capture_id IS ? AND state = 'open'", [sessionId, at, question, page]) !== null) return;
  db.run("INSERT INTO flags (id, session_id, t, question, capture_id) VALUES (?, ?, ?, ?, ?)", [
    deps.newId(),
    sessionId,
    at,
    question,
    page,
  ]);
}

// The question askLater stores for a word.
export function questionFor(word: string): string {
  return `What does "${word}" mean?`;
}

// The word inside a stored question, or null for a plain flag ('') or anything else.
export function wordFromQuestion(question: string): string | null {
  const match = /^What does "(.+)" mean\?$/s.exec(question);
  return match?.[1] ?? null;
}

// captureId is the page the flag was made on (null for a moment in a recording); pageNumber counts pages from 1.
export type OpenFlag = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  startedAt: number;
  t: number;
  question: string;
  captureId: string | null;
  pageNumber: number | null;
};

// Open flags, newest session first, then in time order within a session.
export function openFlags(db: SqlDb): OpenFlag[] {
  return db
    .all<{ id: string; session_id: string; session_title: string; started_at: number; t: number; question: string; capture_id: string | null; page_number: number | null }>(
      `SELECT f.id, f.session_id, s.title AS session_title, s.started_at, f.t, f.question, f.capture_id, c.position + 1 AS page_number
       FROM flags f JOIN sessions s ON s.id = f.session_id
       LEFT JOIN captures c ON c.id = f.capture_id
       WHERE f.state = 'open' ORDER BY s.started_at DESC, f.t, c.position`,
    )
    .map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      startedAt: row.started_at,
      t: row.t,
      question: row.question,
      captureId: row.capture_id,
      pageNumber: row.page_number,
    }));
}

// The phrase a flag with no word is explained by: the transcript line at its time, collapsed and cut to the word limit
// the explain request accepts. Null when the session has no transcript line at that time yet.
export function phraseForFlag(db: SqlDb, flag: Pick<OpenFlag, "sessionId" | "t">): string | null {
  const line = lineAt(studyLines(db, flag.sessionId), flag.t);
  if (line === null) return null;
  const phrase = line.text.replace(/\s+/g, " ").trim().slice(0, WORD_MAX_CHARS).trim();
  return phrase === "" ? null : phrase;
}

export function countOpenFlags(db: SqlDb): number {
  return db.get<{ n: number }>("SELECT count(*) AS n FROM flags WHERE state = 'open'")?.n ?? 0;
}

// Keeps the input order of the flags; a session's group takes the place of its first flag.
export function groupFlagsBySession(flags: OpenFlag[]): { sessionId: string; sessionTitle: string; flags: OpenFlag[] }[] {
  const groups: { sessionId: string; sessionTitle: string; flags: OpenFlag[] }[] = [];
  for (const flag of flags) {
    const group = groups.find((g) => g.sessionId === flag.sessionId);
    if (group) group.flags.push(flag);
    else groups.push({ sessionId: flag.sessionId, sessionTitle: flag.sessionTitle, flags: [flag] });
  }
  return groups;
}

// Explain answered the flagged word. Only an open flag changes.
export function markAnswered(db: SqlDb, flagId: string): void {
  db.run("UPDATE flags SET state = 'answered' WHERE id = ? AND state = 'open'", [flagId]);
}

// The person removed the saved answer to a flagged question: the question goes back on the list.
export function reopenFlag(db: SqlDb, flagId: string): void {
  db.run("UPDATE flags SET state = 'open' WHERE id = ? AND state = 'answered'", [flagId]);
}

export function dismissFlag(db: SqlDb, flagId: string): void {
  db.run("UPDATE flags SET state = 'dismissed' WHERE id = ? AND state = 'open'", [flagId]);
}
