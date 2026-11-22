import { z } from "zod";
import { cleanHelp, type HelpDraft } from "./drafts.ts";

// Math for a student's problem, worked out by code. A value is an exact fraction of safe integers, so no result
// comes from floating point. The model may only turn a word problem into an expression (see helpFor).

export type MathPlan = { expression: string; unit: string };
export type HelpAnswer = { draft: HelpDraft; answerChecked: boolean };
export type MathPort = {
  planMath(problem: string): Promise<unknown>;
  helpWithProblem(problem: string, context: string): Promise<unknown>;
};

type Step = HelpDraft["steps"][number];
type Frac = { n: number; d: number };
// Always three coefficients: index is the power of the one variable, so the degree is at most 2.
type Poly = Frac[];
type Node =
  | { t: "num"; v: Frac }
  | { t: "var"; name: string }
  | { t: "neg"; x: Node }
  | { t: "paren"; x: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; l: Node; r: Node }
  | { t: "pow"; b: Node; e: Node }
  | { t: "sqrt"; x: Node }
  | { t: "pct"; x: Node };
type Tok =
  | { k: "num"; v: Frac; dec: boolean }
  | { k: "var"; name: string }
  | { k: "op"; op: "+" | "-" | "*" | "/" | "^" | "%" }
  | { k: "open" }
  | { k: "close" }
  | { k: "root" };

// Any failure to solve: a bad token, overflow, division by zero, an inexact root, a degree above 2.
class MathError extends Error {}
function fail(): never {
  throw new MathError("not solvable");
}

