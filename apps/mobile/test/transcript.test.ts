import { describe, expect, it } from "vitest";
import {
  EMPTY_LIVE,
  addPiece,
  partsNeedingTranscription,
  piecesToKeep,
  type Piece,
} from "../src/core/capture/transcript.ts";

const piece = (tStart: number, text: string, isFinal: boolean): Piece => ({ tStart, tEnd: tStart + 1000, text, isFinal });

describe("transcript", () => {
  it("a volatile piece followed by its final leaves one final and no volatile", () => {
    let live = addPiece(EMPTY_LIVE, piece(0, "hel", false));
    expect(live.volatile?.text).toBe("hel");
    live = addPiece(live, piece(0, "hello", true));
    expect(live.finals.map((p) => p.text)).toEqual(["hello"]);
    expect(live.volatile).toBeNull();
  });

  it("a duplicate final with the same tStart is ignored", () => {
    let live = addPiece(EMPTY_LIVE, piece(0, "hello", true));
    live = addPiece(live, piece(0, "hello again", true));
    expect(live.finals.map((p) => p.text)).toEqual(["hello"]);
  });

  it("a final that arrives out of order is inserted in tStart order", () => {
    let live = addPiece(EMPTY_LIVE, piece(5000, "second", true));
    live = addPiece(live, piece(0, "first", true));
    expect(live.finals.map((p) => p.text)).toEqual(["first", "second"]);
  });

  it("partsNeedingTranscription keeps only long parts that no segment overlaps", () => {
    const parts = [
      { startMs: 0, durationMs: 60_000 },
      { startMs: 60_000, durationMs: 60_000 },
      { startMs: 120_000, durationMs: 5_000 },
    ];
    const segments = [{ tStart: 0, tEnd: 60_000 }];
    expect(partsNeedingTranscription(parts, segments)).toEqual([{ startMs: 60_000, durationMs: 60_000 }]);
    // A segment that only touches the end edge of a part does not overlap it.
    expect(partsNeedingTranscription([{ startMs: 0, durationMs: 60_000 }], [{ tStart: 60_000, tEnd: 70_000 }])).toEqual([
      { startMs: 0, durationMs: 60_000 },
    ]);
  });

  it("a segment that only touches the start edge of a part does not overlap it", () => {
    const part = { startMs: 60_000, durationMs: 60_000 };
    expect(partsNeedingTranscription([part], [{ tStart: 50_000, tEnd: 60_000 }])).toEqual([part]);
  });

  it("a part of exactly 10 seconds still needs transcription; one of 9,999 ms does not", () => {
    expect(partsNeedingTranscription([{ startMs: 0, durationMs: 10_000 }], [])).toEqual([{ startMs: 0, durationMs: 10_000 }]);
    expect(partsNeedingTranscription([{ startMs: 0, durationMs: 9_999 }], [])).toEqual([]);
  });

  it("a 300-second part with one segment over its first 60 seconds is returned (the hole case)", () => {
    const part = { startMs: 0, durationMs: 300_000 };
    expect(partsNeedingTranscription([part], [{ tStart: 0, tEnd: 60_000 }])).toEqual([part]);
  });

  it("a 60-second part covered by segments with gaps under 10 seconds is not returned", () => {
    const part = { startMs: 0, durationMs: 60_000 };
    const segments = [
      { tStart: 0, tEnd: 20_000 },
      { tStart: 25_000, tEnd: 45_000 },
      { tStart: 50_000, tEnd: 60_000 },
    ];
    expect(partsNeedingTranscription([part], segments)).toEqual([]);
  });

  it("a part shorter than minMs is not returned", () => {
    expect(partsNeedingTranscription([{ startMs: 0, durationMs: 5_000 }], [])).toEqual([]);
  });
});

describe("piecesToKeep", () => {
  it("a piece inside a hole is kept", () => {
    const piece = { tStart: 0, tEnd: 10_000 };
    expect(piecesToKeep([piece], [])).toEqual([piece]);
  });

  it("a piece fully covered is dropped", () => {
    expect(piecesToKeep([{ tStart: 0, tEnd: 10_000 }], [{ tStart: 0, tEnd: 10_000 }])).toEqual([]);
  });

  it("a piece covered exactly half is dropped", () => {
    expect(piecesToKeep([{ tStart: 0, tEnd: 10_000 }], [{ tStart: 0, tEnd: 5_000 }])).toEqual([]);
  });

  it("a piece covered under half is kept", () => {
    const piece = { tStart: 0, tEnd: 10_000 };
    expect(piecesToKeep([piece], [{ tStart: 0, tEnd: 4_000 }])).toEqual([piece]);
  });

  it("overlapping existing segments are counted once", () => {
    // Their union covers 4,000 ms, which is under half of 10,000 ms. Counted twice it would be 6,000 ms and dropped.
    const piece = { tStart: 0, tEnd: 10_000 };
    const existing = [
      { tStart: 0, tEnd: 3_000 },
      { tStart: 1_000, tEnd: 4_000 },
    ];
    expect(piecesToKeep([piece], existing)).toEqual([piece]);
  });

  it("a zero-length piece inside a segment is dropped and outside one is kept", () => {
    const existing = [{ tStart: 0, tEnd: 10_000 }];
    expect(piecesToKeep([{ tStart: 5_000, tEnd: 5_000 }], existing)).toEqual([]);
    const outside = { tStart: 20_000, tEnd: 20_000 };
    expect(piecesToKeep([outside], existing)).toEqual([outside]);
  });
});
