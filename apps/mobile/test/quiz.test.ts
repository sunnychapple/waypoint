import { describe, expect, it } from "vitest";
import type { QuizDraft } from "../src/core/study/drafts.ts";
import { isDone, missedToCards, next, pick, quizCount, startQuiz } from "../src/core/study/quiz.ts";

const question = (text: string, answerIndex: 0 | 1 | 2 | 3 = 1): QuizDraft => ({
  question: text,
  choices: ["one", "two", "three", "four"],
  answerIndex,
  why: `Because ${text}.`,
});

describe("quiz", () => {
  it("a pick scores a right answer, and next moves to the following question", () => {
    const state = pick(startQuiz([question("Q1"), question("Q2")]), 1);
    expect(state).toMatchObject({ index: 0, picked: 1, right: 1, missed: [] });
    expect(next(state)).toMatchObject({ index: 1, picked: null, right: 1 });
  });

  it("a second pick on the same question is ignored", () => {
    const state = pick(startQuiz([question("Q1")]), 0);
    expect(pick(state, 1)).toBe(state);
  });

  it("a choice outside A to D is ignored", () => {
    const state = startQuiz([question("Q1")]);
    expect(pick(state, -1)).toBe(state);
    expect(pick(state, 4)).toBe(state);
  });

  it("next does nothing before an answer is picked", () => {
    const state = startQuiz([question("Q1")]);
    expect(next(state)).toBe(state);
  });

  it("a wrong pick is counted as missed and the question is kept", () => {
    const q = question("Q1");
    const state = pick(startQuiz([q]), 3);
    expect(state).toMatchObject({ right: 0, missed: [q] });
  });

  it("is done after the last question", () => {
    const state = next(pick(startQuiz([question("Q1")]), 1));
    expect(isDone(state)).toBe(true);
    expect(isDone(startQuiz([question("Q1")]))).toBe(false);
  });

  it("a missed question becomes a question card with the right choice and why on the back", () => {
    expect(missedToCards([question("Why?", 2)])).toEqual([
      { kind: "question", front: "Why?", back: "three. Because Why?.", captureId: null, t: null },
    ]);
  });

  it("makes eight questions from a recording and five from pages", () => {
    expect(quizCount("recording")).toBe(8);
    expect(quizCount("pages")).toBe(5);
  });
});
