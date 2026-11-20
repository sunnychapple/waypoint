import { describe, expect, it } from "vitest";
import { CHUNK_WORDS, chunkCapture, chunkTranscript } from "../src/core/search/chunks.ts";

const words = (n: number, word = "w"): string => Array.from({ length: n }, () => word).join(" ");
const count = (text: string): number => text.split(/\s+/).filter(Boolean).length;

describe("chunks", () => {
  it("packs segments into chunks of at most 120 words", () => {
    const segments = Array.from({ length: 10 }, (_, i) => ({ tStart: i * 1000, tEnd: i * 1000 + 900, text: words(30) }));
    const chunks = chunkTranscript(segments);
    expect(chunks.map((c) => count(c.text))).toEqual([120, 120, 60]);
    expect(chunks.every((c) => count(c.text) <= CHUNK_WORDS)).toBe(true);
  });

  it("a segment longer than 120 words is a chunk on its own", () => {
    const long = words(300, "long");
    const chunks = chunkTranscript([
      { tStart: 0, tEnd: 1000, text: "short" },
      { tStart: 1000, tEnd: 5000, text: long },
      { tStart: 5000, tEnd: 6000, text: "after" },
    ]);
    expect(chunks.map((c) => c.text)).toEqual(["short", long, "after"]);
  });

  it("a transcript chunk takes its start and end times from its first and last segment", () => {
    const chunks = chunkTranscript([
      { tStart: 1000, tEnd: 2000, text: "one" },
      { tStart: 2000, tEnd: 3500, text: "two" },
    ]);
    expect(chunks).toEqual([{ source: "transcript", captureId: null, tStart: 1000, tEnd: 3500, text: "one two" }]);
  });

  it("a page splits at blank lines into paragraphs, and an oversized paragraph is split by words", () => {
    const page = { id: "cap-1", kind: "page" as const, t: 4000, text: `first paragraph\n\n${words(130)}\n\nlast` };
    const chunks = chunkCapture(page);
    expect(chunks.map((c) => count(c.text))).toEqual([2, 120, 11]);
    expect(chunks.every((c) => count(c.text) <= CHUNK_WORDS)).toBe(true);
    expect(chunks.every((c) => c.source === "page" && c.captureId === "cap-1" && c.tStart === 4000 && c.tEnd === 4000)).toBe(true);
  });

  it("two paragraphs that add up to exactly 120 words stay in one chunk", () => {
    const chunks = chunkCapture({ id: "cap-3", kind: "page", t: 0, text: `${words(60)}\n\n${words(60)}` });
    expect(chunks.map((c) => count(c.text))).toEqual([120]);
  });

  it("empty text gives no chunks", () => {
    expect(chunkCapture({ id: "cap-2", kind: "photo", t: 0, text: "  \n\n " })).toEqual([]);
    expect(chunkTranscript([])).toEqual([]);
  });
});
