import type { SqlDb } from "../db/sql.ts";
import { createSession, type SessionRow } from "./sessions.ts";
import { partsNeedingTranscription } from "./transcript.ts";

type Deps = { now: () => number; newId: () => string };

// Starts a recording in the chosen space. Words are written live when the speech pack is installed;
// otherwise the session waits for its audio files to be transcribed.
export function startRecordingSession(db: SqlDb, deps: Deps, spaceId: string, speechReady: boolean): SessionRow {
  const transcript = speechReady ? "live" : "waiting";
  const row = createSession(db, deps, { spaceId, kind: "recording", title: "New recording", state: "recording" });
  db.transaction(() => {
    db.run("UPDATE sessions SET transcript = ? WHERE id = ?", [transcript, row.id]);
    db.run("UPDATE spaces SET last_used_at = ? WHERE id = ?", [deps.now(), spaceId]);
  });
  return { ...row, transcript };
}

// A finished text piece from the live transcriber. A repeat of the same piece is ignored.
export function saveSegment(db: SqlDb, sessionId: string, piece: { tStart: number; tEnd: number; text: string }): void {
  db.run(
    "INSERT OR IGNORE INTO segments (session_id, t_start, t_end, text, source) VALUES (?, ?, ?, ?, 'device')",
    [sessionId, piece.tStart, piece.tEnd, piece.text],
  );
}

// A finished audio part. A second event for the same file is ignored.
export function savePart(
  db: SqlDb,
  deps: Deps,
  sessionId: string,
  part: { index: number; startMs: number; durationMs: number; file: string },
): void {
  const seen = db.get<{ id: string }>("SELECT id FROM captures WHERE session_id = ? AND kind = 'audio' AND file = ?", [
    sessionId,
    part.file,
  ]);
  if (seen) return;
  db.run(
    "INSERT INTO captures (id, session_id, kind, t, position, file, duration_ms) VALUES (?, ?, 'audio', ?, ?, ?, ?)",
    [deps.newId(), sessionId, part.startMs, part.index, part.file, part.durationMs],
  );
}

export function addFlag(db: SqlDb, deps: Deps, sessionId: string, t: number): void {
  db.run("INSERT INTO flags (id, session_id, t) VALUES (?, ?, ?)", [deps.newId(), sessionId, t]);
}

// Returns the new capture id.
export function addPhoto(db: SqlDb, deps: Deps, sessionId: string, t: number, file: string): string {
  const id = deps.newId();
  db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES (?, ?, 'photo', ?, 0, ?)", [
    id,
    sessionId,
    t,
    file,
  ]);
  return id;
}

export function setPaused(db: SqlDb, sessionId: string, paused: boolean): void {
  db.run("UPDATE sessions SET state = ? WHERE id = ?", [paused ? "paused" : "recording", sessionId]);
}

// Ends the recording. Live words are complete; a session still waiting keeps waiting.
export function finishRecording(db: SqlDb, sessionId: string, endedAt: number, recordedMs: number): void {
  db.run(
    `UPDATE sessions SET state = 'saved', ended_at = ?, recorded_ms = ?, indexed_at = NULL,
       transcript = CASE WHEN transcript = 'live' THEN 'done' ELSE transcript END
     WHERE id = ?`,
    [endedAt, recordedMs, sessionId],
  );
}

// After a restart: sessions still marked recording or paused, except the one native is still recording,
// become interrupted and wait for transcription. Their length is what the saved audio parts add up to, and they
// end where the last saved part ends. Returns their ids.
export function recoverSessions(db: SqlDb, nativeStatus: { sessionId: string; state: string }): string[] {
  const nativeActive = nativeStatus.state !== "idle";
  const ids = db
    .all<{ id: string }>("SELECT id FROM sessions WHERE state IN ('recording', 'paused')")
    .map((row) => row.id)
    .filter((id) => !(nativeActive && id === nativeStatus.sessionId));
  db.transaction(() => {
    for (const id of ids) {
      db.run(
        `UPDATE sessions SET state = 'interrupted',
           transcript = CASE WHEN transcript = 'done' THEN 'done' ELSE 'waiting' END,
           recorded_ms = (SELECT COALESCE(SUM(duration_ms), 0) FROM captures WHERE session_id = sessions.id AND kind = 'audio'),
           ended_at = COALESCE(ended_at, started_at + (
             SELECT COALESCE(MAX(t + COALESCE(duration_ms, 0)), 0) FROM captures WHERE session_id = sessions.id AND kind = 'audio'))
         WHERE id = ?`,
        [id],
      );
    }
  });
  return ids;
}

// Waiting sessions that are saved or interrupted, each with the audio parts that have no segments yet.
export function pendingTranscriptions(
  db: SqlDb,
): { sessionId: string; parts: { file: string; startMs: number; durationMs: number }[] }[] {
  const sessions = db.all<{ id: string }>(
    "SELECT id FROM sessions WHERE transcript = 'waiting' AND state IN ('saved', 'interrupted') ORDER BY started_at",
  );
  return sessions.map((session) => {
    const pairs = db
      .all<{ file: string; t: number; duration_ms: number | null }>(
        "SELECT file, t, duration_ms FROM captures WHERE session_id = ? AND kind = 'audio' ORDER BY position, id",
        [session.id],
      )
      .map((row) => ({ file: row.file, span: { startMs: row.t, durationMs: row.duration_ms ?? 0 } }));
    const segments = db
      .all<{ t_start: number; t_end: number }>("SELECT t_start, t_end FROM segments WHERE session_id = ?", [session.id])
      .map((row) => ({ tStart: row.t_start, tEnd: row.t_end }));
    const needed = new Set(partsNeedingTranscription(pairs.map((p) => p.span), segments));
    return {
      sessionId: session.id,
      parts: pairs
        .filter((p) => needed.has(p.span))
        .map((p) => ({ file: p.file, startMs: p.span.startMs, durationMs: p.span.durationMs })),
    };
  });
}
