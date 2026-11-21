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
function halve(units: Unit[]): Unit[][] {
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

const STOP_WORDS = new Set("a an the of to in on at by for from with and or but is are was were be been it its this that these those they them their he she his her him as so do does did not no than then there".split(" "));
const tokens = (text: string): string[] => { const s = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); return s === "" ? [] : s.split(" "); };
const stem = (word: string): string => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const contentWords = (text: string): string[] => { const kept = tokens(text).filter((w) => !STOP_WORDS.has(w)).map(stem); return kept.length > 0 ? kept : tokens(text).map(stem); };
const phrase = (text: string): string => ` ${tokens(text).join(" ")} `;

// True when some window of the page holds at least 80% of the evidence's unique content words. The window is about 1.5 times the evidence length, so a reworded quote still matches.
function quoteOnPage(evidence: string, pageText: string): boolean {
  const want = [...new Set(contentWords(evidence))];
  if (want.length === 0) return false;
  const page = tokens(pageText).map(stem);
  const size = Math.ceil(tokens(evidence).length * 1.5) + 2;
  const last = Math.max(0, page.length - size);
  for (let start = 0; start <= last; start++) {
    const window = new Set(page.slice(start, start + size));
    const hits = want.filter((word) => window.has(word)).length;
    if (hits * 5 >= want.length * 4) return true;
  }
  return false;
}

// Grounded when the evidence is close to a passage of the page, every answer word is on the page, numbers in the answer are in the evidence,
// at least 60% of the answer's words are in the evidence, and no wrong choice is quoted in the evidence unless the answer quotes it too.
function grounded(quiz: SourcedQuizDraft, pageText: string): boolean {
  const answerWords = [...new Set(contentWords(quiz.answer))];
  const evidenceWords = contentWords(quiz.evidence);
  if (answerWords.length === 0 || evidenceWords.length === 0) return false;
  if (!quoteOnPage(quiz.evidence, pageText)) return false;
  const page = new Set(tokens(pageText).map(stem));
  if (!answerWords.every((word) => page.has(word))) return false;
  const evidenceSet = new Set(evidenceWords);
  if (tokens(quiz.answer).some((word) => /\p{N}/u.test(word) && !evidenceSet.has(stem(word)))) return false;
  const inEvidence = new Set(tokens(quiz.evidence).map(stem));
  if (answerWords.filter((word) => inEvidence.has(word)).length * 5 < answerWords.length * 3) return false;
  const evidencePhrase = phrase(quiz.evidence);
  const answerPhrase = phrase(quiz.answer);
  return quiz.choices.every((choice, index) => {
    if (index === quiz.answerIndex || tokens(choice).length === 0) return true;
    const wrong = phrase(choice);
    return !evidencePhrase.includes(wrong) || answerPhrase.includes(wrong);
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
