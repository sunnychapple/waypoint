import { describe, expect, it } from "vitest";
import { audioMinutes, diffWords, partText, saveCloudTranscript, uploadParts } from "../src/core/capture/second.ts";
import { savePart, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1000, newId: () => `id_${++n}` };
  const space = ensureDefaultSpace(db, deps);
  const session = startRecordingSession(db, deps, space.id, true);
  savePart(db, deps, session.id, { index: 1, startMs: 300_000, durationMs: 90_500, file: "b.m4a" });
  savePart(db, deps, session.id, { index: 0, startMs: 0, durationMs: 300_000, file: "a.m4a" });
  return { db, session };
}

describe("second transcript", () => {
  it("parts in position order, minutes rounded up", () => {
    const { db, session } = setup();
    const parts = uploadParts(db, session.id);
    expect(parts.map((p) => [p.n, p.file, p.startMs])).toEqual([[0, "a.m4a", 0], [1, "b.m4a", 300_000]]);
    expect(audioMinutes(parts)).toBe(7);
    expect(audioMinutes([])).toBe(1);
  });
  it("cloud segments replace earlier ones, offset by each part's start", () => {
    const { db, session } = setup();
    const parts = uploadParts(db, session.id);
    const result = {
      v: 1 as const,
      truncated: false,
      chunks: [
        { n: 1, duration: 90.5, text: "b", segments: [{ start: 1.5, end: 3, text: " the cell " }] },
        { n: 0, duration: 300, text: "a whole", segments: [] },
        { n: 9, duration: 1, text: "ignored", segments: [] },
      ],
    };
    expect(saveCloudTranscript(db, session.id, parts, result)).toBe(2);
    expect(saveCloudTranscript(db, session.id, parts, result)).toBe(2);
    const rows = db.all<{ t_start: number; t_end: number; text: string }>("SELECT t_start, t_end, text FROM segments WHERE source = 'cloud' ORDER BY t_start");
    expect(rows).toEqual([{ t_start: 0, t_end: 300_000, text: "a whole" }, { t_start: 301_500, t_end: 303_000, text: "the cell" }]);
  });
  it("diffWords marks cloud words the device did not have", () => {
    expect(diffWords("the my toe Condria is", "The mitochondria is,")).toEqual([
      { text: "The", changed: false },
      { text: "mitochondria", changed: true },
      { text: "is,", changed: false },
    ]);
    expect(diffWords("", "new words")).toEqual([{ text: "new", changed: true }, { text: "words", changed: true }]);
    expect(diffWords("same", "")).toEqual([]);
    const long = Array.from({ length: 2100 }, (_, i) => `w${i}`).join(" ");
    expect(diffWords(long, long + " extra").every((w) => !w.changed)).toBe(true);
  });
  it("partText reads one part of one source", () => {
    const { db, session } = setup();
    saveSegment(db, session.id, { tStart: 10, tEnd: 20, text: "one" });
    saveSegment(db, session.id, { tStart: 299_999, tEnd: 300_100, text: "two" });
    saveSegment(db, session.id, { tStart: 300_000, tEnd: 300_100, text: "three" });
    expect(partText(db, session.id, "device", { startMs: 0, durationMs: 300_000 })).toBe("one two");
  });
});
