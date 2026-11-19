import { describe, expect, test } from "vitest";
import {
  ANSWER_MAX_CHARS,
  DoubleCheckResponseSchema,
  ExplainRequestSchema,
  FollowUpRequestSchema,
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

describe("FollowUpRequestSchema", () => {
  const GOOD_FOLLOW_UP = { ...GOOD_EXPLAIN, answer: "It is water moving across a membrane." };

  test("accepts a word, transcript and answer", () => {
    expect(FollowUpRequestSchema.parse(GOOD_FOLLOW_UP)).toEqual(GOOD_FOLLOW_UP);
  });

  test("rejects a missing answer, a blank answer, an answer of 4,001 characters and an extra key", () => {
    const bad = [
      { word: "osmosis", transcript: "the cell takes in water" },
      { ...GOOD_FOLLOW_UP, answer: "  " },
      { ...GOOD_FOLLOW_UP, answer: "a".repeat(ANSWER_MAX_CHARS + 1) },
      { ...GOOD_FOLLOW_UP, extra: true },
    ];
    for (const body of bad) expect(FollowUpRequestSchema.safeParse(body).success).toBe(false);
  });

  test("accepts an answer of exactly 4,000 characters", () => {
    expect(FollowUpRequestSchema.safeParse({ ...GOOD_FOLLOW_UP, answer: "b".repeat(ANSWER_MAX_CHARS) }).success).toBe(true);
  });
});

describe("DoubleCheckResponseSchema", () => {
  test("accepts a good reply and rejects an empty text and an extra key", () => {
    const good = { text: "Correct.", credits: 4, tier: "strong", retention: "standard" };
    expect(DoubleCheckResponseSchema.safeParse(good).success).toBe(true);
    expect(DoubleCheckResponseSchema.safeParse({ ...good, text: "" }).success).toBe(false);
    expect(DoubleCheckResponseSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
  });
});
