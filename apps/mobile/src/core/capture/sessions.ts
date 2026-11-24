import type { SqlDb } from "../db/sql.ts";
import { markMoved } from "../sync/changes.ts";

export type SessionKind = "recording" | "pages";
export type SessionState = "recording" | "paused" | "saved" | "interrupted";
export type SessionRow = {
  id: string;
  spaceId: string;
  kind: SessionKind;
  title: string;
  state: SessionState;
  transcript: string;
  startedAt: number;
  endedAt: number | null;
  recordedMs: number;
};
export type SessionSummary = SessionRow & { spaceName: string; pages: number; photos: number; flags: number; cards: number };

type Deps = { now: () => number; newId: () => string };

type SessionDbRow = {
  id: string;
  space_id: string;
  kind: SessionKind;
  title: string;
  state: SessionState;
  transcript: string;
  started_at: number;
  ended_at: number | null;
  recorded_ms: number;
};

type SummaryDbRow = SessionDbRow & { space_name: string; pages: number; photos: number; flags: number; cards: number };

const COLUMNS = `s.id, s.space_id, s.kind, s.title, s.state, s.transcript, s.started_at, s.ended_at, s.recorded_ms`;

const SUMMARY_SELECT = `
  SELECT ${COLUMNS}, sp.name AS space_name,
    (SELECT count(*) FROM captures c WHERE c.session_id = s.id AND c.kind = 'page') AS pages,
    (SELECT count(*) FROM captures c WHERE c.session_id = s.id AND c.kind = 'photo') AS photos,
    (SELECT count(*) FROM flags f WHERE f.session_id = s.id) AS flags,
    (SELECT count(*) FROM cards k WHERE k.session_id = s.id) AS cards
  FROM sessions s JOIN spaces sp ON sp.id = s.space_id`;

const FINISHED = "s.state IN ('saved', 'interrupted')";

function toRow(row: SessionDbRow): SessionRow {
  return {
    id: row.id,
    spaceId: row.space_id,
    kind: row.kind,
    title: row.title,
    state: row.state,
    transcript: row.transcript,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    recordedMs: row.recorded_ms,
  };
}

function toSummary(row: SummaryDbRow): SessionSummary {
  return {
    ...toRow(row),
    spaceName: row.space_name,
    pages: row.pages,
    photos: row.photos,
    flags: row.flags,
    cards: row.cards,
  };
}

export function createSession(
  db: SqlDb,
  deps: Deps,
  input: { spaceId: string; kind: SessionKind; title: string; state: SessionState },
): SessionRow {
  const id = deps.newId();
  db.run(
    "INSERT INTO sessions (id, space_id, kind, title, state, started_at, recorded_ms) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [id, input.spaceId, input.kind, input.title, input.state, deps.now()],
  );
  const row = getSession(db, id);
  if (!row) throw new Error(`session not saved: ${id}`);
  return row;
}

export function getSession(db: SqlDb, id: string): SessionRow | null {
  const row = db.get<SessionDbRow>(`SELECT ${COLUMNS} FROM sessions s WHERE s.id = ?`, [id]);
  return row ? toRow(row) : null;
}

// The newest session that was saved or interrupted. Sessions still recording are skipped.
export function latestSession(db: SqlDb): SessionSummary | null {
  const row = db.get<SummaryDbRow>(`${SUMMARY_SELECT} WHERE ${FINISHED} ORDER BY s.started_at DESC LIMIT 1`);
  return row ? toSummary(row) : null;
}

// The finished sessions after the newest `skip` ones, newest first, at most `limit`.
export function recentSessions(db: SqlDb, skip: number, limit: number): SessionSummary[] {
  return db
    .all<SummaryDbRow>(`${SUMMARY_SELECT} WHERE ${FINISHED} ORDER BY s.started_at DESC LIMIT ? OFFSET ?`, [limit, skip])
    .map(toSummary);
}

// Newest first. Saved and interrupted sessions only.
export function sessionsInSpace(db: SqlDb, spaceId: string): SessionSummary[] {
  return db
    .all<SummaryDbRow>(`${SUMMARY_SELECT} WHERE s.space_id = ? AND ${FINISHED} ORDER BY s.started_at DESC`, [spaceId])
    .map(toSummary);
}

// The title is trimmed and must be 1 to 80 characters. A renamed title is the person's: the app never replaces it (title_auto 0).
export function renameSession(db: SqlDb, id: string, title: string): void {
  const trimmed = title.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > 80) throw new RangeError("title must be 1 to 80 characters");
  db.run("UPDATE sessions SET title = ?, title_auto = 0 WHERE id = ?", [trimmed, id]);
}

// Moves a session and marks the new space as used now. Both changes happen in one transaction.
export function moveSession(db: SqlDb, id: string, spaceId: string, now: number): void {
  db.transaction(() => {
    db.run("UPDATE sessions SET space_id = ? WHERE id = ?", [spaceId, id]);
    db.run("UPDATE spaces SET last_used_at = ? WHERE id = ?", [now, spaceId]);
  });
}

// Moves one session into a space (the picker and the new-space sheet both use it). The rows follow the new space's
// group, and the old group drops the session (M30b).
export function moveSessionToSpace(db: SqlDb, id: string, spaceId: string, now: number): void {
  const from = getSession(db, id)?.spaceId ?? null;
  const oldGroup = from === null ? null : (db.get<{ group_id: string }>("SELECT group_id FROM space_groups WHERE space_id = ?", [from])?.group_id ?? null);
  moveSession(db, id, spaceId, now);
  if (from !== spaceId) markMoved(db, id, oldGroup);
}

// A device setting marks each recording this iPhone started until it is finished. Settings never sync.
export const RECORDING_HERE_PREFIX = "recording_here:";

// Removes the row; captures, flags, cards and segments go with it. The caller removes the files.
export function deleteSessionRow(db: SqlDb, id: string): void {
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
  db.run("DELETE FROM settings WHERE key = ?", [`${RECORDING_HERE_PREFIX}${id}`]);
}
