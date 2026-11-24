import { describe, expect, it } from "vitest";
import {
  EMPTY_LIVE,
  addPiece,
  partUpdate,
  partsNeedingTranscription,
  piecesToKeep,
  replacementFor,
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

describe("replacementFor", () => {
  const part = { startMs: 60_000, durationMs: 60_000 };

  it("replaces a short live segment that starts where a longer piece starts", () => {
    const longer = { tStart: 60_000, tEnd: 80_000 };
    expect(replacementFor(part, [longer], [{ tStart: 60_000, tEnd: 63_000 }])).toEqual([longer]);
  });

  it("replaces a part's segments when the pieces overlap them and cover more", () => {
    const pieces = [
      { tStart: 65_000, tEnd: 80_000 },
      { tStart: 80_000, tEnd: 110_000 },
    ];
    expect(replacementFor(part, pieces, [{ tStart: 60_000, tEnd: 68_000 }])).toEqual(pieces);
  });

  it("keeps what is there when the second pass covers no more of the part", () => {
    const existing = [{ tStart: 60_000, tEnd: 90_000 }];
    expect(replacementFor(part, [{ tStart: 60_000, tEnd: 70_000 }], existing)).toBeNull();
    expect(replacementFor(part, [{ tStart: 60_000, tEnd: 90_000 }], existing)).toBeNull();
    expect(replacementFor(part, [], existing)).toBeNull();
  });

  it("leaves out a piece that mostly repeats a segment spilling in from the part before", () => {
    const repeat = { tStart: 60_000, tEnd: 64_000 };
    const fresh = { tStart: 64_000, tEnd: 100_000 };
    expect(replacementFor(part, [repeat, fresh], [{ tStart: 55_000, tEnd: 64_000 }])).toEqual([fresh]);
  });

  it("does not count a segment of the next part as this part's own", () => {
    const piece = { tStart: 60_000, tEnd: 100_000 };
    expect(replacementFor(part, [piece], [{ tStart: 120_000, tEnd: 130_000 }])).toEqual([piece]);
  });

  it("keeps a segment that runs on into the next part, and leaves out a piece that mostly repeats it", () => {
    const pieces = [
      { tStart: 117_000, tEnd: 120_000 },
      { tStart: 10_000, tEnd: 60_000 },
    ];
    expect(replacementFor({ startMs: 0, durationMs: 120_000 }, pieces, [{ tStart: 118_000, tEnd: 123_000 }])).toEqual([
      { tStart: 10_000, tEnd: 60_000 },
    ]);
  });

  it("returns null unless the second pass writes down at least 2 seconds more of the part", () => {
    const whole = { startMs: 0, durationMs: 60_000 };
    const existing = [{ tStart: 0, tEnd: 10_000 }];
    expect(replacementFor(whole, [{ tStart: 0, tEnd: 11_000 }], existing)).toBeNull();
    const more = [{ tStart: 0, tEnd: 13_000 }];
    expect(replacementFor(whole, more, existing)).toEqual(more);
  });
});

describe("partUpdate (Next 1)", () => {
  const part = { startMs: 60_000, durationMs: 10_000 };
  const span = (tStart: number, tEnd: number) => ({ tStart, tEnd });

  it("with no marks, it is replacementFor", () => {
    const pieces = [span(60_000, 62_000)];
    expect(partUpdate(part, pieces, [], [])).toEqual({ replace: true, pieces: replacementFor(part, pieces, [], 2_000) });
    expect(partUpdate(part, pieces, [], [])).toEqual({ replace: true, pieces });
  });

  it("a mark inside the part keeps every line, and adds only pieces that fill a hole", () => {
    const existing = [span(60_000, 61_000)];
    const repeat = span(60_000, 61_000);
    const hole = span(64_000, 66_000);
    expect(partUpdate(part, [repeat, hole], existing, [60_000])).toEqual({ replace: false, pieces: [hole] });
  });

  it("a mark inside the part with no hole to fill writes nothing", () => {
    const existing = [span(60_000, 68_000)];
    expect(partUpdate(part, [span(60_000, 62_000)], existing, [60_000])).toBeNull();
  });

  it("a mark inside the part drops new pieces that mostly repeat a changed line", () => {
    const existing = [span(60_000, 61_000)];
    const mostlyRepeat = span(60_400, 62_400); // 600 ms of 2000 overlap the changed line: over a quarter
    const quarter = span(60_500, 62_500); // exactly a quarter: kept
    const hole = span(64_000, 66_000);
    expect(partUpdate(part, [mostlyRepeat, quarter, hole], existing, [60_000])).toEqual({ replace: false, pieces: [quarter, hole] });
  });

  it("a mark in another part does not stop the replacement", () => {
    const pieces = [span(60_000, 62_000)];
    expect(partUpdate(part, pieces, [], [0, 120_000])).toEqual({ replace: true, pieces });
  });
});
