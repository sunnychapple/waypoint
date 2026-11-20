import { describe, expect, it } from "vitest";
import { partAt } from "../src/core/capture/playback.ts";

// Two parts with a 10 s pause between them: 0–60 s and 70–100 s on the session's clock.
const PARTS = [
  { startMs: 0, durationMs: 60_000 },
  { startMs: 70_000, durationMs: 30_000 },
];

describe("partAt", () => {
  it("finds the part that holds a time and the offset into it", () => {
    expect(partAt(PARTS, 0)).toEqual({ index: 0, offsetMs: 0 });
    expect(partAt(PARTS, 59_999)).toEqual({ index: 0, offsetMs: 59_999 });
    expect(partAt(PARTS, 85_000)).toEqual({ index: 1, offsetMs: 15_000 });
  });

  it("a time in the pause starts the next part from its beginning", () => {
    expect(partAt(PARTS, 65_000)).toEqual({ index: 1, offsetMs: 0 });
  });

  it("a time after the end goes to the end of the last part", () => {
    expect(partAt(PARTS, 500_000)).toEqual({ index: 1, offsetMs: 30_000 });
  });

  it("a part of unknown length runs until the next one starts", () => {
    const parts = [
      { startMs: 0, durationMs: 0 },
      { startMs: 70_000, durationMs: 0 },
    ];
    expect(partAt(parts, 65_000)).toEqual({ index: 0, offsetMs: 65_000 });
    expect(partAt(parts, 200_000)).toEqual({ index: 1, offsetMs: 130_000 });
  });

  it("exact boundaries: the end of a part belongs to what follows, the end of the last part stays on it", () => {
    expect(partAt(PARTS, 60_000)).toEqual({ index: 1, offsetMs: 0 });
    expect(partAt(PARTS, 70_000)).toEqual({ index: 1, offsetMs: 0 });
    expect(partAt(PARTS, 100_000)).toEqual({ index: 1, offsetMs: 30_000 });
    const touching = [
      { startMs: 0, durationMs: 60_000 },
      { startMs: 60_000, durationMs: 30_000 },
    ];
    expect(partAt(touching, 60_000)).toEqual({ index: 1, offsetMs: 0 });
  });

  it("a last part of unknown length runs on without end", () => {
    expect(partAt([{ startMs: 5_000, durationMs: 0 }], 1_000_000)).toEqual({ index: 0, offsetMs: 995_000 });
  });

  it("no parts: null", () => {
    expect(partAt([], 1_000)).toBeNull();
  });
});
