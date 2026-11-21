import { beforeEach, describe, expect, it } from "vitest";
import {
  addFlag,
  addPhoto,
  finishRecording,
  isLiveSession,
  pendingTranscriptions,
  recoverSessions,
  saveSegment,
  savePart,
  setPaused,
  startRecordingSession,
} from "../src/core/capture/recording.ts";
import { getSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
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
