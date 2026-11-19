import { describe, expect, it } from "vitest";
import { cleanCards, cleanHelp, cleanQuiz } from "../src/core/study/drafts.ts";

const term = (front: string, back = "A meaning.") => ({ kind: "term", front, back });
const quiz = (overrides: Record<string, unknown> = {}) => ({
  question: "Which is right?",
  choices: ["one", "two", "three", "four"],
  answerIndex: 1,
  why: "Two is right.",
  ...overrides,
});

describe("cleanCards", () => {
  it("returns [] when the input is not an array", () => {
    expect(cleanCards({ cards: [] }, 10)).toEqual([]);
    expect(cleanCards(null, 10)).toEqual([]);
  });

  it("keeps valid term and problem cards in order", () => {
    const out = cleanCards([term("Mitosis", "Cell division."), { kind: "problem", front: "3x = 6", back: "x = 2" }], 10);
    expect(out).toEqual([
      { kind: "term", front: "Mitosis", back: "Cell division." },
      { kind: "problem", front: "3x = 6", back: "x = 2" },
    ]);
  });

  it("drops items that do not have the expected shape, one by one", () => {
    const out = cleanCards([null, "text", { kind: "other", front: "a", back: "b" }, { kind: "term", front: "missing back" }, term("Keep")], 10);
    expect(out.map((c) => c.front)).toEqual(["Keep"]);
  });

  it("trims strings and collapses whitespace to single spaces", () => {
    expect(cleanCards([term("  Cell \n\t wall ", "  A   rigid\nlayer.  ")], 10)).toEqual([
      { kind: "term", front: "Cell wall", back: "A rigid layer." },
    ]);
  });

  it("drops cards with an empty front or back", () => {
    expect(cleanCards([term("   "), term("Front", " "), term("Kept")], 10).map((c) => c.front)).toEqual(["Kept"]);
  });

  it("cuts a front over 200 characters at a word boundary with an ellipsis", () => {
    const front = cleanCards([term("word ".repeat(60))], 10)[0]?.front ?? "";
    expect(front.length).toBeLessThanOrEqual(200);
    expect(front.endsWith("word…")).toBe(true);
  });

  it("cuts a back over 1,000 characters at a word boundary with an ellipsis", () => {
    const back = cleanCards([term("Long", "phrase ".repeat(300))], 10)[0]?.back ?? "";
    expect(back.length).toBeLessThanOrEqual(1000);
    expect(back.endsWith("phrase…")).toBe(true);
  });

  it("keeps the first card when fronts match ignoring case and punctuation", () => {
    const out = cleanCards([term("Cell wall.", "first"), term("cell  WALL", "second"), term("Cell membrane", "third")], 10);
    expect(out).toEqual([
      { kind: "term", front: "Cell wall.", back: "first" },
      { kind: "term", front: "Cell membrane", back: "third" },
    ]);
  });

  it("returns at most max cards", () => {
    expect(cleanCards([term("A"), term("B"), term("C")], 2).map((c) => c.front)).toEqual(["A", "B"]);
  });
});

describe("cleanQuiz", () => {
  it("returns [] when the input is not an array", () => {
    expect(cleanQuiz("nope", 5)).toEqual([]);
  });

  it("keeps a valid question with its choices, answer index and reason", () => {
    expect(cleanQuiz([quiz()], 5)).toEqual([
      { question: "Which is right?", choices: ["one", "two", "three", "four"], answerIndex: 1, why: "Two is right." },
    ]);
  });

  it("drops a question without exactly four choices", () => {
    expect(cleanQuiz([quiz({ choices: ["a", "b", "c"] }), quiz({ choices: ["a", "b", "c", "d", "e"] }), quiz()], 5)).toHaveLength(1);
  });

  it("drops a question whose choices are not distinct", () => {
    expect(cleanQuiz([quiz({ choices: ["a", "a", "c", "d"] })], 5)).toEqual([]);
  });

  it("drops a question with an empty choice", () => {
    expect(cleanQuiz([quiz({ choices: ["a", "  ", "c", "d"] })], 5)).toEqual([]);
  });

  it("drops a question whose answer index is not 0 to 3", () => {
    expect(cleanQuiz([quiz({ answerIndex: 4 }), quiz({ answerIndex: -1 }), quiz({ answerIndex: 1.5 }), quiz({ answerIndex: 3 })], 5)).toHaveLength(1);
  });

  it("drops a question with an empty question text", () => {
    expect(cleanQuiz([quiz({ question: " " })], 5)).toEqual([]);
  });

  it("returns at most count questions", () => {
    expect(cleanQuiz([quiz(), quiz(), quiz()], 2)).toHaveLength(2);
  });
});

describe("cleanHelp", () => {
  const steps = [
    { title: "Isolate x", detail: "Subtract 7 from both sides." },
    { title: "Divide", detail: "Divide both sides by 3." },
  ];

  it("returns null when the input is not an object with steps and an answer", () => {
    expect(cleanHelp("steps")).toBeNull();
    expect(cleanHelp({ steps: "many", answer: "5" })).toBeNull();
  });

  it("keeps valid steps and the answer", () => {
    expect(cleanHelp({ steps, answer: "x = 5" })).toEqual({ steps, answer: "x = 5" });
  });

  it("drops steps with an empty title or detail and keeps the rest", () => {
    const out = cleanHelp({ steps: [{ title: "", detail: "x" }, { title: "Keep", detail: "Yes." }, "bad"], answer: "5" });
    expect(out).toEqual({ steps: [{ title: "Keep", detail: "Yes." }], answer: "5" });
  });

  it("returns null when no step is left", () => {
    expect(cleanHelp({ steps: [{ title: "T", detail: "  " }], answer: "5" })).toBeNull();
  });

  it("returns null when the answer is empty", () => {
    expect(cleanHelp({ steps, answer: "   " })).toBeNull();
  });

  it("cuts more than 8 steps to 8", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `Step ${i}`, detail: "Do it." }));
    const out = cleanHelp({ steps: many, answer: "done" });
    expect(out?.steps).toHaveLength(8);
    expect(out?.steps[7]?.title).toBe("Step 7");
  });
});
