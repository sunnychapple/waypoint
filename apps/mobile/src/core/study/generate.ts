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

export async function makeCardsFromUnits(port: ModelPort, units: Unit[], maxTotal: number): Promise<SourcedCard[]> {
  const call = async (text: string, n: number) => cleanCards(await port.makeCards(text, n), n);
  const out: SourcedCard[] = [];
  const seen = new Set<string>();
  for (const { group, want } of plan(port, units, maxTotal)) {
    if (out.length >= maxTotal) break;
    for (const card of await askGroup(group, want, call)) {
      const key = sameKey(card.front);
      if (seen.has(key) || out.length >= maxTotal) continue;
      seen.add(key);
      const front = looseText(card.front);
      const source = group.find((unit) => looseText(unit.text).includes(front)) ?? group[0];
      if (source === undefined) continue;
      out.push({ ...card, captureId: source.captureId, t: source.t });
    }
  }
  return out;
}

// Grounded when the answer is in the group text, or the evidence is in it and the answer is in the evidence.
function grounded(quiz: SourcedQuizDraft, groupText: string): boolean {
  const text = looseText(groupText);
  const answer = looseText(quiz.answer);
  if (text.includes(answer)) return true;
  const evidence = looseText(quiz.evidence);
  return text.includes(evidence) && evidence.includes(answer);
}

export async function makeQuizFromUnits(port: ModelPort, units: Unit[], count: number): Promise<QuizDraft[]> {
  const call = async (text: string, n: number) => cleanQuiz(await port.makeQuiz(text, n), n);
  const out: QuizDraft[] = [];
  for (const { group, want } of plan(port, units, count)) {
    if (out.length >= count) break;
    const groupText = joinText(group);
    for (const quiz of await askGroup(group, want, call)) {
      if (out.length >= count) break;
      if (!grounded(quiz, groupText)) continue;
      out.push({ question: quiz.question, choices: quiz.choices, answerIndex: quiz.answerIndex, why: quiz.why });
    }
  }
  return out;
}
