import { cleanCards, cleanQuiz, type CardDraft, type QuizDraft, type SourcedQuizDraft } from "./drafts.ts";

export type ModelPort = {
  contextSize(): number;
  makeCards(text: string, max: number): Promise<unknown>;
  makeQuiz(text: string, count: number): Promise<unknown>;
};
export type Unit = { text: string; captureId: string | null; t: number | null };  // one page, or a stretch of transcript
export type SourcedCard = CardDraft & { captureId: string | null; t: number | null };

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function inputBudget(contextSize: number): number {
  return Math.max(500, contextSize - 1500);
}

function tokensOf(units: Unit[]): number {
  return units.reduce((sum, unit) => sum + estimateTokens(unit.text), 0);
}

function joinText(units: Unit[]): string {
  return units.map((unit) => unit.text).join("\n\n");
}

// Same front: case-insensitive, punctuation ignored.
function sameKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

// Cuts text into pieces of at most `max` characters.
function cutChars(text: string, max: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += max) pieces.push(text.slice(i, i + max));
  return pieces;
}

// Splits one unit at sentence ends, and by characters when a sentence is still too long, into parts that fit the budget.
function splitUnit(unit: Unit, budgetTokens: number): Unit[] {
  const maxChars = budgetTokens * 3;
  const parts: string[] = [];
  let current = "";
  for (const sentence of unit.text.split(/(?<=[.?!]\s|\n)/)) {
    for (const piece of cutChars(sentence, maxChars)) {
      if (current !== "" && current.length + piece.length > maxChars) {
        parts.push(current);
        current = "";
      }
      current += piece;
    }
  }
  if (current !== "") parts.push(current);
  return parts
    .map((text) => text.trim())
    .filter((text) => text !== "")
    .map((text) => ({ text, captureId: unit.captureId, t: unit.t }));
}

