import { z } from "zod";

export type CardDraft = { kind: "term" | "problem"; front: string; back: string };
export type QuizDraft = { question: string; choices: [string, string, string, string]; answerIndex: 0 | 1 | 2 | 3; why: string };
// A quiz draft plus the text the model quoted as evidence and the answer as written, for the grounding check.
export type SourcedQuizDraft = QuizDraft & { answer: string; evidence: string };
export type HelpDraft = { steps: { title: string; detail: string }[]; answer: string };

const cardSchema = z.object({ kind: z.enum(["term", "problem"]), front: z.string(), back: z.string() });
const quizSchema = z.object({
  question: z.string(),
  evidence: z.string(),
  answer: z.string(),
  wrongChoices: z.array(z.string()),
  why: z.string(),
});
const helpSchema = z.object({ steps: z.array(z.unknown()), answer: z.string() });
const stepSchema = z.object({ title: z.string(), detail: z.string() });
// The permissive mode returns plain text, which the app receives as { plainText } instead of JSON.
const plainCardsSchema = z.tuple([z.object({ plainText: z.string() })]);
const plainHelpSchema = z.object({ plainText: z.string() });

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

type PlainLine = { clean: string; bare: string; bold: boolean };

// Only a matched pair of bold markers comes off, so a power such as 2**3 or (a+b)**2 survives. `bare` also drops a leading list marker.
function plainLines(text: string): PlainLine[] {
  const unbold = (line: string) =>
    line.replace(/(?<![\p{L}\p{N})\]*])\*\*(?=\S)(.+?)(?:(?<=:)\*\*|(?<=\S)\*\*(?![\p{L}\p{N}(*-]))/gu, "$1").trim();
  return text.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    const unlisted = line.replace(/^(?:\d+[.)]|[-*•])\s+/, "");
    return { clean: unbold(line), bare: unbold(unlisted), bold: /^\*\*(?:(?!\*\*).)+\*\*$/.test(unlisted) };
  });
}

const isBreak = (line: PlainLine): boolean => line.clean === "" || /^(?:-+|\*{3,}|_{3,})$/.test(line.clean);
const joined = (parts: string[]): string => parts.filter((part) => part !== "").join(" ");

// FRONT: and BACK: cards. A FRONT with no BACK before the next FRONT is dropped. Later lines continue a field until a break.
function labeledCards(lines: PlainLine[]): CardDraft[] {
  const out: CardDraft[] = [];
  let card: { front: string[]; back: string[] | null } | null = null;
  let open: string[] | null = null;
  const done = (c: typeof card): void => {
    if (c?.back) out.push({ kind: "term", front: joined(c.front), back: joined(c.back) });
  };
  for (const line of lines) {
    const label = /^(FRONT|BACK)\s*:\s*(.*)$/i.exec(line.bare);
    const word = label?.[1]?.toUpperCase();
    const value = label?.[2] ?? "";
    if (word === "FRONT") {
      done(card);
      card = { front: [value], back: null };
      open = card.front;
    } else if (word === "BACK") {
      open = null;
      if (card !== null && card.back === null) {
        card.back = [value];
        open = card.back;
      }
    } else if (isBreak(line)) {
      open = null;
    } else {
      open?.push(line.clean);
    }
  }
  done(card);
  return out;
}

// Blocks split by blank lines or lines of only `-`. A block whose first line is wholly bold is a card, with the rest as the back.
function blockCards(lines: PlainLine[]): CardDraft[] {
  const blocks: PlainLine[][] = [];
  let block: PlainLine[] = [];
  for (const line of lines) {
    if (isBreak(line)) {
      if (block.length > 0) blocks.push(block);
      block = [];
    } else {
      block.push(line);
    }
  }
  if (block.length > 0) blocks.push(block);
  const out: CardDraft[] = [];
  for (const b of blocks) {
    const [first, ...rest] = b;
    if (first === undefined || rest.length === 0 || !first.bold) continue;
    out.push({ kind: "term", front: first.bare, back: joined(rest.map((l) => l.clean)) });
  }
  return out;
}

