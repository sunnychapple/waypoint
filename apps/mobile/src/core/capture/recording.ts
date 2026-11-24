import { shortDay } from "../format.ts";
import type { SqlDb } from "../db/sql.ts";
import { deleteSetting, getSetting, setSetting } from "../db/settings.ts";
import { titleFromText } from "./pages.ts";
import { listSegments } from "./segments.ts";
import { createSession, getSession, RECORDING_HERE_PREFIX, renameSession, type SessionRow } from "./sessions.ts";
import { partsNeedingTranscription, type Piece } from "./transcript.ts";

export const DEFAULT_RECORDING_TITLE = "New recording";

type Deps = { now: () => number; newId: () => string };

// A recording from another phone that is still unfinished after this long is treated as abandoned.
const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

// Starts a recording in the chosen space. Words are written live when the speech pack is installed;
// otherwise the session waits for its audio files to be transcribed.
export function startRecordingSession(db: SqlDb, deps: Deps, spaceId: string, speechReady: boolean): SessionRow {
  const transcript = speechReady ? "live" : "waiting";
  const row = createSession(db, deps, { spaceId, kind: "recording", title: DEFAULT_RECORDING_TITLE, state: "recording" });
  db.transaction(() => {
    db.run("UPDATE sessions SET transcript = ? WHERE id = ?", [transcript, row.id]);
    db.run("UPDATE spaces SET last_used_at = ? WHERE id = ?", [deps.now(), spaceId]);
    setSetting(db, `${RECORDING_HERE_PREFIX}${row.id}`, "1");
  });
  return { ...row, transcript };
}

type ContinueFrom = { elapsedMs: number; firstIndex: number; priorRecordedMs: number };

export type PriorTimeline = {
  finals: Piece[];
  parts: { sessionId: string; index: number; startMs: number; durationMs: number; file: string }[];
  resumes: number[];
  flags: number[];
  photos: { id: string; t: number; file: string }[];
};

export type ContinuedRecording = {
  session: SessionRow;
  from: ContinueFrom;
  prior: PriorTimeline;
  restore: { state: SessionRow["state"]; transcript: string; endedAt: number | null };
};

// What a saved session already holds, for the live screen to draw above the new words.
function priorTimeline(db: SqlDb, sessionId: string): PriorTimeline {
  const parts = db
    .all<{ position: number; t: number; duration_ms: number | null; file: string }>(
      "SELECT position, t, duration_ms, file FROM captures WHERE session_id = ? AND kind = 'audio' ORDER BY t, position, id",
      [sessionId],
    )
    .map((row) => ({ sessionId, index: row.position, startMs: row.t, durationMs: row.duration_ms ?? 0, file: row.file }));
  return {
    finals: listSegments(db, sessionId).map((segment) => ({ ...segment, isFinal: true })),
    parts,
    // The same reading as the saved session's timeline: each part after the first starts at a resume.
    resumes: parts.slice(1).filter((_, i) => (parts[i]?.durationMs ?? 0) > 0).map((part) => part.startMs),
    flags: db.all<{ t: number }>("SELECT t FROM flags WHERE session_id = ? ORDER BY t", [sessionId]).map((row) => row.t),
    photos: db.all<{ id: string; t: number; file: string }>(
      "SELECT id, t, file FROM captures WHERE session_id = ? AND kind = 'photo' ORDER BY t, id",
      [sessionId],
    ),
  };
}

// Reopens a saved recording. Null when it is not a finished recording. New words are written live when the speech pack
// is installed; otherwise the new audio waits to be transcribed. `ended_at` holds the time it was reopened, so another
// phone can tell the recording is active (see mayRecover).
export function continueRecordingSession(db: SqlDb, deps: Deps, sessionId: string, speechReady: boolean): ContinuedRecording | null {
  const session = getSession(db, sessionId);
  if (session === null || session.kind !== "recording" || (session.state !== "saved" && session.state !== "interrupted")) return null;
  const prior = priorTimeline(db, sessionId);
  const lastEnd = prior.parts.reduce((end, part) => Math.max(end, part.startMs + part.durationMs), 0);
  const firstIndex = prior.parts.reduce((next, part) => Math.max(next, part.index + 1), 0);
  const now = deps.now();
  const transcript =
    session.transcript === "done" ? (speechReady ? "live" : "waiting") : session.transcript === "failed" ? "waiting" : session.transcript;
  db.transaction(() => {
    db.run("UPDATE sessions SET state = 'recording', transcript = ?, ended_at = ?, indexed_at = NULL WHERE id = ?", [transcript, now, sessionId]);
    db.run("UPDATE spaces SET last_used_at = ? WHERE id = ?", [now, session.spaceId]);
    setSetting(db, `${RECORDING_HERE_PREFIX}${sessionId}`, "1");
  });
  return {
    session: { ...session, state: "recording", transcript },
    // At least a second after the last part, so a changed iPhone clock cannot make new audio overlap the old.
    from: { elapsedMs: Math.max(now - session.startedAt, lastEnd + 1000), firstIndex, priorRecordedMs: session.recordedMs },
    prior,
    restore: { state: session.state, transcript: session.transcript, endedAt: session.endedAt },
  };
}

// The recorder could not start: the session goes back to how it was.
export function undoContinue(db: SqlDb, sessionId: string, restore: ContinuedRecording["restore"]): void {
  db.run("UPDATE sessions SET state = ?, transcript = ?, ended_at = ? WHERE id = ?", [restore.state, restore.transcript, restore.endedAt, sessionId]);
  deleteSetting(db, `${RECORDING_HERE_PREFIX}${sessionId}`);
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
  deleteSetting(db, `${RECORDING_HERE_PREFIX}${sessionId}`);
}

