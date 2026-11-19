import { z } from "zod";

export type CardDraft = { kind: "term" | "problem"; front: string; back: string };
export type QuizDraft = { question: string; choices: [string, string, string, string]; answerIndex: 0 | 1 | 2 | 3; why: string };
export type HelpDraft = { steps: { title: string; detail: string }[]; answer: string };

const cardSchema = z.object({ kind: z.enum(["term", "problem"]), front: z.string(), back: z.string() });
const quizSchema = z.object({ question: z.string(), choices: z.array(z.string()), answerIndex: z.number(), why: z.string() });
const helpSchema = z.object({ steps: z.array(z.unknown()), answer: z.string() });
const stepSchema = z.object({ title: z.string(), detail: z.string() });

// Trims and collapses whitespace to single spaces.
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Cuts to at most `max` characters, the "…" included, at a word boundary when there is one.
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head) + "…";
}

// Same front: case-insensitive, punctuation ignored.
function sameKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function toIndex(n: number): 0 | 1 | 2 | 3 | null {
  if (n === 0 || n === 1 || n === 2 || n === 3) return n;
  return null;
}

function fourChoices(list: string[]): [string, string, string, string] | null {
  const [a, b, c, d] = list;
  if (list.length !== 4 || a === undefined || b === undefined || c === undefined || d === undefined) return null;
  if (list.some((choice) => choice === "") || new Set(list).size !== 4) return null;
  return [a, b, c, d];
}

export function cleanCards(raw: unknown, max: number): CardDraft[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const out: CardDraft[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (out.length >= max) break;
    const parsed = cardSchema.safeParse(item);
    if (!parsed.success) continue;
    const front = fit(collapse(parsed.data.front), 200);
    const back = fit(collapse(parsed.data.back), 1000);
    if (front === "" || back === "") continue;
    const key = sameKey(front);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: parsed.data.kind, front, back });
  }
  return out;
}

export function cleanQuiz(raw: unknown, count: number): QuizDraft[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const out: QuizDraft[] = [];
  for (const item of list) {
    if (out.length >= count) break;
    const parsed = quizSchema.safeParse(item);
    if (!parsed.success) continue;
    const question = collapse(parsed.data.question);
    const answerIndex = toIndex(parsed.data.answerIndex);
    const choices = fourChoices(parsed.data.choices.map(collapse));
    if (question === "" || answerIndex === null || choices === null) continue;
    out.push({ question, choices, answerIndex, why: collapse(parsed.data.why) });
  }
  return out;
}

export function cleanHelp(raw: unknown): HelpDraft | null {
  const parsed = helpSchema.safeParse(raw);
  if (!parsed.success) return null;
  const steps: { title: string; detail: string }[] = [];
  for (const item of parsed.data.steps) {
    const step = stepSchema.safeParse(item);
    if (!step.success) continue;
    const title = collapse(step.data.title);
    const detail = collapse(step.data.detail);
    if (title === "" || detail === "") continue;
    steps.push({ title, detail });
  }
  const answer = collapse(parsed.data.answer);
  if (steps.length === 0 || answer === "") return null;
  return { steps: steps.slice(0, 8), answer };
}
