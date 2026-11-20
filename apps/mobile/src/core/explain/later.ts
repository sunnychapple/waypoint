import type { SqlDb } from "../db/sql.ts";

// Offline (or after a failed answer): keep the question as a flag at that moment. Answering flags is M33.
export function askLater(db: SqlDb, deps: { newId: () => string }, sessionId: string, t: number, word: string): void {
  db.run("INSERT INTO flags (id, session_id, t, question) VALUES (?, ?, ?, ?)", [deps.newId(), sessionId, Math.max(0, Math.round(t)), `What does "${word}" mean?`]);
}