// True when this iPhone's recorder is working on the session. Keyed on the recorder, not the row's state, so a
// session another phone left marked "recording" can still be changed here.
export function isLiveSession(status: { sessionId: string; state: string }, id: string): boolean {
  return status.sessionId === id && status.state !== "idle";
}

// Whether this iPhone may close an unfinished session. A session outside any shared space was recorded here. One in a
// shared space may still be recording on another member's phone (even one this iPhone recorded earlier, since any member
// can continue it), so it is closed only if this iPhone is the one recording it or it has shown no activity for a day.
function mayRecover(db: SqlDb, session: { id: string; started_at: number }, now: number): boolean {
  if (getSetting(db, `${RECORDING_HERE_PREFIX}${session.id}`) !== null) return true;
  const shared = db.get("SELECT 1 AS n FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = ?", [session.id]);
  if (shared === null) return true;
  const activity = db.get<{ at: number }>(
    `SELECT max(s.started_at, COALESCE(s.ended_at, 0), s.started_at + COALESCE(
       (SELECT MAX(c.t + COALESCE(c.duration_ms, 0)) FROM captures c WHERE c.session_id = s.id AND c.kind = 'audio'), 0)) AS at
     FROM sessions s WHERE s.id = ?`,
    [session.id],
  );
  return now - (activity?.at ?? session.started_at) >= ABANDONED_AFTER_MS;
}

// After a restart: sessions still marked recording or paused, except the one native is still recording and those
// another phone may still be recording, become interrupted and wait for transcription. Their length is what the saved
// audio parts add up to, and they end where the last saved part ends. Returns their ids.
export function recoverSessions(db: SqlDb, nativeStatus: { sessionId: string; state: string }, now = Date.now()): string[] {
  // A marker for a session that another phone has since closed would let this phone close that phone's next recording.
  db.run(
    `DELETE FROM settings WHERE key LIKE ? AND substr(key, ?) NOT IN (SELECT id FROM sessions WHERE state IN ('recording', 'paused'))`,
    [`${RECORDING_HERE_PREFIX}%`, RECORDING_HERE_PREFIX.length + 1],
  );
  const nativeActive = nativeStatus.state !== "idle";
  const ids = db
    .all<{ id: string; started_at: number }>("SELECT id, started_at FROM sessions WHERE state IN ('recording', 'paused')")
    .filter((session) => !(nativeActive && session.id === nativeStatus.sessionId))
    .filter((session) => mayRecover(db, session, now))
    .map((session) => session.id);
  db.transaction(() => {
    for (const id of ids) {
      deleteSetting(db, `${RECORDING_HERE_PREFIX}${id}`);
      db.run(
        `UPDATE sessions SET state = 'interrupted',
           transcript = CASE WHEN transcript = 'done' THEN 'done' ELSE 'waiting' END,
           recorded_ms = (SELECT COALESCE(SUM(duration_ms), 0) FROM captures WHERE session_id = sessions.id AND kind = 'audio'),
           ended_at = max(COALESCE(ended_at, 0), started_at + (
             SELECT COALESCE(MAX(t + COALESCE(duration_ms, 0)), 0) FROM captures WHERE session_id = sessions.id AND kind = 'audio'))
         WHERE id = ?`,
        [id],
      );
    }
  });
  return ids;
}

// Waiting sessions that are saved or interrupted, each with the audio parts that have a hole in their on-device words.
// A session is skipped only when every part that needs writing down is on another phone (file = ''): that phone writes
// them down, and marking it failed here would sync "failed" back to it. Otherwise the parts here are written down, and
// `elsewhere` says whether some still wait for another phone, so this one must not mark the session done.
export function pendingTranscriptions(
  db: SqlDb,
): { sessionId: string; parts: { file: string; startMs: number; durationMs: number }[]; elsewhere: boolean }[] {
  const sessions = db.all<{ id: string }>(
    "SELECT id FROM sessions WHERE transcript = 'waiting' AND state IN ('saved', 'interrupted') ORDER BY started_at",
  );
  const result = sessions.map((session) => {
    const pairs = db
      .all<{ file: string; t: number; duration_ms: number | null }>(
        "SELECT file, t, duration_ms FROM captures WHERE session_id = ? AND kind = 'audio' ORDER BY t, position, id",
        [session.id],
      )
      .map((row) => ({ file: row.file, span: { startMs: row.t, durationMs: row.duration_ms ?? 0 } }));
    const segments = db
      .all<{ t_start: number; t_end: number }>("SELECT t_start, t_end FROM segments WHERE session_id = ? AND source = 'device'", [session.id])
      .map((row) => ({ tStart: row.t_start, tEnd: row.t_end }));
    const needed = new Set(partsNeedingTranscription(pairs.map((p) => p.span), segments));
    const parts = pairs.filter((p) => needed.has(p.span));
    // Parts recorded on another phone have no file here; that phone writes them down.
    const here = parts.filter((p) => p.file !== "");
    const skip = parts.length > 0 && here.length === 0;
    return {
      sessionId: session.id,
      parts: here.map((p) => ({ file: p.file, startMs: p.span.startMs, durationMs: p.span.durationMs })),
      skip,
      elsewhere: here.length < parts.length,
    };
  });
  return result.filter((session) => !session.skip).map(({ sessionId, parts, elsewhere }) => ({ sessionId, parts, elsewhere }));
}
