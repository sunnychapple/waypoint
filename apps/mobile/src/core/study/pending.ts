import type { SqlDb } from "../db/sql.ts";

export type Pending = "pages" | "transcript";

// What a session still waits for before it can be studied: a page not read yet (found_text IS NULL), or a transcript
// still waiting to be made. Pages come first. Null when everything is read. A page whose read failed holds "" and counts as read.
// A synced page with no file on this iPhone is not being read here, so nothing waits for it.
export function pendingText(db: SqlDb, sessionId: string): Pending | null {
  const unread = db.get<{ n: number }>(
    "SELECT count(*) AS n FROM captures WHERE session_id = ? AND kind = 'page' AND found_text IS NULL AND file <> ''",
    [sessionId],
  );
  if ((unread?.n ?? 0) > 0) return "pages";
  const session = db.get<{ transcript: string }>("SELECT transcript FROM sessions WHERE id = ?", [sessionId]);
  return session?.transcript === "waiting" ? "transcript" : null;
}

export function pendingCopy(pending: Pending): string {
  return pending === "pages" ? "Reading your pages…" : "Finishing the transcript…";
}

// How long a session waits for pages or a transcript before it goes on with what it has.
export const PENDING_GIVE_UP_MS = 60_000;

// Said when the wait ran out and the study goes on with part of the text.
export function skippedCopy(pending: Pending): string {
  return pending === "pages" ? "Some pages couldn't be read." : "The transcript isn't ready yet, so this uses what there is.";
}