// Reads flashcards from a plain-text reply. Labeled cards win; the bold block form is used only when there are none.
export function parseCardLines(text: string): CardDraft[] {
  const lines = plainLines(text);
  const labeled = labeledCards(lines);
  return labeled.length > 0 ? labeled : blockCards(lines);
}

// Reads STEP / DO / ANSWER lines from a plain-text reply. Returns null when there are no steps or no answer. The last ANSWER wins.
// A step with no DO keeps its title as the detail, so no step of the method goes missing.
export function parseHelpLines(text: string): { steps: { title: string; detail: string }[]; answer: string } | null {
  const steps: { title: string; detail: string[] }[] = [];
  let answer: string[] = [];
  let open: string[] | null = null;
  for (const line of plainLines(text)) {
    const label = /^(STEP|DO|ANSWER)(?:\s*\d+)?\s*:\s*(.*)$/i.exec(line.bare);
    const word = label?.[1]?.toUpperCase();
    const value = label?.[2] ?? "";
    if (word === "STEP") {
      steps.push({ title: value, detail: [] });
      open = null;
    } else if (word === "DO") {
      const step = steps[steps.length - 1];
      open = null;
      if (step !== undefined && step.detail.length === 0) {
        step.detail.push(value);
        open = step.detail;
      }
    } else if (word === "ANSWER") {
      // An empty ANSWER: never wipes a real answer. It continues on the next line only when there is no answer yet.
      const waiting = value === "" && joined(answer) === "";
      if (value !== "" || waiting) answer = [value];
      open = waiting ? answer : null;
    } else if (isBreak(line)) {
      open = null;
    } else {
      open?.push(line.clean);
    }
  }
  const final = joined(answer);
  if (steps.length === 0 || final === "") return null;
  return { steps: steps.map((s) => ({ title: s.title, detail: joined(s.detail) || s.title })), answer: final };
}

export function cleanCards(raw: unknown, max: number): CardDraft[] {
  const plain = plainCardsSchema.safeParse(raw);
  const list: unknown[] = plain.success ? parseCardLines(plain.data[0].plainText) : Array.isArray(raw) ? raw : [];
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

// The code, not the model, sets the answer position: `random` picks it (0 to 3), and the wrong choices fill the other slots in order.
export function cleanQuiz(raw: unknown, count: number, random: () => number = Math.random): SourcedQuizDraft[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const out: SourcedQuizDraft[] = [];
  for (const item of list) {
    if (out.length >= count) break;
    const parsed = quizSchema.safeParse(item);
    if (!parsed.success) continue;
    const question = collapse(parsed.data.question);
    const answer = collapse(parsed.data.answer);
    if (question === "" || answer === "") continue;
    const seen = new Set<string>([sameKey(answer)]);
    const wrong: string[] = [];
    for (const text of parsed.data.wrongChoices) {
      const choice = collapse(text);
      const key = sameKey(choice);
      if (choice === "" || seen.has(key)) continue;
      seen.add(key);
      wrong.push(choice);
      if (wrong.length === 3) break;
    }
    if (wrong.length < 3) continue;
    const answerIndex = toIndex(Math.min(3, Math.max(0, Math.floor(random() * 4)))) ?? 0;
    const choices = fourChoices([...wrong.slice(0, answerIndex), answer, ...wrong.slice(answerIndex)]);
    if (choices === null) continue;
    out.push({
      question,
      choices,
      answerIndex,
      why: collapse(parsed.data.why),
      answer,
      evidence: collapse(parsed.data.evidence),
    });
  }
  return out;
}

export function cleanHelp(raw: unknown): HelpDraft | null {
  const plain = plainHelpSchema.safeParse(raw);
  const parsed = helpSchema.safeParse(plain.success ? parseHelpLines(plain.data.plainText) : raw);
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
