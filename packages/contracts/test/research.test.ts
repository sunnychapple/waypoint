import { describe, expect, test } from "vitest";
import { ResearchResultSchema } from "../src/research.ts";

const RESULT = {
  v: 1,
  answer: "The sky looks blue because air scatters blue light [1][2].",
  sources: [
    { n: 1, url: "https://a.example/sky", title: "Sky A" },
    { n: 2, url: "https://b.example/light", title: "Light B" },
  ],
};

describe("research result schema", () => {
  test("a result with an answer and two numbered sources parses", () => {
    expect(ResearchResultSchema.parse(RESULT)).toEqual(RESULT);
    expect(ResearchResultSchema.safeParse({ ...RESULT, answer: "" }).success).toBe(false);
    expect(ResearchResultSchema.safeParse({ ...RESULT, sources: [{ ...RESULT.sources[0], n: 0 }] }).success).toBe(false);
    expect(ResearchResultSchema.safeParse({ answer: RESULT.answer, sources: RESULT.sources }).success).toBe(false);
  });
});