const ZERO: Frac = { n: 0, d: 1 };
const ONE: Frac = { n: 1, d: 1 };
const MAX_STEPS = 6;
const SYM = { "+": "+", "-": "−", "*": "×", "/": "÷" } as const;
const BIN_TITLE = { "+": "Add", "-": "Subtract", "*": "Multiply", "/": "Divide" } as const;
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  half: 2,
  third: 3,
  fourth: 4,
  quarter: 4,
  fifth: 5,
  double: 2,
  doubled: 2,
  twice: 2,
  triple: 3,
  dozen: 12,
};
const NUMBER_WORD_LIST = Object.keys(NUMBER_WORDS).join("|");
const LIST_MARKER = /^(?:\([a-z]\)\s+|(?:[a-z]|\d{1,2})[.)]\s+|problem\s*\d+\s*[:.]\s*|#\s*\d+\s*)/i;
const INSTRUCTION =
  /^(?:solve\s+for\s+([a-z])\b|find\s+the\s+value\s+of\s+([a-z])\b|find\s+([a-z])\b|solve\b|evaluate\b|simplify\b|calculate\b|compute\b|find\b|what\s+is\b|what's\b)\s*:?\s*/i;
const PERCENT_OF = /(\d+(?:\.\d+)?)\s*%\s+of\s+(\d+(?:\.\d+)?|\([^()]*\))/gi;
const BIBLE_BOOKS =
  "genesis|gen|exodus|exod|ex|leviticus|lev|numbers|num|deuteronomy|deut|joshua|josh|judges|judg|ruth|samuel|sam|kings|kgs|ki|chronicles|chron|chr|ezra|nehemiah|neh|esther|esth|job|psalms?|pss?|psa|proverbs?|prov|ecclesiastes|eccl|song of solomon|song of songs|isaiah|isa|jeremiah|jer|lamentations|lam|ezekiel|ezek|daniel|dan|hosea|hos|joel|amos|obadiah|obad|jonah|jon|micah|mic|nahum|nah|habakkuk|hab|zephaniah|zeph|haggai|hag|zechariah|zech|malachi|mal|matthew|matt|mat|mt|mark|mk|luke|lk|john|jn|acts|romans|rom|corinthians|cor|galatians|gal|ephesians|eph|philippians|phil|colossians|col|thessalonians|thess|timothy|tim|titus|tit|philemon|philem|hebrews|heb|james|jas|peter|pet|jude|revelation|rev";
// Book names that are not also people's names, so "Psalm 23" alone is a reference while "Mark 5" or "Sam 3" needs more to go on.
const PLAIN_BOOKS =
  "genesis|exodus|leviticus|deuteronomy|judges|psalms?|proverbs|ecclesiastes|isaiah|jeremiah|lamentations|ezekiel|hosea|obadiah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|hebrews|revelation";
const CHAPTER_END = "(?=\\s*(?:$|[.,;:)?!]))";
// A reference has a verse, a numbered book, a plain book name, a word that points to it ("read Mark 5"), or a verb ("John 3 says").
const SCRIPTURE = new RegExp(
  [
    `(?:\\b[123]\\s*)?\\b(?:${BIBLE_BOOKS})\\.?\\s+\\d+:\\d+(?:[-–]\\d+)?`,
    `\\b[123]\\s+(?:${BIBLE_BOOKS})\\.?\\s+\\d+${CHAPTER_END}`,
    `\\b(?:${PLAIN_BOOKS})\\s+\\d+(?=\\s*(?:$|[.,;:)?!]|(?:says?|tells?|teaches)\\b))`,
    `\\b(?:read|in|see|turn to|from)\\s+(?:${BIBLE_BOOKS})\\.?\\s+\\d+${CHAPTER_END}`,
    `\\b(?:${BIBLE_BOOKS})\\.?\\s+\\d+\\s+(?:says?|tells?|teaches)\\b`,
  ].join("|"),
  "gi",
);
// Numbers that label a place in a text and are not part of a problem.
const TEXT_PLACE = /\b(?:verses?|chapters?|lesson|question|page|vv?|ch|pp?)\.?\s*\d+(?:[-–:]\d+)*/gi;
const MATH_CUE =
  /\b(how many|how much|how far|how long|how old|how tall|how fast|total|sum|difference|product|quotient|average|mean|percent|area|perimeter|what is the number|sale price|cost|left|times)\b|%/i;

function safe(x: number): number {
  if (!Number.isSafeInteger(x)) fail();
  return x;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
}

function frac(n: number, d = 1): Frac {
  if (d === 0) fail();
  safe(n);
  safe(d);
  const sign = d < 0 ? -1 : 1;
  const g = gcd(n, d);
  const top = (sign * n) / g;
  return { n: top === 0 ? 0 : top, d: (sign * d) / g };
}

function add(a: Frac, b: Frac): Frac {
  const g = gcd(a.d, b.d);
  return frac(safe(safe(a.n * (b.d / g)) + safe(b.n * (a.d / g))), safe(a.d * (b.d / g)));
}

function mul(a: Frac, b: Frac): Frac {
  const g1 = gcd(a.n, b.d);
  const g2 = gcd(b.n, a.d);
  return frac(safe((a.n / g1) * (b.n / g2)), safe((a.d / g2) * (b.d / g1)));
}

const neg = (a: Frac): Frac => frac(-a.n, a.d);
const sub = (a: Frac, b: Frac): Frac => add(a, neg(b));

function div(a: Frac, b: Frac): Frac {
  if (b.n === 0) fail();
  return mul(a, frac(b.d, b.n));
}

function pow(a: Frac, k: number): Frac {
  if (a.n === 0 && k === 0) fail();
  let result = ONE;
  for (let i = 0; i < k; i++) result = mul(result, a);
  return result;
}

function exactRoot(x: number): number {
  const r = Math.round(Math.sqrt(x));
  if (r * r !== x) fail();
  return r;
}

function sqrtFrac(a: Frac): Frac {
  if (a.n < 0) fail();
  return frac(exactRoot(a.n), exactRoot(a.d));
}

const eq = (a: Frac, b: Frac): boolean => a.n === b.n && a.d === b.d;
const isZero = (a: Frac): boolean => a.n === 0;
const isExp = (a: Frac): boolean => a.d === 1 && a.n >= 0 && a.n <= 12;

// "0.25" is 1/4. Each digit after the point is a factor of ten in the denominator.
function decimalFrac(text: string): Frac {
  const [whole = "", part = ""] = text.split(".");
  let scale = 1;
  for (let i = 0; i < part.length; i++) scale = safe(scale * 10);
  return frac(Number(whole + part), scale);
}

// The exact decimal when the fraction has one (denominator 2^a * 5^b), else null.
function decimalText(a: Frac): string | null {
  if (a.d === 1) return String(a.n);
  let d = a.d;
  let twos = 0;
  let fives = 0;
  while (d % 2 === 0) {
    d /= 2;
    twos++;
  }
  while (d % 5 === 0) {
    d /= 5;
    fives++;
  }
  if (d !== 1) return null;
  const k = Math.max(twos, fives);
  // 10^k / (2^twos * 5^fives), which is 2^(k - twos) * 5^(k - fives) because one of those exponents is 0.
  let mult = 1;
  for (let i = twos; i < k; i++) mult = safe(mult * 2);
  for (let i = fives; i < k; i++) mult = safe(mult * 5);
  const digits = String(Math.abs(safe(a.n * mult))).padStart(k + 1, "0");
  const cut = digits.length - k;
  return `${a.n < 0 ? "-" : ""}${digits.slice(0, cut)}.${digits.slice(cut)}`;
}

// The answer as a student reads it: a whole number, an exact decimal when the input had decimals, or a fraction.
function answerText(a: Frac, decimal: boolean): string {
  if (a.d === 1) return String(a.n);
  const dec = decimal ? decimalText(a) : null;
  if (dec !== null) return dec;
  const top = Math.abs(a.n);
  if (top > a.d) {
    const whole = (top - (top % a.d)) / a.d;
    const rest = top % a.d;
    return `${a.n}/${a.d} (or ${a.n < 0 ? "-" : ""}${whole} ${rest}/${a.d})`;
  }
  return `${a.n}/${a.d}`;
}

// Plain ASCII text, for equations and answers.
const plain = (a: Frac): string => (a.d === 1 ? String(a.n) : `${a.n}/${a.d}`);
// Step text uses the minus sign.
const shown = (a: Frac): string => plain(a).replace("-", "−");
const operand = (a: Frac): string => (a.n < 0 ? `(${shown(a)})` : shown(a));
const bracket = (a: Frac): string => (a.d !== 1 || a.n < 0 ? `(${shown(a)})` : shown(a));

// ---- Expressions: tokens, then a tree ----

// Writes the symbols students type or paste in the forms the grammar reads.
function normalize(text: string): string {
  return text
    .replace(/\*\*/g, "^")
    .replace(/[×·∗]/g, "*")
    .replace(/[÷⁄]/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/½/g, " 1/2")
    .replace(/¼/g, " 1/4")
    .replace(/¾/g, " 3/4")
    .replace(/⅓/g, " 1/3")
    .replace(/⅔/g, " 2/3")
    .replace(/sqrt/gi, "√")
    .replace(/(?<!\d)\d{1,3}(?:,\d{3})+(?!\d)/g, (m) => m.replace(/,/g, ""));
}

function tokenize(text: string): { toks: Tok[]; decimal: boolean } {
  const toks: Tok[] = [];
  let decimal = false;
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text.charAt(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(?:\d*\.\d+|\d+)/.exec(rest);
    if (num !== null) {
      const s = num[0];
      i += s.length;
      if (s.includes(".")) {
        decimal = true;
        toks.push({ k: "num", v: decimalFrac(s), dec: true });
        continue;
      }
      // A whole number, a space, then a fraction is a mixed number: 5 1/2 is 11/2.
      const mixed = /^\s+(\d+)\/(\d+)/.exec(text.slice(i));
      if (mixed !== null) {
        const bottom = Number(mixed[2]);
        const top = Number(mixed[1]);
        i += mixed[0].length;
        toks.push({ k: "num", v: frac(safe(Number(s) * bottom + top), bottom), dec: false });
        continue;
      }
      toks.push({ k: "num", v: frac(Number(s)), dec: false });
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      toks.push({ k: "var", name: ch });
    } else if ("+-*/^%".includes(ch)) {
      toks.push({ k: "op", op: ch as "+" | "-" | "*" | "/" | "^" | "%" });
    } else if (ch === "(") {
      toks.push({ k: "open" });
    } else if (ch === ")") {
      toks.push({ k: "close" });
    } else if (ch === "√") {
      toks.push({ k: "root" });
    } else {
      fail();
    }
    i++;
  }
  return { toks, decimal };
}

// Grammar, lowest precedence first: + -, then * / and implicit multiplication, then unary minus,
// then right-associative ^ with a whole exponent, then % after a number, then numbers, letters, parens and √.
function parseText(text: string): { node: Node; decimal: boolean } {
  // A fraction right after ÷ is one number: 1/2 ÷ 1/4 divides by a quarter.
  const grouped = text.replace(/÷\s*((?:\d+\s+)?\d+\/\d+)(?![\d^])/g, "÷ ($1)");
  const { toks, decimal } = tokenize(normalize(grouped));
  let pos = 0;
  const at = (): Tok | undefined => toks[pos];
  const isOp = (op: string): boolean => {
    const t = at();
    return t?.k === "op" && t.op === op;
  };
  const startsPrimary = (t: Tok): boolean => t.k === "num" || t.k === "var" || t.k === "open" || t.k === "root";

  function expr(): Node {
    let left = term();
    for (;;) {
      const t = at();
      if (t?.k !== "op" || (t.op !== "+" && t.op !== "-")) return left;
      pos++;
      left = { t: "bin", op: t.op, l: left, r: term() };
    }
  }

  function term(): Node {
    let left = unary();
    for (;;) {
      const t = at();
      if (t?.k === "op" && (t.op === "*" || t.op === "/")) {
        pos++;
        left = { t: "bin", op: t.op, l: left, r: unary() };
      } else if (t !== undefined && startsPrimary(t)) {
        // Two plain numbers side by side are not a product: "2 3" is refused.
        if (t.k === "num" && toks[pos - 1]?.k === "num") fail();
        left = { t: "bin", op: "*", l: left, r: unary() };
      } else {
        return left;
      }
    }
  }

  function unary(): Node {
    if (isOp("-")) {
      pos++;
      return { t: "neg", x: unary() };
    }
    return power();
  }

  function power(): Node {
    const base = postfix();
    if (isOp("^")) {
      pos++;
      return { t: "pow", b: base, e: power() };
    }
    return base;
  }

  function postfix(): Node {
    let x = primary();
    while (isOp("%")) {
      pos++;
      x = { t: "pct", x };
      // "10 % 3" is a remainder, which this does not work out.
      const after = at();
      if (after !== undefined && startsPrimary(after)) fail();
    }
    return x;
  }

  function primary(): Node {
    const t = at();
    if (t === undefined) fail();
    pos++;
    if (t.k === "num") return { t: "num", v: t.v };
    if (t.k === "var") return { t: "var", name: t.name };
    if (t.k === "open") {
      const inner = expr();
      if (at()?.k !== "close") fail();
      pos++;
      return { t: "paren", x: inner };
    }
    if (t.k === "root") return { t: "sqrt", x: primary() };
    return fail();
  }

  const node = expr();
  if (pos !== toks.length) fail();
  return { node, decimal };
}

function kids(n: Node): Node[] {
  switch (n.t) {
    case "num":
    case "var":
      return [];
    case "neg":
    case "paren":
    case "sqrt":
    case "pct":
      return [n.x];
    case "bin":
      return [n.l, n.r];
    case "pow":
      return [n.b, n.e];
  }
}

function at2(list: Node[], i: number): Node {
  return list[i] ?? fail();
}

function withKids(n: Node, k: Node[]): Node {
  switch (n.t) {
    case "num":
    case "var":
      return n;
    case "neg":
      return { t: "neg", x: at2(k, 0) };
    case "paren":
      return { t: "paren", x: at2(k, 0) };
    case "sqrt":
      return { t: "sqrt", x: at2(k, 0) };
    case "pct":
      return { t: "pct", x: at2(k, 0) };
    case "bin":
      return { t: "bin", op: n.op, l: at2(k, 0), r: at2(k, 1) };
    case "pow":
      return { t: "pow", b: at2(k, 0), e: at2(k, 1) };
  }
}

// Negative numbers and parens around a plain number are folded away. Nothing else is simplified.
function fold(n: Node): Node {
  const m = withKids(n, kids(n).map((k) => fold(k)));
  if (m.t === "neg" && m.x.t === "num") return { t: "num", v: neg(m.x.v) };
  if (m.t === "paren" && m.x.t === "num") return m.x;
  return m;
}

function numOf(n: Node): Frac {
  if (n.t !== "num") fail();
  return n.v;
}

function varNames(n: Node): string[] {
  if (n.t === "var") return [n.name];
  return kids(n).flatMap((k) => varNames(k));
}

function numbersIn(n: Node): Frac[] {
  if (n.t === "num") return [n.v];
  return kids(n).flatMap((k) => numbersIn(k));
}

// The expression as the student wrote it, with × ÷ −.
function show(n: Node, right = false): string {
  switch (n.t) {
    case "num":
      return right && n.v.n < 0 ? `(${shown(n.v)})` : shown(n.v);
    case "var":
      return n.name;
    case "neg":
      return `−${show(n.x)}`;
    case "paren":
      return `(${show(n.x)})`;
    case "bin":
      return `${show(n.l)} ${SYM[n.op]} ${show(n.r, true)}`;
    case "pow":
      return `${n.b.t === "num" && (n.b.v.n < 0 || n.b.v.d !== 1) ? `(${show(n.b)})` : show(n.b)}^${show(n.e)}`;
    case "sqrt":
      return `√${show(n.x)}`;
    case "pct":
      return `${show(n.x)}%`;
  }
}

type Pick = { path: number[]; node: Node; depth: number; parentParen: boolean; index: number };

// Every operation whose parts are all numbers now. Depth counts the parens around it.
function collectReady(n: Node, path: number[], depth: number, parentParen: boolean, out: Pick[]): void {
  const ks = kids(n);
  const isOp = n.t === "bin" || n.t === "pow" || n.t === "sqrt" || n.t === "pct";
  if (isOp && ks.every((k) => k.t === "num")) out.push({ path, node: n, depth, parentParen, index: out.length });
  ks.forEach((k, i) => collectReady(k, [...path, i], n.t === "paren" ? depth + 1 : depth, n.t === "paren", out));
}

// Order a student would work in: inside the parens first, then powers and roots, then * / and then + -, each left to right.
function rankLess(a: Pick, b: Pick): boolean {
  const cls = (p: Pick): number => (p.node.t === "bin" ? (p.node.op === "*" || p.node.op === "/" ? 1 : 2) : 0);
  if (a.depth !== b.depth) return a.depth > b.depth;
  if (cls(a) !== cls(b)) return cls(a) < cls(b);
  return a.index < b.index;
}

function replaceAt(n: Node, path: number[], value: Node): Node {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  return withKids(
    n,
    kids(n).map((k, j) => (j === head ? replaceAt(k, rest, value) : k)),
  );
}

function apply(n: Node): Frac {
  switch (n.t) {
    case "bin": {
      const l = numOf(n.l);
      const r = numOf(n.r);
      if (n.op === "+") return add(l, r);
      if (n.op === "-") return sub(l, r);
      if (n.op === "*") return mul(l, r);
      return div(l, r);
    }
    case "pow": {
      const e = numOf(n.e);
      if (!isExp(e)) fail();
      return pow(numOf(n.b), e.n);
    }
    case "sqrt":
      return sqrtFrac(numOf(n.x));
    case "pct":
      return mul(numOf(n.x), frac(1, 100));
    default:
      return fail();
  }
}

function describe(p: Pick, value: Frac): Step {
  const n = p.node;
  const result = shown(value);
  switch (n.t) {
    case "bin":
      return {
        title: p.parentParen ? "Parentheses" : BIN_TITLE[n.op],
        detail: `${shown(numOf(n.l))} ${SYM[n.op]} ${operand(numOf(n.r))} = ${result}`,
      };
    case "pow":
      return { title: "Power", detail: `${bracket(numOf(n.b))}^${numOf(n.e).n} = ${result}` };
    case "sqrt":
      return { title: "Square root", detail: `√${bracket(numOf(n.x))} = ${result}` };
    case "pct":
      return { title: "Percent", detail: `${shown(numOf(n.x))}% = ${result}` };
    default:
      return fail();
  }
}

// Works the expression out one operation at a time, writing each step.
function reduce(start: Node): { value: Frac; steps: Step[] } {
  const steps: Step[] = [];
  let tree = fold(start);
  let last: Frac | null = null;
  while (tree.t !== "num") {
    const picks: Pick[] = [];
    collectReady(tree, [], 0, false, picks);
    const pick = picks.reduce<Pick | null>((best, p) => (best === null || rankLess(p, best) ? p : best), null) ?? fail();
    const value = apply(pick.node);
    last = value;
    const step = describe(pick, value);
    tree = fold(replaceAt(tree, pick.path, { t: "num", v: value }));
    const suffix = tree.t === "num" ? "" : ` Now it is ${show(tree)}.`;
    steps.push({ title: step.title, detail: step.detail + suffix });
  }
  if (tree.t !== "num") fail();
  // A minus sign in front of the whole thing is the last step: -2^2 is 4, then −4.
  if (last !== null && !eq(last, tree.v)) steps.push({ title: "Make it negative", detail: `The minus sign in front makes it ${shown(tree.v)}.` });
  return { value: tree.v, steps };
}

// More than six operations: the first five, then a Finish step.
function limitSteps(steps: Step[]): Step[] {
  if (steps.length <= MAX_STEPS) return steps;
  return [...steps.slice(0, MAX_STEPS - 1), { title: "Finish", detail: "Keep going the same way until one number is left." }];
}

function draftOf(steps: Step[], answer: string): HelpDraft {
  return { steps: limitSteps(steps), answer };
}

// ---- Equations: each side as a polynomial in one variable ----

const co = (p: Poly, i: number): Frac => p[i] ?? ZERO;
const padd = (a: Poly, b: Poly): Poly => [0, 1, 2].map((i) => add(co(a, i), co(b, i)));
const pmap = (p: Poly, f: (c: Frac) => Frac): Poly => [0, 1, 2].map((i) => f(co(p, i)));
const psub = (a: Poly, b: Poly): Poly => padd(a, pmap(b, neg));

function pmul(a: Poly, b: Poly): Poly {
  const out: Poly = [ZERO, ZERO, ZERO];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const product = mul(co(a, i), co(b, j));
      if (i + j > 2) {
        if (!isZero(product)) fail();
      } else {
        out[i + j] = add(co(out, i + j), product);
      }
    }
  }
  return out;
}

