import type { SqlDb } from "../db/sql.ts";
import { groupBlocks, parseLines, type Block } from "../pages/blocks.ts";
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

// Step 1 shows straight away; "Next step" shows the rest one at a time.
export function startHelp(draft: HelpDraft): HelpState {
  return { steps: draft.steps, answer: draft.answer, shown: Math.min(1, draft.steps.length), answerShown: false };
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

export type PageWithLines = { id: string; file: string; found_text: string | null; found_lines: string | null };

// A session's pages in page order, with the text and lines found on each.
export function pagesWithLines(db: SqlDb, sessionId: string): PageWithLines[] {
  return db.all<PageWithLines>(
    "SELECT id, file, found_text, found_lines FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id",
    [sessionId],
  );
}

export type Problem = { text: string; context: string };

// The problem at `index` among the page's blocks, with the rest of its page for the model. Null when the page,
// its text or that block is missing.
export function problemOf(db: SqlDb, captureId: string, index: number): Problem | null {
  const page = db.get<{ found_text: string | null; found_lines: string | null }>(
    "SELECT found_text, found_lines FROM captures WHERE id = ? AND kind = 'page'",
    [captureId],
  );
  if (page === null || page.found_text === null) return null;
  const block = groupBlocks(parseLines(page.found_lines))[index];
  if (block === undefined) return null;
  return { text: block.text, context: problemContext(page.found_text, block) };
}
