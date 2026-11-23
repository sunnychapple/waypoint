import { shortDay } from "../format.ts";
import type { SqlDb } from "../db/sql.ts";
import { getSetting, setSetting } from "../db/settings.ts";
import { titleFromText } from "./pages.ts";
import { createSession, getSession, renameSession, type SessionRow } from "./sessions.ts";
import { partsNeedingTranscription } from "./transcript.ts";

export const DEFAULT_RECORDING_TITLE = "New recording";

type Deps = { now: () => number; newId: () => string };

// The session this iPhone last started recording. The settings table stays on the device.
const RECORDING_HERE_KEY = "recording_here";

// Starts a recording in the chosen space. Words are written live when the speech pack is installed;
// otherwise the session waits for its audio files to be transcribed.
export function startRecordingSession(db: SqlDb, deps: Deps, spaceId: string, speechReady: boolean): SessionRow {
  const transcript = speechReady ? "live" : "waiting";
  const row = createSession(db, deps, { spaceId, kind: "recording", title: DEFAULT_RECORDING_TITLE, state: "recording" });
  db.transaction(() => {
    db.run("UPDATE sessions SET transcript = ? WHERE id = ?", [transcript, row.id]);
    db.run("UPDATE spaces SET last_used_at = ? WHERE id = ?", [deps.now(), spaceId]);
    setSetting(db, RECORDING_HERE_KEY, row.id);
  });
  return { ...row, transcript };
}

// The title of a recording nobody named: its first words, or when there are none, the day and time it started.
export function recordingTitle(firstText: string | null, startedAt: number): string {
  const when = new Date(startedAt);
  const weekday = when.toLocaleDateString(undefined, { weekday: "short" });
  const time = when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return titleFromText(firstText, `Recording · ${weekday} ${shortDay(startedAt)}, ${time}`);
}

// At stop: a recording still called by the default name takes its title from the first words written down.
// A title the person has changed is left alone.
export function nameRecording(db: SqlDb, sessionId: string): void {
  const session = getSession(db, sessionId);
  if (session === null || session.title !== DEFAULT_RECORDING_TITLE) return;
  const words = db
    .all<{ text: string }>("SELECT text FROM segments WHERE session_id = ? ORDER BY t_start LIMIT 5", [sessionId])
    .map((row) => row.text)
    .join(" ");
  renameSession(db, sessionId, recordingTitle(words.trim() === "" ? null : words, session.startedAt));
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

// True when this iPhone's recorder is working on the session. Keyed on the recorder, not the row's state, so a
// session another phone left marked "recording" can still be changed here.
export function isLiveSession(status: { sessionId: string; state: string }, id: string): boolean {
  return status.sessionId === id && status.state !== "idle";
}

// Whether an unfinished session was recorded on this iPhone. A session outside any shared space always was. One in a
// shared space may be another member's: it is ours if this iPhone started it or holds one of its audio files.
function recordedHere(db: SqlDb, id: string, startedHere: string | null): boolean {
  if (id === startedHere) return true;
  const shared = db.get("SELECT 1 AS n FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = ?", [id]);
  if (shared === null) return true;
  return db.get("SELECT 1 AS n FROM captures WHERE session_id = ? AND kind = 'audio' AND file != ''", [id]) !== null;
}

// After a restart: sessions still marked recording or paused, except the one native is still recording,
// become interrupted and wait for transcription. Their length is what the saved audio parts add up to, and they
// end where the last saved part ends. Returns their ids.
export function recoverSessions(db: SqlDb, nativeStatus: { sessionId: string; state: string }): string[] {
  const nativeActive = nativeStatus.state !== "idle";
  const startedHere = getSetting(db, RECORDING_HERE_KEY);
  const ids = db
    .all<{ id: string }>("SELECT id FROM sessions WHERE state IN ('recording', 'paused')")
    .map((row) => row.id)
    .filter((id) => !(nativeActive && id === nativeStatus.sessionId))
    .filter((id) => recordedHere(db, id, startedHere));
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

// Waiting sessions that are saved or interrupted, each with the audio parts that have a hole in their on-device words.
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
      .all<{ t_start: number; t_end: number }>("SELECT t_start, t_end FROM segments WHERE session_id = ? AND source = 'device'", [session.id])
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