function constOf(p: Poly): Frac {
  if (!isZero(co(p, 1)) || !isZero(co(p, 2))) fail();
  return co(p, 0);
}

function polyOf(n: Node, name: string): Poly {
  switch (n.t) {
    case "num":
      return [n.v, ZERO, ZERO];
    case "var":
      if (n.name !== name) fail();
      return [ZERO, ONE, ZERO];
    case "paren":
      return polyOf(n.x, name);
    case "neg":
      return pmap(polyOf(n.x, name), neg);
    case "bin": {
      const l = polyOf(n.l, name);
      const r = polyOf(n.r, name);
      if (n.op === "+") return padd(l, r);
      if (n.op === "-") return psub(l, r);
      if (n.op === "*") return pmul(l, r);
      const divisor = constOf(r);
      if (isZero(divisor)) fail();
      return pmap(l, (c) => div(c, divisor));
    }
    case "pow": {
      const base = polyOf(n.b, name);
      const e = constOf(polyOf(n.e, name));
      if (!isExp(e)) fail();
      let acc: Poly = [ONE, ZERO, ZERO];
      for (let i = 0; i < e.n; i++) acc = pmul(acc, base);
      return acc;
    }
    case "sqrt":
      return [sqrtFrac(constOf(polyOf(n.x, name))), ZERO, ZERO];
    case "pct":
      return pmap(polyOf(n.x, name), (c) => mul(c, frac(1, 100)));
  }
}

