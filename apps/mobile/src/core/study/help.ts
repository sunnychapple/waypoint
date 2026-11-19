import type { Block } from "../pages/blocks.ts";
import type { HelpDraft } from "./drafts.ts";

export type HelpState = { steps: HelpDraft["steps"]; answer: string; shown: number; answerShown: boolean };

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The page text with the problem kept whole, and the rest of the page cut from both ends to fit `maxChars`.
export function problemContext(pageText: string, block: Block, maxChars = 3000): string {
  const page = collapse(pageText);
  const problem = collapse(block.text);
  if (problem.length >= maxChars) return problem.slice(0, maxChars);
  const start = page.indexOf(problem);
  if (start < 0) return problem;
  if (page.length <= maxChars) return page;
  const end = start + problem.length;
  const room = Math.max(0, maxChars - problem.length - 2);
  const before = Math.floor(room / 2);
  const after = room - before;
  const head = page.slice(Math.max(0, start - before), start).trim();
  const tail = page.slice(end, end + after).trim();
  return [head, problem, tail].filter((part) => part !== "").join(" ");
}

export function startHelp(draft: HelpDraft): HelpState {
  return { steps: draft.steps, answer: draft.answer, shown: 0, answerShown: false };
}

// Shows the next step. Stops at the last one.
export function showNextStep(state: HelpState): HelpState {
  if (state.shown >= state.steps.length) return state;
  return { ...state, shown: state.shown + 1 };
}

// Shows the answer, but only once every step is shown.
export function showAnswer(state: HelpState): HelpState {
  if (state.shown < state.steps.length) return state;
  return { ...state, answerShown: true };
}
