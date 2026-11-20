import type { JobType } from "@waypoint/contracts";
import type { CloudFailure } from "../cloud/failure.ts";
import type { SqlDb } from "../db/sql.ts";

export type SentTask = "explain" | "more_detail" | "double_check" | JobType;

// UTF-8 length without TextEncoder, so it runs the same in Node and Hermes.
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

// Written before the request is sent, with exactly the JSON body the API client sends (JSON.stringify of the request).
// id is the request's Idempotency-Key; logging the same key again changes nothing (a "Try again" with the same key).
export function logSent(db: SqlDb, entry: { id: string; task: SentTask; sessionId: string | null; body: unknown; at: number }): void {
  const sent = JSON.stringify(entry.body);
  db.run("INSERT OR IGNORE INTO sent_log (id, task, session_id, sent, bytes, at) VALUES (?, ?, ?, ?, ?, ?)", [
    entry.id,
    entry.task,
    entry.sessionId,
    sent,
    utf8Length(sent),
    entry.at,
  ]);
}

// After the reply: the credits charged (0 when the task failed) and the route's retention when known.
export function settleSent(db: SqlDb, id: string, credits: number, retention: "standard" | "zero" | null): void {
  db.run("UPDATE sent_log SET credits = ?, retention = ? WHERE id = ?", [credits, retention, id]);
}

// After a failed request. "request already finished" (409) means an earlier request with this key was charged, so the
// row keeps the credits it has. Every other failure charged nothing.
export function settleFailedSent(db: SqlDb, id: string, failure: CloudFailure): void {
  if (failure.kind === "already_finished") return;
  settleSent(db, id, 0, null);
}

export type SentEntry = { id: string; task: string; sessionId: string | null; sent: string; bytes: number; credits: number | null; retention: "standard" | "zero" | null; at: number };

export function getSent(db: SqlDb, id: string): SentEntry | null {
  return db.get<SentEntry>("SELECT id, task, session_id AS sessionId, sent, bytes, credits, retention, at FROM sent_log WHERE id = ?", [id]);
}
