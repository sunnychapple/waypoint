import { describe, expect, it } from "vitest";
import type { HelpDraft } from "../src/core/study/drafts.ts";
import { problemContext, showAnswer, showNextStep, startHelp } from "../src/core/study/help.ts";
import type { Block } from "../src/core/pages/blocks.ts";

const block = (text: string): Block => ({ text, x: 0, y: 0, width: 1, height: 0.1, lines: 1 });
const draft: HelpDraft = {
  steps: [
    { title: "Set up", detail: "Write the equation." },
    { title: "Solve", detail: "Divide both sides by 3." },
  ],
  answer: "x = 2",
};

describe("problemContext", () => {
  it("keeps a short page as it is, with whitespace collapsed", () => {
    const page = "Worksheet\n\n1. Solve 3x = 6.\n2. Sketch a graph.";
    expect(problemContext(page, block("1. Solve 3x = 6."))).toBe("Worksheet 1. Solve 3x = 6. 2. Sketch a graph.");
  });

  it("keeps the problem whole and fits a long page to the limit", () => {
    const page = `${"Intro words. ".repeat(40)}1. Solve 3x = 6. ${"Closing words. ".repeat(40)}`;
    const out = problemContext(page, block("1. Solve 3x = 6."), 120);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain("1. Solve 3x = 6.");
  });

  it("returns the problem alone when it is not on the page", () => {
    expect(problemContext("Worksheet", block("1. Solve 3x = 6."))).toBe("1. Solve 3x = 6.");
  });
});

describe("help steps", () => {
  it("starts with no step and no answer shown", () => {
    expect(startHelp(draft)).toEqual({ steps: draft.steps, answer: "x = 2", shown: 0, answerShown: false });
  });

  it("the answer cannot be shown before every step", () => {
    const state = showNextStep(startHelp(draft));
    expect(showAnswer(state)).toBe(state);
  });

  it("next step stops at the last step", () => {
    const state = showNextStep(showNextStep(showNextStep(startHelp(draft))));
    expect(state.shown).toBe(2);
    expect(showAnswer(state).answerShown).toBe(true);
  });
});