// One term without its sign: 2x, x, x/3, x^2.
function termText(c: Frac, name: string, deg: number): string {
  const v = c.n < 0 ? neg(c) : c;
  if (deg === 0) return plain(v);
  const letters = deg === 1 ? name : `${name}^2`;
  if (v.d === 1) return v.n === 1 ? letters : `${v.n}${letters}`;
  return `${v.n === 1 ? "" : v.n}${letters}/${v.d}`;
}

function polyText(p: Poly, name: string): string {
  let out = "";
  for (let deg = 2; deg >= 0; deg--) {
    const c = co(p, deg);
    if (isZero(c)) continue;
    const mag = termText(c, name, deg);
    if (out === "") out = c.n < 0 ? `-${mag}` : mag;
    else out += c.n < 0 ? ` - ${mag}` : ` + ${mag}`;
  }
  return out === "" ? "0" : out;
}

// A side needs a Simplify step when it has brackets, a product, a root or a power, or two terms of the same power.
function simplifies(side: string, name: string): boolean {
  const t = side.replace(/\s+/g, "");
  if (/[()*^√%]/.test(t)) return true;
  const counts = new Map<number, number>();
  for (const piece of t.split(/(?=[+-])/)) {
    if (piece === "") continue;
    const deg = piece.includes(name) ? 1 : 0;
    counts.set(deg, (counts.get(deg) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

const over = (a: Frac): string => (a.d === 1 ? plain(a) : `(${plain(a)})`);

function quadratic(P: Poly, name: string, decimal: boolean): HelpDraft {
  const a = co(P, 2);
  const b = co(P, 1);
  const c = co(P, 0);
  const disc = sub(mul(b, b), mul(frac(4), mul(a, c)));
  const steps: Step[] = [
    { title: "Move everything to one side", detail: `${polyText(P, name)} = 0` },
    { title: "Use the quadratic formula", detail: `a = ${plain(a)}, b = ${plain(b)}, c = ${plain(c)}` },
    { title: "Find the discriminant", detail: `b^2 - 4ac = ${plain(disc)}` },
  ];
  if (disc.n < 0) return { steps, answer: "No real solution" };
  const twoA = mul(frac(2), a);
  const negB = neg(b);
  if (disc.n === 0) {
    steps.push({ title: "Find the answers", detail: `${name} = (${plain(negB)} ± 0) / ${over(twoA)}` });
    return { steps, answer: `${name} = ${answerText(div(negB, twoA), decimal)}` };
  }
  const root = sqrtFrac(disc);
  const r1 = div(sub(negB, root), twoA);
  const r2 = div(add(negB, root), twoA);
  steps.push({ title: "Find the answers", detail: `${name} = (${plain(negB)} ± ${plain(root)}) / ${over(twoA)}` });
  const ascending = sub(r2, r1).n >= 0;
  const small = ascending ? r1 : r2;
  const big = ascending ? r2 : r1;
  return { steps, answer: `${name} = ${answerText(small, decimal)} or ${name} = ${answerText(big, decimal)}` };
}

function linear(L0: Poly, R0: Poly, name: string, leftText: string, rightText: string, decimal: boolean): HelpDraft {
  let L = L0;
  let R = R0;
  const steps: Step[] = [];
  const pl = (p: Poly): string => polyText(p, name);
  const changed = simplifies(leftText, name) || simplifies(rightText, name);
  if (changed) steps.push({ title: "Simplify", detail: `${pl(L)} = ${pl(R)}` });

  const aR = co(R, 1);
  if (!isZero(aR)) {
    const shift: Poly = [ZERO, aR, ZERO];
    L = psub(L, shift);
    R = psub(R, shift);
    const verb =
      aR.n > 0 ? `Subtract ${termText(aR, name, 1)} from both sides` : `Add ${termText(aR, name, 1)} to both sides`;
    // When the variable cancels, this step is the Simplify step for the equation.
    const cancels = isZero(co(L, 1));
    steps.push({ title: cancels && !changed ? "Simplify" : "Move the variable", detail: `${verb}: ${pl(L)} = ${pl(R)}` });
  }

  const a = co(L, 1);
  if (isZero(a)) {
    if (!steps.some((s) => s.title === "Simplify")) steps.push({ title: "Simplify", detail: `${pl(L)} = ${pl(R)}` });
    const answer = eq(co(L, 0), co(R, 0)) ? "Every number works" : "No solution";
    return { steps, answer };
  }

  const c = co(L, 0);
  if (!isZero(c)) {
    L = [ZERO, a, ZERO];
    R = psub(R, [c, ZERO, ZERO]);
    const verb = c.n > 0 ? `Subtract ${plain(c)} from both sides` : `Add ${plain(neg(c))} to both sides`;
    steps.push({ title: "Move the number", detail: `${verb}: ${pl(L)} = ${pl(R)}` });
  }

  let x = co(R, 0);
  if (!eq(a, ONE)) {
    x = div(x, a);
    const shownX = decimal ? (decimalText(x) ?? plain(x)) : plain(x);
    steps.push({ title: "Divide", detail: `Divide both sides by ${plain(a)}: ${name} = ${shownX}` });
  }
  if (steps.length === 0) steps.push({ title: "Simplify", detail: `${pl(L)} = ${pl(R)}` });
  return { steps, answer: `${name} = ${answerText(x, decimal)}` };
}

function solveEquation(L: Poly, R: Poly, name: string, leftText: string, rightText: string, decimal: boolean): HelpDraft {
  const P = psub(L, R);
  if (!isZero(co(P, 2))) return quadratic(P, name, decimal);
  if (!isZero(co(L, 2)) || !isZero(co(R, 2))) fail();
  return linear(L, R, name, leftText, rightText, decimal);
}

function solveUnsafe(problem: string): HelpDraft | null {
  let text = problem.trim().replace(LIST_MARKER, "");
  const instruction = INSTRUCTION.exec(text);
  const letter = (instruction?.[1] ?? instruction?.[2] ?? instruction?.[3])?.toLowerCase();
  if (instruction !== null) text = text.slice(instruction[0].length);
  // "3 x 4" uses x as a times sign.
  text = trimTail(text).replace(/(\d)\s+[xX]\s+(?=\d|\([^a-z)]*\))/gi, "$1 * ").replace(PERCENT_OF, (_all: string, a: string, b: string) => `(${a}/100)*(${b})`).replace(/sqrt/gi, "√");
  // Any word left over (two or more letters together) means it is not math. A single letter is a variable.
  if (/[a-z]{2,}/i.test(text) || !/\d/.test(text)) return null;
  const sides = text.split("=");
  if (sides.length > 2) return null;

  if (sides.length === 1) {
    if (letter !== undefined || /[a-z]/i.test(text)) return null;
    if (isDateOrRange(text)) return null;
    const { node, decimal } = parseText(text);
    const { value, steps } = reduce(node);
    if (steps.length === 0) return null;
    return draftOf(steps, answerText(value, decimal));
  }

  const [left = "", right = ""] = sides;
  const l = parseText(left);
  const r = parseText(right);
  const names = [...new Set([...varNames(l.node), ...varNames(r.node)])];
  const name = names[0];
  if (names.length !== 1 || name === undefined) return null;
  if (letter !== undefined && letter !== name) return null;
  return solveEquation(polyOf(l.node, name), polyOf(r.node, name), name, left, right, l.decimal || r.decimal);
}

// A date, a phone number, or a range such as 3-5, none of which is a sum to work out. 12-5 with no spaces is still subtraction.
function isDateOrRange(text: string): boolean {
  const t = text.trim();
  if (/^\d{1,4}([/-])\d{1,4}\1\d{1,4}$/.test(t) || /\d-\d{3}-\d{3,4}/.test(t) || /\)\s*\d{3}-\d{4}/.test(t)) return true;
  const range = /^(\d+)-(\d+)$/.exec(t);
  return range !== null && Number(range[1]) < Number(range[2]);
}

// Removes trailing ?, ., spaces, and a trailing "=", "= ?" or "= ___".
function trimTail(text: string): string {
  let t = text.trim();
  for (;;) {
    const next = t.replace(/[?.\s]+$/, "").replace(/\s*=\s*(?:\?|_+)?$/, "");
    if (next === t) return t;
    t = next;
  }
}

// Solves a problem that is only numbers, or one equation in one variable, with every step. Null when it is not one
// of those (a word problem, a scripture reference, a degree above 2, anything that is not exact).
export function solveMath(problem: string): HelpDraft | null {
  try {
    return solveUnsafe(problem);
  } catch (error) {
    if (error instanceof MathError) return null;
    throw error;
  }
}

function stripMarker(problem: string): string {
  return problem.trim().replace(LIST_MARKER, "");
}

function stripScripture(text: string): string {
  return text.replace(SCRIPTURE, " ").replace(TEXT_PLACE, " ");
}

// True when a problem asks a math question with at least one number.
export function needsMathPlan(problem: string): boolean {
  const rest = stripScripture(problem);
  const hasNumber = /\d/.test(rest) || new RegExp(`\\b(${NUMBER_WORD_LIST})\\b`, "i").test(rest);
  return hasNumber && MATH_CUE.test(rest);
}

// Any problem with a digit outside a scripture reference or a page label could need math, so its answer must be checked.
export function looksLikeMath(problem: string): boolean {
  return needsMathPlan(problem) || /\d/.test(stripScripture(problem));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unitAppears(text: string, unit: string): boolean {
  const u = unit.trim().toLowerCase();
  if (u.length < 2 || u === "none") return false;
  const lower = text.toLowerCase();
  return [u, u.replace(/s$/, ""), `${u}s`].some((form) => new RegExp(`\\b${escapeRe(form)}\\b`).test(lower));
}

function checkedUnsafe(problem: string, plans: MathPlan[]): HelpDraft | null {
  if (plans.length !== 3) return null;
  const text = stripScripture(stripMarker(problem));
  const lower = text.toLowerCase();
  const digits = [...text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].map((m) => decimalFrac((m[0] ?? "").replace(/,/g, "")));
  const words = [...lower.matchAll(new RegExp(`\\b(${NUMBER_WORD_LIST})\\b`, "g"))].map((m) => frac(NUMBER_WORDS[m[1] ?? ""] ?? fail()));
  const extras: number[] = [1, 2, 100];
  if (/\b(year|month|dozen|foot|feet|inch)s?\b/.test(lower)) extras.push(12);
  if (/\bweeks?\b/.test(lower)) extras.push(7);
  if (/\b(hours?|minutes?)\b/.test(lower)) extras.push(60);
  const allowed = [...digits, ...words, ...extras.map((n) => frac(n))];
  const decimal = /\d\.\d/.test(text);
  const asksHowMany = /\bhow (many|much)\b/.test(lower);
  const wholeOnly = /\bhow many\b/.test(lower) && !/\b(average|mean|per)\b/.test(lower);

  const solved: { plan: MathPlan; node: Node; value: Frac; steps: Step[] }[] = [];
  for (const plan of plans) {
    const { node } = parseText(plan.expression);
    if (varNames(node).length > 0) return null;
    const nums = numbersIn(node);
    if (!nums.every((v) => allowed.some((a) => eq(a, v)))) return null;
    if (!digits.every((d) => nums.some((v) => eq(v, d)))) return null;
    const { value, steps } = reduce(node);
    if (asksHowMany && value.n < 0) return null;
    if (wholeOnly && value.d !== 1) return null;
    solved.push({ plan, node, value, steps });
  }
  const head = solved[0];
  if (head === undefined || solved.some((s) => !eq(s.value, head.value))) return null;

  const sameUnit = solved.every((s) => s.plan.unit.trim().toLowerCase() === head.plan.unit.trim().toLowerCase());
  const unit = sameUnit && unitAppears(text, head.plan.unit) ? ` ${head.plan.unit.trim()}` : "";
  return {
    steps: [{ title: "Write the math", detail: show(head.node) }, ...limitSteps(head.steps)],
    answer: `${answerText(head.value, decimal)}${unit}`,
  };
}

// Returns a draft only when three plans agree on one exact value and pass the checks against the problem.
export function checkedPlan(problem: string, plans: MathPlan[]): HelpDraft | null {
  try {
    return checkedUnsafe(problem, plans);
  } catch (error) {
    if (error instanceof MathError) return null;
    throw error;
  }
}

const planSchema = z.object({ expression: z.string(), unit: z.string() });

function readPlan(reply: unknown): MathPlan | null {
  const parsed = planSchema.safeParse(reply);
  return parsed.success ? parsed.data : null;
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

// Solves by code when it can. Otherwise asks the model for three plans, and shows an answer only when they agree.
export async function helpFor(port: MathPort, problem: { text: string; context: string }): Promise<HelpAnswer | null> {
  const solved = solveMath(problem.text);
  if (solved !== null) return { draft: solved, answerChecked: true };

  if (needsMathPlan(problem.text)) {
    const plans: MathPlan[] = [];
    let valid = true;
    for (let i = 0; i < 3; i++) {
      try {
        const plan = readPlan(await port.planMath(problem.text));
        if (plan === null) valid = false;
        else plans.push(plan);
      } catch (error) {
        if (isCode(error, "unsupported_language")) throw error;
        valid = false;
      }
    }
    const checked = valid ? checkedPlan(problem.text, plans) : null;
    if (checked !== null) return { draft: checked, answerChecked: true };
  }

  const draft = cleanHelp(await port.helpWithProblem(problem.text, problem.context));
  if (draft === null) return null;
  if (!looksLikeMath(problem.text)) return { draft, answerChecked: true };
  return { draft: { ...draft, steps: draft.steps.map((step) => ({ ...step, detail: withoutResults(step.detail) })) }, answerChecked: false };
}

// An unchecked step keeps its method but loses any sentence that states a worked-out result.
function withoutResults(detail: string): string {
  const kept = detail.split(/(?<=[.!?])\s+/).filter((sentence) => !/\d\s*=|=\s*\d|\b(?:to get|gets?|is|are|equals?|makes?|gives?|answer)\b[^.!?]*\d/i.test(sentence));
  return kept.length > 0 ? kept.join(" ") : "Try this part yourself.";
}
