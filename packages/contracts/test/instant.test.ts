import { describe, expect, test } from "vitest";
import {
  ExplainRequestSchema,
  StreamDeltaSchema,
  StreamDoneSchema,
  TRANSCRIPT_MAX_CHARS,
  WORD_MAX_CHARS,
} from "../src/instant.ts";

const GOOD_EXPLAIN = { word: "osmosis", transcript: "the cell takes in water" };

const GOOD_DONE = { credits: 0, tier: "strong", retention: "zero", offer_research: true };

describe("ExplainRequestSchema", () => {
  test("accepts a word and transcript, and trims the word", () => {
    expect(ExplainRequestSchema.parse(GOOD_EXPLAIN)).toEqual(GOOD_EXPLAIN);
    expect(ExplainRequestSchema.parse({ ...GOOD_EXPLAIN, word: " osmosis " }).word).toBe("osmosis");
  });

  test("rejects an empty or blank word, an over-long word, and a wrong word type", () => {
    const bad = [
      { ...GOOD_EXPLAIN, word: "" },
      { ...GOOD_EXPLAIN, word: "   " },
      { ...GOOD_EXPLAIN, word: "a".repeat(WORD_MAX_CHARS + 1) },
      { ...GOOD_EXPLAIN, word: 42 },
    ];
    for (const body of bad) expect(ExplainRequestSchema.safeParse(body).success).toBe(false);
  });

  test("rejects an empty transcript, an over-long transcript, a missing field, and an extra key", () => {
    const bad = [
      { ...GOOD_EXPLAIN, transcript: "" },
      { ...GOOD_EXPLAIN, transcript: "a".repeat(TRANSCRIPT_MAX_CHARS + 1) },
      { word: "osmosis" },
      { ...GOOD_EXPLAIN, extra: true },
    ];
    for (const body of bad) expect(ExplainRequestSchema.safeParse(body).success).toBe(false);
  });

  test("accepts a word of exactly 100 characters and a transcript of exactly 4,000", () => {
    const body = { word: "a".repeat(WORD_MAX_CHARS), transcript: "b".repeat(TRANSCRIPT_MAX_CHARS) };
    expect(ExplainRequestSchema.safeParse(body).success).toBe(true);
  });
});

describe("stream event schemas", () => {
  test("StreamDeltaSchema rejects an empty text", () => {
    expect(StreamDeltaSchema.safeParse({ text: "" }).success).toBe(false);
  });

  test("StreamDoneSchema accepts a done event and rejects bad credits, tier and extra keys", () => {
    expect(StreamDoneSchema.safeParse(GOOD_DONE).success).toBe(true);
    expect(StreamDoneSchema.safeParse({ ...GOOD_DONE, credits: -1 }).success).toBe(false);
    expect(StreamDoneSchema.safeParse({ ...GOOD_DONE, tier: "huge" }).success).toBe(false);
    expect(StreamDoneSchema.safeParse({ ...GOOD_DONE, extra: 1 }).success).toBe(false);
  });
});
