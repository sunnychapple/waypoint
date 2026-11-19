import type { NewCard } from "./cards.ts";
import type { QuizDraft } from "./drafts.ts";

export type QuizState = { questions: QuizDraft[]; index: number; picked: number | null; right: number; missed: QuizDraft[] };

export function startQuiz(questions: QuizDraft[]): QuizState {
  return { questions, index: 0, picked: null, right: 0, missed: [] };
}

// Records the answer to the current question. Ignored when it is already answered or the choice is not A to D.
export function pick(state: QuizState, choice: number): QuizState {
  const question = state.questions[state.index];
  if (question === undefined || state.picked !== null) return state;
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) return state;
  if (choice === question.answerIndex) return { ...state, picked: choice, right: state.right + 1 };
  return { ...state, picked: choice, missed: [...state.missed, question] };
}

// Moves on, but only after an answer has been picked.
export function next(state: QuizState): QuizState {
  if (state.picked === null) return state;
  return { ...state, index: state.index + 1, picked: null };
}

export function isDone(state: QuizState): boolean {
  return state.index >= state.questions.length;
}

// A missed question becomes a flashcard: the question on the front, the right choice and why on the back.
export function missedToCards(missed: QuizDraft[]): NewCard[] {
  return missed.map((question): NewCard => ({
    kind: "question",
    front: question.question,
    back: `${question.choices[question.answerIndex]}. ${question.why}`,
    captureId: null,
    t: null,
  }));
}

// Eight questions for a recording, five for pages.
export function quizCount(kind: "recording" | "pages"): number {
  return kind === "recording" ? 8 : 5;
}
