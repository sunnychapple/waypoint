import { beforeEach, describe, expect, it } from "vitest";
import { shortDay } from "../src/core/format.ts";
import { DEFAULT_RECORDING_TITLE, nameRecording, recordingTitle, startRecordingSession } from "../src/core/capture/recording.ts";
import { createSession, getSession, renameSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { createMemoryDb } from "./helpers/db.ts";

// Local time, so the test does not depend on the machine's time zone.
const startedAt = new Date(2026, 10, 20, 16, 5).getTime();

describe("recordingTitle", () => {
  it("takes the first line with letters from the transcript", () => {
    expect(recordingTitle("Today we start photosynthesis", startedAt)).toBe("Today we start photosynthesis");
    expect(recordingTitle("12 34\n  Photosynthesis needs light  \nmore", startedAt)).toBe("Photosynthesis needs light");
  });

  it("trims a long first line to 60 characters at a word boundary", () => {
    const title = recordingTitle("the quick brown fox jumps over the lazy dog and keeps on running far away into the forest", startedAt);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toBe("the quick brown fox jumps over the lazy dog and keeps on");
  });

  it("falls back to the day and time when there is no usable text", () => {
    for (const text of [null, "", "  \n 1 2 3 ", "ok"]) {
      const title = recordingTitle(text, startedAt);
      expect(title.startsWith("Recording · ")).toBe(true);
      expect(title).toContain(shortDay(startedAt));
      expect(title).toContain(new Date(startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
    }
    const dated = recordingTitle(null, startedAt);
    expect(dated).toMatch(/^Recording · \S+ .+, .*\d.*$/);
    expect(dated.length).toBeLessThanOrEqual(80);
  });
});

describe("nameRecording", () => {
  let db: SqlDb;
  let ids: number;
  let spaceId: string;
  const deps = { now: () => startedAt, newId: () => `id-${++ids}` };

  beforeEach(() => {
    db = createMemoryDb();
    migrate(db);
    ids = 0;
    spaceId = ensureDefaultSpace(db, deps).id;
  });

  function addSegment(sessionId: string, tStart: number, text: string): void {
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES (?, ?, ?, ?, 'device')", [sessionId, tStart, tStart + 1000, text]);
  }

  it("names an unnamed recording from its first words", () => {
    const session = startRecordingSession(db, deps, spaceId, true);
    addSegment(session.id, 0, "Welcome to biology");
    addSegment(session.id, 4000, "Cells have membranes");
    nameRecording(db, session.id);
    expect(getSession(db, session.id)?.title).toBe("Welcome to biology Cells have membranes");
  });

  it("uses the date and time when nothing was transcribed", () => {
    const session = startRecordingSession(db, deps, spaceId, false);
    nameRecording(db, session.id);
    expect(getSession(db, session.id)?.title).toBe(recordingTitle(null, startedAt));
  });

  it("does not overwrite a title the person already changed", () => {
    const session = startRecordingSession(db, deps, spaceId, true);
    addSegment(session.id, 0, "Welcome to biology");
    renameSession(db, session.id, "Bio class");
    nameRecording(db, session.id);
    expect(getSession(db, session.id)?.title).toBe("Bio class");
  });

  it("leaves a session that is not on the default title alone even without words", () => {
    const row = createSession(db, deps, { spaceId, kind: "recording", title: DEFAULT_RECORDING_TITLE, state: "saved" });
    renameSession(db, row.id, "Pages");
    nameRecording(db, row.id);
    expect(getSession(db, row.id)?.title).toBe("Pages");
  });
});
