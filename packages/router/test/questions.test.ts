import { describe, expect, test } from "vitest";
import { ROUTER_QUESTIONS, RouterAnswersSchema, type RouterAnswers } from "../src/index.ts";

const valid: RouterAnswers = {
  difficulty: { value: 3, p: 0.8 },
  needs_web: { value: false, p: 0.9 },
  subject: { value: "history", p: 0.7 },
  unsafe: { value: false, p: 0.95 },
};

describe("RouterAnswersSchema", () => {
  test("accepts a valid answer set", () => {
    expect(RouterAnswersSchema.parse(valid)).toEqual(valid);
  });

  test("rejects a difficulty of 6", () => {
    const result = RouterAnswersSchema.safeParse({ ...valid, difficulty: { value: 6, p: 0.8 } });
    expect(result.success).toBe(false);
  });

  test("rejects a probability above 1", () => {
    const result = RouterAnswersSchema.safeParse({ ...valid, unsafe: { value: true, p: 1.5 } });
    expect(result.success).toBe(false);
  });

  test("rejects a negative probability", () => {
    const result = RouterAnswersSchema.safeParse({ ...valid, needs_web: { value: true, p: -0.1 } });
    expect(result.success).toBe(false);
  });

  test("rejects a subject outside the choices", () => {
    const result = RouterAnswersSchema.safeParse({ ...valid, subject: { value: "art", p: 0.9 } });
    expect(result.success).toBe(false);
  });

  test("accepts probabilities of exactly 0 and 1", () => {
    const edges = {
      ...valid,
      needs_web: { value: true, p: 0 },
      unsafe: { value: false, p: 1 },
    };
    expect(RouterAnswersSchema.parse(edges)).toEqual(edges);
  });

  test("rejects difficulty 0 and difficulty 2.5", () => {
    expect(
      RouterAnswersSchema.safeParse({ ...valid, difficulty: { value: 0, p: 0.8 } }).success,
    ).toBe(false);
    expect(
      RouterAnswersSchema.safeParse({ ...valid, difficulty: { value: 2.5, p: 0.8 } }).success,
    ).toBe(false);
  });

  test("rejects extra keys at the top level and inside an answer", () => {
    expect(RouterAnswersSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(
      RouterAnswersSchema.safeParse({ ...valid, unsafe: { value: false, p: 0.9, note: "x" } })
        .success,
    ).toBe(false);
  });
});

describe("ROUTER_QUESTIONS", () => {
  test("describes the four questions in architecture section 6", () => {
    expect(Object.keys(ROUTER_QUESTIONS)).toEqual(["difficulty", "needs_web", "subject", "unsafe"]);
    expect(ROUTER_QUESTIONS.difficulty.range).toEqual([1, 5]);
    expect(ROUTER_QUESTIONS.subject.options).toEqual(["math", "science", "language", "history", "other"]);
  });
});
