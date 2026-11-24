import { beforeEach, describe, expect, it } from "vitest";
import {
  addFlag,
  addPhoto,
  continueRecordingSession,
  finishRecording,
  isLiveSession,
  pendingTranscriptions,
  recoverSessions,
  saveSegment,
  savePart,
  setPaused,
  startRecordingSession,
  undoContinue,
} from "../src/core/capture/recording.ts";
import { deleteSessionRow, getSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { getSetting, setSetting } from "../src/core/db/settings.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;
let ids: number;
let homeId: string;
const deps = (now = 1000) => ({ now: () => now, newId: () => `id-${++ids}` });

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  ids = 0;
  homeId = ensureDefaultSpace(db, deps()).id;
});

function insertSession(id: string, state: string, transcript: string, startedAt = 1000): void {
  db.run(
    "INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at) VALUES (?, ?, 'recording', 't', ?, ?, ?)",
    [id, homeId, state, transcript, startedAt],
  );
}

function shareSpace(spaceId: string): void {
  db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES ('grp_shared', 'shared', 'editor', 1, 0)");
  db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, 'grp_shared')", [spaceId]);
}

describe("recording", () => {
  it("startRecordingSession creates a recording in the space with live or waiting transcript and touches the space", () => {
    const live = startRecordingSession(db, deps(500), homeId, true);
    expect(live).toMatchObject({ kind: "recording", title: "New recording", state: "recording", transcript: "live", spaceId: homeId });
    expect(getSession(db, live.id)?.transcript).toBe("live");
    const waiting = startRecordingSession(db, deps(700), homeId, false);
    expect(waiting.transcript).toBe("waiting");
    const space = db.get<{ last_used_at: number }>("SELECT last_used_at FROM spaces WHERE id = ?", [homeId]);
    expect(space?.last_used_at).toBe(700);
  });

  it("saveSegment stores a piece and ignores a repeat with the same start", () => {
    const session = startRecordingSession(db, deps(), homeId, true);
    saveSegment(db, session.id, { tStart: 1000, tEnd: 2000, text: "hello" });
    saveSegment(db, session.id, { tStart: 1000, tEnd: 2500, text: "hello again" });
    const rows = db.all<{ text: string; source: string }>("SELECT text, source FROM segments WHERE session_id = ?", [session.id]);
    expect(rows).toEqual([{ text: "hello", source: "device" }]);
  });

  it("savePart stores an audio part and ignores a second event for the same file", () => {
    const session = startRecordingSession(db, deps(), homeId, true);
    const part = { index: 0, startMs: 0, durationMs: 300_000, file: "sessions/s/part-0.m4a" };
    savePart(db, deps(), session.id, part);
    savePart(db, deps(), session.id, part);
    const rows = db.all<{ kind: string; t: number; position: number; duration_ms: number }>(
      "SELECT kind, t, position, duration_ms FROM captures WHERE session_id = ?",
      [session.id],
    );
    expect(rows).toEqual([{ kind: "audio", t: 0, position: 0, duration_ms: 300_000 }]);
  });

  it("addFlag stores a flag at the given time", () => {
    const session = startRecordingSession(db, deps(), homeId, true);
    addFlag(db, deps(), session.id, 42_000);
    const rows = db.all<{ t: number }>("SELECT t FROM flags WHERE session_id = ?", [session.id]);
    expect(rows).toEqual([{ t: 42_000 }]);
  });

  it("addPhoto stores a photo capture and returns its id", () => {
    const session = startRecordingSession(db, deps(), homeId, true);
    const id = addPhoto(db, { now: () => 0, newId: () => "photo-1" }, session.id, 5000, "sessions/s/photo-1.jpg");
    expect(id).toBe("photo-1");
    const row = db.get<{ kind: string; t: number; file: string }>("SELECT kind, t, file FROM captures WHERE id = ?", [id]);
    expect(row).toEqual({ kind: "photo", t: 5000, file: "sessions/s/photo-1.jpg" });
  });

  it("setPaused switches the session between paused and recording", () => {
    const session = startRecordingSession(db, deps(), homeId, true);
    setPaused(db, session.id, true);
    expect(getSession(db, session.id)?.state).toBe("paused");
    setPaused(db, session.id, false);
    expect(getSession(db, session.id)?.state).toBe("recording");
  });

  it("finishRecording saves the session, clears indexed_at and turns a live transcript into done", () => {
    const session = startRecordingSession(db, deps(), homeId, true);
    db.run("UPDATE sessions SET indexed_at = 5 WHERE id = ?", [session.id]);
    finishRecording(db, session.id, 9000, 8000);
    expect(getSession(db, session.id)).toMatchObject({ state: "saved", endedAt: 9000, recordedMs: 8000, transcript: "done" });
    const row = db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = ?", [session.id]);
    expect(row?.indexed_at).toBeNull();
  });

  it("finishRecording leaves a waiting transcript waiting", () => {
    const session = startRecordingSession(db, deps(), homeId, false);
    finishRecording(db, session.id, 9000, 8000);
    expect(getSession(db, session.id)).toMatchObject({ state: "saved", transcript: "waiting" });
  });

  it("recoverSessions only touches sessions native is not recording and leaves done transcripts alone", () => {
    insertSession("stale", "recording", "live");
    insertSession("paused-stale", "paused", "waiting");
    insertSession("done-stale", "recording", "done");
    insertSession("active", "recording", "live");
    const stale = recoverSessions(db, { sessionId: "active", state: "recording" });
    expect(stale.sort()).toEqual(["done-stale", "paused-stale", "stale"]);
    expect(getSession(db, "active")?.state).toBe("recording");
    expect(getSession(db, "stale")).toMatchObject({ state: "interrupted", transcript: "waiting" });
    expect(getSession(db, "done-stale")).toMatchObject({ state: "interrupted", transcript: "done" });
  });

  it("pendingTranscriptions returns only the uncovered parts of waiting sessions", () => {
    const waiting = startRecordingSession(db, deps(), homeId, false);
    finishRecording(db, waiting.id, 9000, 0);
    const audio = [
      { index: 0, startMs: 0, durationMs: 20_000, file: "p0.m4a" },
      { index: 1, startMs: 20_000, durationMs: 20_000, file: "p1.m4a" },
      { index: 2, startMs: 40_000, durationMs: 5_000, file: "p2.m4a" },
    ];
    for (const part of audio) savePart(db, deps(), waiting.id, part);
    saveSegment(db, waiting.id, { tStart: 0, tEnd: 15_000, text: "covered" });
    const live = startRecordingSession(db, deps(), homeId, true);
    finishRecording(db, live.id, 9000, 0);
    savePart(db, deps(), live.id, { index: 0, startMs: 0, durationMs: 20_000, file: "live.m4a" });

    expect(pendingTranscriptions(db)).toEqual([
      { sessionId: waiting.id, parts: [{ file: "p1.m4a", startMs: 20_000, durationMs: 20_000 }] },
    ]);
  });

  it("pendingTranscriptions skips a waiting session whose only needed part is on another phone", () => {
    const waiting = startRecordingSession(db, deps(), homeId, false);
    finishRecording(db, waiting.id, 9000, 0);
    savePart(db, deps(), waiting.id, { index: 0, startMs: 0, durationMs: 20_000, file: "" });
    expect(pendingTranscriptions(db)).toEqual([]);
  });

  it("pendingTranscriptions returns a session with one needed part here and one on another phone, with only the part here", () => {
    const waiting = startRecordingSession(db, deps(), homeId, false);
    finishRecording(db, waiting.id, 9000, 0);
    savePart(db, deps(), waiting.id, { index: 0, startMs: 0, durationMs: 20_000, file: "" });
    savePart(db, deps(), waiting.id, { index: 1, startMs: 20_000, durationMs: 20_000, file: "p1.m4a" });
    expect(pendingTranscriptions(db)).toEqual([
      { sessionId: waiting.id, parts: [{ file: "p1.m4a", startMs: 20_000, durationMs: 20_000 }] },
    ]);
  });

  it("recoverSessions forgets this phone's marker for a session no longer recording, and keeps the one still recording", () => {
    insertSession("closed", "interrupted", "waiting");
    insertSession("active", "recording", "live");
    setSetting(db, "recording_here:closed", "1");
    setSetting(db, "recording_here:active", "1");
    recoverSessions(db, { sessionId: "active", state: "recording" });
    expect(getSetting(db, "recording_here:closed")).toBeNull();
    expect(getSetting(db, "recording_here:active")).not.toBeNull();
  });

  it("pendingTranscriptions does not count cloud words as on-device words", () => {
    const waiting = startRecordingSession(db, deps(), homeId, false);
    finishRecording(db, waiting.id, 9000, 0);
    savePart(db, deps(), waiting.id, { index: 0, startMs: 0, durationMs: 20_000, file: "p0.m4a" });
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES (?, 0, 20000, 'cloud words', 'cloud')", [waiting.id]);
    expect(pendingTranscriptions(db)).toEqual([{ sessionId: waiting.id, parts: [{ file: "p0.m4a", startMs: 0, durationMs: 20_000 }] }]);
  });

  it("recoverSessions sets the length and end time from the saved audio parts", () => {
    insertSession("crashed", "recording", "live", 5000);
    savePart(db, deps(), "crashed", { index: 0, startMs: 0, durationMs: 300_000, file: "a0.m4a" });
    savePart(db, deps(), "crashed", { index: 1, startMs: 320_000, durationMs: 40_000, file: "a1.m4a" });
    insertSession("empty", "paused", "waiting", 7000);
    recoverSessions(db, { sessionId: "", state: "idle" });
    expect(getSession(db, "crashed")).toMatchObject({ recordedMs: 340_000, endedAt: 5000 + 360_000 });
    expect(getSession(db, "empty")).toMatchObject({ recordedMs: 0, endedAt: 7000 });
  });

  it("savePart stores the part index as its position", () => {
    const session = startRecordingSession(db, deps(), homeId, false);
    savePart(db, deps(), session.id, { index: 3, startMs: 900_000, durationMs: 1000, file: "a3.m4a" });
    expect(db.get<{ position: number }>("SELECT position FROM captures WHERE file = 'a3.m4a'")?.position).toBe(3);
  });

  it("pendingTranscriptions includes interrupted sessions that are waiting", () => {
    insertSession("crashed", "recording", "live");
    savePart(db, deps(), "crashed", { index: 0, startMs: 0, durationMs: 20_000, file: "c0.m4a" });
    recoverSessions(db, { sessionId: "", state: "idle" });
    expect(pendingTranscriptions(db)).toEqual([{ sessionId: "crashed", parts: [{ file: "c0.m4a", startMs: 0, durationMs: 20_000 }] }]);
  });

  it("leaves another member's recording in a shared space alone when this phone holds none of it", () => {
    shareSpace(homeId);
    insertSession("theirs", "recording", "live", 1000);
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, 2000)).toEqual([]);
    expect(getSession(db, "theirs")?.state).toBe("recording");
  });

  it("leaves it alone when this phone has only downloaded its synced audio", () => {
    shareSpace(homeId);
    insertSession("theirs", "recording", "live", 1000);
    savePart(db, deps(), "theirs", { index: 0, startMs: 0, durationMs: 20_000, file: "sessions/theirs/synced/cap.m4a" });
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, 2000)).toEqual([]);
  });

  it("recovers a recording in a shared space that this phone started", () => {
    shareSpace(homeId);
    const mine = startRecordingSession(db, deps(), homeId, true);
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, 2000)).toEqual([mine.id]);
    expect(getSession(db, mine.id)?.state).toBe("interrupted");
  });

  it("still recovers a crashed recording after this phone has started another one", () => {
    shareSpace(homeId);
    const crashed = startRecordingSession(db, deps(), homeId, true);
    const next = startRecordingSession(db, deps(), homeId, true);
    finishRecording(db, next.id, 3000, 1000);
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, 4000)).toEqual([crashed.id]);
  });

  it("leaves a shared recording alone when this phone made its earlier audio but another phone may be continuing it", () => {
    shareSpace(homeId);
    insertSession("old", "recording", "live", 1000);
    savePart(db, deps(), "old", { index: 0, startMs: 0, durationMs: 20_000, file: "sessions/old/audio-0.m4a" });
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, 30_000)).toEqual([]);
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, 21_000 + 24 * 60 * 60 * 1000)).toEqual(["old"]);
    expect(getSession(db, "old")?.state).toBe("interrupted");
  });

  it("orders parts by time when two phones gave them the same number", () => {
    const session = startRecordingSession(db, deps(), homeId, false);
    finishRecording(db, session.id, 9000, 0);
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, duration_ms) VALUES ('z', ?, 'audio', 100000, 1, 'first.m4a', 20000)", [session.id]);
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, duration_ms) VALUES ('a', ?, 'audio', 200000, 1, 'second.m4a', 20000)", [session.id]);
    expect(pendingTranscriptions(db)[0]?.parts.map((part) => part.file)).toEqual(["first.m4a", "second.m4a"]);
  });

  it("closes another phone's recording once it has been unfinished for a day", () => {
    shareSpace(homeId);
    insertSession("gone", "recording", "live", 1000);
    const day = 24 * 60 * 60 * 1000;
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, 1000 + day - 1)).toEqual([]);
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, 1000 + day)).toEqual(["gone"]);
  });

  it("clears this phone's marker when a recording finishes, is recovered or is deleted", () => {
    const count = (): number => db.get<{ n: number }>("SELECT count(*) AS n FROM settings WHERE key LIKE 'recording_here:%'")?.n ?? 0;
    const finished = startRecordingSession(db, deps(), homeId, true);
    finishRecording(db, finished.id, 3000, 1000);
    expect(count()).toBe(0);
    startRecordingSession(db, deps(), homeId, true);
    recoverSessions(db, { sessionId: "", state: "idle" }, 2000);
    expect(count()).toBe(0);
    const discarded = startRecordingSession(db, deps(), homeId, true);
    deleteSessionRow(db, discarded.id);
    expect(count()).toBe(0);
  });
});

