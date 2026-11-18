import { describe, expect, test } from "vitest";
import { RouterAnswersSchema, type RouterAnswers } from "../src/index.ts";

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
});
