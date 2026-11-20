import { expect, test } from "vitest";
import { AudioDoneRequestSchema, RetranscribeResultSchema } from "../src/retranscribe.ts";

test("AudioDoneRequestSchema accepts 1 and 200 chunks", () => {
  expect(AudioDoneRequestSchema.safeParse({ chunks: 1 }).success).toBe(true);
  expect(AudioDoneRequestSchema.safeParse({ chunks: 200 }).success).toBe(true);
});

test("AudioDoneRequestSchema rejects 0, 201, 1.5 and an extra key", () => {
  expect(AudioDoneRequestSchema.safeParse({ chunks: 0 }).success).toBe(false);
  expect(AudioDoneRequestSchema.safeParse({ chunks: 201 }).success).toBe(false);
  expect(AudioDoneRequestSchema.safeParse({ chunks: 1.5 }).success).toBe(false);
  expect(AudioDoneRequestSchema.safeParse({ chunks: 1, extra: true }).success).toBe(false);
});

test("RetranscribeResultSchema accepts a chunk with a null duration and one with a number", () => {
  const result = {
    v: 1,
    truncated: false,
    chunks: [
      { n: 0, duration: null, text: "a", segments: [] },
      { n: 1, duration: 12.5, text: "b", segments: [{ start: 0, end: 1.2, text: "b" }] },
    ],
  };
  expect(RetranscribeResultSchema.safeParse(result).success).toBe(true);
});

test("RetranscribeResultSchema rejects a result without truncated", () => {
  expect(RetranscribeResultSchema.safeParse({ v: 1, chunks: [] }).success).toBe(false);
});