describe("continueRecordingSession", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  // A finished session: one audio part at 0 and a second at 100 s, saved at 120 s.
  function savedSession(speechReady = true): string {
    const session = startRecordingSession(db, deps(1000), homeId, speechReady);
    savePart(db, deps(), session.id, { index: 0, startMs: 0, durationMs: 20_000, file: "a0.m4a" });
    savePart(db, deps(), session.id, { index: 2, startMs: 100_000, durationMs: 30_000, file: "a2.m4a" });
    finishRecording(db, session.id, 120_000, 50_000);
    return session.id;
  }

  it("returns the next part number, the recorded length and the elapsed time, and sets the row to recording", () => {
    const id = savedSession();
    const continued = continueRecordingSession(db, deps(500_000), id, true);
    expect(continued?.from).toEqual({ elapsedMs: 499_000, firstIndex: 3, priorRecordedMs: 50_000 });
    expect(getSession(db, id)).toMatchObject({ state: "recording", endedAt: 500_000 });
  });

  it("starts at least a second after the last saved part when the clock says otherwise", () => {
    const id = savedSession();
    const continued = continueRecordingSession(db, deps(1500), id, true);
    expect(continued?.from.elapsedMs).toBe(131_000);
  });

  it("maps the transcript: done becomes live with speech and waiting without, failed and waiting stay waiting", () => {
    const done = savedSession(true);
    expect(continueRecordingSession(db, deps(500_000), done, true)?.session.transcript).toBe("live");
    const doneNoSpeech = savedSession(true);
    expect(continueRecordingSession(db, deps(500_000), doneNoSpeech, false)?.session.transcript).toBe("waiting");
    const failed = savedSession(true);
    db.run("UPDATE sessions SET transcript = 'failed' WHERE id = ?", [failed]);
    expect(continueRecordingSession(db, deps(500_000), failed, true)?.session.transcript).toBe("waiting");
    const waiting = savedSession(false);
    expect(continueRecordingSession(db, deps(500_000), waiting, true)?.session.transcript).toBe("waiting");
  });

  it("returns null for a missing session, a pages session and a session still recording", () => {
    expect(continueRecordingSession(db, deps(), "nope", true)).toBeNull();
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at) VALUES ('pg', ?, 'pages', 't', 'saved', 'waiting', 1000)", [
      homeId,
    ]);
    expect(continueRecordingSession(db, deps(), "pg", true)).toBeNull();
    const active = startRecordingSession(db, deps(), homeId, true);
    expect(continueRecordingSession(db, deps(), active.id, true)).toBeNull();
  });

  it("returns what the session already holds: words, parts, resumes, flags and photos", () => {
    const id = startRecordingSession(db, deps(1000), homeId, true).id;
    saveSegment(db, id, { tStart: 0, tEnd: 5000, text: "hello" });
    savePart(db, deps(), id, { index: 0, startMs: 0, durationMs: 60_000, file: "a0.m4a" });
    savePart(db, deps(), id, { index: 1, startMs: 90_000, durationMs: 30_000, file: "a1.m4a" });
    addFlag(db, deps(), id, 42_000);
    const photoId = addPhoto(db, deps(), id, 50_000, "sessions/s/photo.jpg");
    finishRecording(db, id, 120_000, 90_000);
    const continued = continueRecordingSession(db, deps(500_000), id, true);
    expect(continued?.prior).toEqual({
      finals: [{ tStart: 0, tEnd: 5000, text: "hello", isFinal: true }],
      parts: [
        { sessionId: id, index: 0, startMs: 0, durationMs: 60_000, file: "a0.m4a" },
        { sessionId: id, index: 1, startMs: 90_000, durationMs: 30_000, file: "a1.m4a" },
      ],
      resumes: [90_000],
      flags: [42_000],
      photos: [{ id: photoId, t: 50_000, file: "sessions/s/photo.jpg" }],
    });
  });

  it("undoContinue restores state, transcript and ended_at and clears this phone's marker", () => {
    const id = savedSession();
    const continued = continueRecordingSession(db, deps(500_000), id, true);
    expect(continued).not.toBeNull();
    undoContinue(db, id, continued!.restore);
    expect(getSession(db, id)).toMatchObject({ state: "saved", transcript: "done", endedAt: 120_000 });
    expect(db.get("SELECT key FROM settings WHERE key = ?", [`recording_here:${id}`])).toBeNull();
  });

  it("a continued session that crashes keeps its earlier length and is recovered", () => {
    const id = savedSession();
    continueRecordingSession(db, deps(200_000), id, true);
    savePart(db, deps(), id, { index: 3, startMs: 100_000, durationMs: 20_000, file: "a3.m4a" });
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, 300_000)).toEqual([id]);
    expect(getSession(db, id)).toMatchObject({ state: "interrupted", recordedMs: 70_000 });
    expect(getSession(db, id)?.endedAt).toBeGreaterThanOrEqual(1000 + 120_000);
  });

  it("in a shared space, a session reopened an hour ago on another phone is left alone until its last activity is a day old", () => {
    shareSpace(homeId);
    const now = 3 * DAY;
    insertSession("reopened", "recording", "live", now - 2 * DAY);
    db.run("UPDATE sessions SET ended_at = ? WHERE id = ?", [now - HOUR, "reopened"]);
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, now)).toEqual([]);
    insertSession("idle", "recording", "live", now - 3 * DAY);
    db.run("UPDATE sessions SET ended_at = ? WHERE id = ?", [now - 2 * DAY, "idle"]);
    expect(recoverSessions(db, { sessionId: "", state: "idle" }, now)).toEqual(["idle"]);
    expect(getSession(db, "reopened")?.state).toBe("recording");
  });
});

describe("isLiveSession", () => {
  it("is true only for this iPhone's active recorder on that session", () => {
    expect(isLiveSession({ sessionId: "a", state: "recording" }, "a")).toBe(true);
    expect(isLiveSession({ sessionId: "a", state: "paused" }, "a")).toBe(true);
    expect(isLiveSession({ sessionId: "a", state: "idle" }, "a")).toBe(false);
    expect(isLiveSession({ sessionId: "b", state: "recording" }, "a")).toBe(false);
    expect(isLiveSession({ sessionId: "", state: "idle" }, "a")).toBe(false);
  });
});