// Consecutive units go into one group while the group stays within the budget.
export function packUnits(units: Unit[], budgetTokens: number): Unit[][] {
  const pieces = units.flatMap((unit) => (estimateTokens(unit.text) > budgetTokens ? splitUnit(unit, budgetTokens) : [unit]));
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let used = 0;
  for (const piece of pieces) {
    const cost = estimateTokens(piece.text);
    if (current.length > 0 && used + cost > budgetTokens) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(piece);
    used += cost;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Splits a group in half: by unit when it has several, by sentence when it is one long unit.
export function halve(units: Unit[]): Unit[][] {
  if (units.length > 1) {
    const mid = Math.ceil(units.length / 2);
    return [units.slice(0, mid), units.slice(mid)];
  }
  const [only] = units;
  if (only === undefined) return [];
  const parts = splitUnit(only, Math.max(1, Math.ceil(estimateTokens(only.text) / 2)));
  const mid = Math.ceil(parts.length / 2);
  return [parts.slice(0, mid), parts.slice(mid)].filter((half) => half.length > 0);
}

// One model call for a group. On context_too_long the group is split in half once and both halves are asked.
async function askGroup<T>(units: Unit[], want: number, call: (text: string, n: number) => Promise<T[]>): Promise<T[]> {
  try {
    return await call(joinText(units), want);
  } catch (error) {
    if (!hasCode(error, "context_too_long")) throw error;
    const halves = halve(units);
    const out: T[] = [];
    for (const half of halves) {
      out.push(...(await call(joinText(half), Math.max(1, Math.ceil(want / halves.length)))));
    }
    return out;
  }
}

// Lower case with every run of whitespace as one space, so a front matches page text across its line breaks.
function looseText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// Each group gets its share of the total, by its estimated size. Blank units (a page with no text) are left out.
function plan(port: ModelPort, units: Unit[], total: number): { group: Unit[]; want: number }[] {
  const groups = packUnits(units.filter((unit) => unit.text.trim() !== ""), inputBudget(port.contextSize()));
  const all = groups.reduce((sum, group) => sum + tokensOf(group), 0);
  return groups.map((group) => ({ group, want: Math.max(1, Math.ceil((total * tokensOf(group)) / all)) }));
}

// A group that fails is skipped; unsupported_language stops at once; the first other error is thrown only when no card was made.
export async function makeCardsFromUnits(port: ModelPort, units: Unit[], maxTotal: number): Promise<SourcedCard[]> {
  const call = async (text: string, n: number) => cleanCards(await port.makeCards(text, n), n);
  const out: SourcedCard[] = [];
  const seen = new Set<string>();
  let failed = false;
  let firstError: unknown = null;
  for (const { group, want } of plan(port, units, maxTotal)) {
    if (out.length >= maxTotal) break;
    let cards: CardDraft[];
    try {
      cards = await askGroup(group, want, call);
    } catch (error) {
      if (hasCode(error, "unsupported_language")) throw error;
      if (!failed) firstError = error;
      failed = true;
      continue;
    }
    for (const card of cards) {
      const key = sameKey(card.front);
      if (seen.has(key) || out.length >= maxTotal) continue;
      seen.add(key);
      const front = looseText(card.front);
      const source = group.find((unit) => looseText(unit.text).includes(front)) ?? group[0];
      if (source === undefined) continue;
      out.push({ ...card, captureId: source.captureId, t: source.t });
    }
  }
  if (out.length === 0 && failed) throw firstError;
  return out;
}

// "not" and "no" are kept as real words: a quote that loses one says the opposite of the page.
const STOP_WORDS = new Set("a an the of to in on at by for from with and or but is are was were be been it its this that these those they them their he she his her him as so do does did than then there".split(" "));
const NEGATIONS = new Set(["not", "no", "never", "none"]);
const tokens = (text: string): string[] => {
  const s = text
    .toLowerCase()
    .replace(/\bcan(?:not|['’]t)\b/g, "can not")
    .replace(/n['’]t\b/g, " not")
    // 3.5 and 1,000 stay one word, so "3" does not match inside "3.5".
    .replace(/(\p{N})[.,](?=\p{N})/gu, "$1p")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return s === "" ? [] : s.split(" ");
};
const stem = (word: string): string => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const stems = (text: string): string[] => tokens(text).map(stem);
const contentWords = (text: string): string[] => {
  const kept = tokens(text).filter((w) => !STOP_WORDS.has(w)).map(stem);
  return kept.length > 0 ? kept : stems(text);
};
const phrase = (text: string): string => ` ${stems(text).join(" ")} `;

// A line that can start a new item: a number or letter, a bullet, or "term: meaning".
const LIST_ITEM = /^\s*(?:\(?\d{1,3}(?:\)|\.\s)|\(?[a-z][.)]\s|[-•*]\s|\p{L}[\p{L} '’-]{0,30}:)/iu;
const ABBREVIATION = /(?:^|[\s(])(?:mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e|u\.s|\p{L})\.$/iu;

// A word broken across a line by a hyphen is one word again.
const unwrapped = (pageText: string): string => pageText.replace(/(\p{L})-[ \t]*\n[ \t]*(\p{L})/gu, "$1$2");

// Splits at the end of a sentence, but not after an abbreviation such as "Mr." or "e.g.".
function sentences(block: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const match of block.matchAll(/[.?!]+\s+/g)) {
    const end = match.index + match[0].trimEnd().length;
    if (ABBREVIATION.test(block.slice(start, end))) continue;
    out.push(block.slice(start, end));
    start = match.index + match[0].length;
  }
  out.push(block.slice(start));
  return out;
}

// The page cut into sentences and list items. Other line breaks are only wrapped text and do not end a passage. A line that
// looks like an item starts one only after a finished line, a short heading, or another item, so wrapped text stays together.
function passages(pageText: string): string[] {
  const blocks: string[] = [];
  let current = "";
  let inItem = false;
  let previous = "";
  for (const line of unwrapped(pageText).split("\n")) {
    const looksLikeItem = LIST_ITEM.test(line);
    const afterBreak: boolean = current === "" || inItem || /[.?!:]\s*$/.test(previous) || tokens(previous).length <= 3;
    const startsItem: boolean = looksLikeItem && afterBreak;
    if (line.trim() === "" || startsItem) {
      if (current !== "") blocks.push(current);
      current = "";
      inItem = startsItem;
    }
    if (line.trim() !== "") current = current === "" ? line : `${current} ${line}`;
    previous = line;
  }
  if (current !== "") blocks.push(current);
  return blocks.flatMap(sentences).filter((text) => text.trim() !== "");
}

// The longest run of `want` found in order in `words`: which words of `want` matched, and where they are in `words`.
function inOrder(want: string[], words: string[]): { matched: Set<number>; positions: number[] } {
  const best: number[][] = Array.from({ length: want.length + 1 }, () => new Array<number>(words.length + 1).fill(0));
  for (let i = want.length - 1; i >= 0; i--) {
    for (let j = words.length - 1; j >= 0; j--) {
      const skip = Math.max(best[i + 1]?.[j] ?? 0, best[i]?.[j + 1] ?? 0);
      const row = best[i];
      if (row !== undefined) row[j] = want[i] === words[j] ? Math.max(skip, 1 + (best[i + 1]?.[j + 1] ?? 0)) : skip;
    }
  }
  const matched = new Set<number>();
  const positions: number[] = [];
  let i = 0;
  let j = 0;
  while (i < want.length && j < words.length) {
    const here = best[i]?.[j] ?? 0;
    if (want[i] === words[j] && here === 1 + (best[i + 1]?.[j + 1] ?? 0)) {
      matched.add(i);
      positions.push(j);
      i++;
      j++;
    } else if ((best[i + 1]?.[j] ?? 0) === here) i++;
    else j++;
  }
  return { matched, positions };
}

// The quote holds up against one passage: its words appear there in the same order (at most 15% may differ), it does not drop
// a "not" that stands between them, the answer's words are all in that passage, and most of them are in the matched quote.
function quoteSupports(quiz: SourcedQuizDraft, pageText: string): boolean {
  const quote = contentWords(quiz.evidence);
  const answer = [...new Set(contentWords(quiz.answer))];
  if (quote.length === 0 || answer.length === 0) return false;
  const allowedMisses = Math.floor(quote.length * 0.15);
  const quoteHasNegation = quote.some((word) => NEGATIONS.has(word));
  return passages(pageText).some((passage) => {
    const words = stems(passage);
    const { matched, positions } = inOrder(quote, words);
    if (quote.length - matched.size > allowedMisses) return false;
    const first = positions[0];
    const last = positions[positions.length - 1];
    if (first === undefined || last === undefined) return false;
    if (!quoteHasNegation && words.slice(first, last + 1).some((word) => NEGATIONS.has(word))) return false;
    const inPassage = new Set(words);
    if (!answer.every((word) => inPassage.has(word))) return false;
    const inQuote = new Set(quote.filter((_, index) => matched.has(index)));
    return answer.filter((word) => inQuote.has(word)).length * 5 >= answer.length * 3;
  });
}

// Grounded when the quote holds up against one passage of the page. A negated quote must be asked about as a negative, a number
// in the answer must appear with the answer's words as written on the page, and no wrong choice may be the answer or be in the quote.
function grounded(quiz: SourcedQuizDraft, pageText: string): boolean {
  if (!quoteSupports(quiz, pageText)) return false;
  const quoteWords = stems(quiz.evidence);
  if (quoteWords.some((word) => NEGATIONS.has(word)) && !stems(quiz.question).some((word) => NEGATIONS.has(word))) return false;
  if (tokens(quiz.answer).some((word) => /\p{N}/u.test(word)) && !phrase(unwrapped(pageText)).includes(phrase(quiz.answer))) return false;
  const quotePhrase = phrase(quiz.evidence);
  const answerPhrase = phrase(quiz.answer);
  return quiz.choices.every((choice, index) => {
    if (index === quiz.answerIndex || tokens(choice).length === 0) return true;
    const wrong = phrase(choice);
    return wrong !== answerPhrase && (!quotePhrase.includes(wrong) || answerPhrase.includes(wrong));
  });
}

// Each unit is one piece, cut when it is over the budget. When some piece has six words or more, the shorter ones are dropped.
function quizPieces(units: Unit[], contextSize: number): Unit[] {
  const budget = Math.min(inputBudget(contextSize), 700);
  const pieces = units
    .filter((unit) => unit.text.trim() !== "")
    .flatMap((unit) => (estimateTokens(unit.text) > budget ? splitUnit(unit, budget) : [unit]));
  return pieces.some((piece) => tokens(piece.text).length >= 6) ? pieces.filter((piece) => tokens(piece.text).length >= 6) : pieces;
}

// Pieces at even indexes first, then the odd ones, so a short quiz still covers the whole set.
function evenThenOdd<T>(list: T[]): T[] {
  return [...list.filter((_, index) => index % 2 === 0), ...list.filter((_, index) => index % 2 === 1)];
}

// A piece that fails is skipped; unsupported_language stops at once; the first other error is thrown only when no question was made.
export async function makeQuizFromUnits(port: ModelPort, units: Unit[], count: number): Promise<QuizDraft[]> {
  const call = async (text: string, n: number) => cleanQuiz(await port.makeQuiz(text, n), n);
  const out: QuizDraft[] = [];
  const seen = new Set<string>();
  let tried = 0;
  let failed = false;
  let firstError: unknown = null;
  for (const piece of evenThenOdd(quizPieces(units, port.contextSize()))) {
    if (out.length >= count || tried >= count + 3) break;
    tried++;
    let drafts: SourcedQuizDraft[];
    try {
      drafts = await askGroup([piece], 2, call);
    } catch (error) {
      if (hasCode(error, "unsupported_language")) throw error;
      if (!failed) firstError = error;
      failed = true;
      continue;
    }
    for (const quiz of drafts) {
      if (out.length >= count) break;
      if (!grounded(quiz, piece.text)) continue;
      const key = sameKey(quiz.question);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ question: quiz.question, choices: quiz.choices, answerIndex: quiz.answerIndex, why: quiz.why });
    }
  }
  if (out.length === 0 && failed) throw firstError;
  return out;
}
