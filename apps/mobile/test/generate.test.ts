import { describe, expect, it } from "vitest";
import { inputBudget, makeCardsFromUnits, makeQuizFromUnits, packUnits, type ModelPort, type Unit } from "../src/core/study/generate.ts";

type Call = { kind: "cards" | "quiz"; text: string; n: number };

// Fake model: records each call, then answers with respond() or throws what fail() returns.
function fakePort(respond: (call: Call, index: number) => unknown, options: { contextSize?: number; fail?: (call: Call, index: number) => unknown } = {}) {
  const calls: Call[] = [];
  const handle = async (call: Call): Promise<unknown> => {
    calls.push(call);
    const failure = options.fail?.(call, calls.length);
    if (failure !== undefined) throw failure;
    return respond(call, calls.length);
  };
  const port: ModelPort = {
    contextSize: () => options.contextSize ?? 4096,
    makeCards: (text, n) => handle({ kind: "cards", text, n }),
    makeQuiz: (text, n) => handle({ kind: "quiz", text, n }),
  };
  return { port, calls };
}

const unit = (text: string, captureId: string | null = null, t: number | null = null): Unit => ({ text, captureId, t });
const big = (fill: string, chars = 1500) => fill.repeat(chars / fill.length);  // 1,500 characters = 500 tokens
const term = (front: string, back = "A meaning.") => ({ kind: "term", front, back });
const quizItem = (question: string) => ({ question, choices: ["a", "b", "c", "d"], answerIndex: 0, why: "Because." });

describe("inputBudget and packing", () => {
  it("keeps 1,500 tokens for instructions and output, and never less than 500", () => {
    expect(inputBudget(4096)).toBe(2596);
    expect(inputBudget(1000)).toBe(500);
  });

  it("keeps the order and makes every group fit the budget", () => {
    const units = [unit("a".repeat(30)), unit("b".repeat(30)), unit("c".repeat(30)), unit("d".repeat(30))];
    const groups = packUnits(units, 25);
    expect(groups.flat().map((u) => u.text[0])).toEqual(["a", "b", "c", "d"]);
    expect(groups.map((g) => g.map((u) => u.text[0]))).toEqual([["a", "b"], ["c", "d"]]);
    for (const group of groups) expect(group.reduce((n, u) => n + Math.ceil(u.text.length / 3), 0)).toBeLessThanOrEqual(25);
  });

  it("splits one huge unit at sentence ends and keeps its captureId and t", () => {
    const text = "Cells grow. They divide. Each part is small. Then they rest.";
    const groups = packUnits([unit(text, "p9", 4000)], 7);
    const parts = groups.flat();
    expect(parts.map((p) => p.text)).toEqual(["Cells grow.", "They divide.", "Each part is small.", "Then they rest."]);
    for (const part of parts) {
      expect(Math.ceil(part.text.length / 3)).toBeLessThanOrEqual(7);
      expect(part.text).toMatch(/[.?!]$/);
      expect(part.captureId).toBe("p9");
      expect(part.t).toBe(4000);
    }
    expect(parts.map((p) => p.text).join(" ")).toBe(text);
  });

  it("cuts a sentence longer than the budget by characters", () => {
    const parts = packUnits([unit("x".repeat(100))], 10).flat();
    expect(parts.map((p) => p.text.length)).toEqual([30, 30, 30, 10]);
  });
});

describe("makeCardsFromUnits", () => {
  it("spreads the card count by group size and caps the total", async () => {
    let n = 0;
    const { port, calls } = fakePort(() => [term(`Term ${++n}`), term(`Other ${++n}`), term(`More ${++n}`)]);
    const units = [unit(big("a ")), unit(big("b ")), unit(big("c "))];  // budget 500 tokens: one group each
    const cards = await makeCardsFromUnits({ ...port, contextSize: () => 2000 }, units, 5);
    expect(calls.map((c) => c.n)).toEqual([2, 2, 2]);
    expect(cards).toHaveLength(5);
  });

  it("gives each card the page whose text contains its front", async () => {
    const { port } = fakePort(() => [term("Mitosis"), term("Osmosis")]);
    const units = [unit("Photosynthesis makes sugar.", "p1", 0), unit("Mitosis splits cells.", "p2", 900)];
    const cards = await makeCardsFromUnits(port, units, 5);
    expect(cards.map((c) => [c.front, c.captureId, c.t])).toEqual([
      ["Mitosis", "p2", 900],
      ["Osmosis", "p1", 0],
    ]);
  });

  it("splits a group in half once after context_too_long and succeeds", async () => {
    const { port, calls } = fakePort(
      (call, index) => [term(`Half ${index}`)],
      { fail: (_call, index) => (index === 1 ? { code: "context_too_long" } : undefined) },
    );
    const units = [unit("first page"), unit("second page")];
    const cards = await makeCardsFromUnits(port, units, 5);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.text).toBe("first page");
    expect(calls[2]?.text).toBe("second page");
    expect(cards.map((c) => c.front)).toEqual(["Half 2", "Half 3"]);
  });

  it("rethrows a second context_too_long on a half", async () => {
    const { port, calls } = fakePort(() => [], { fail: () => ({ code: "context_too_long" }) });
    await expect(makeCardsFromUnits(port, [unit("first page"), unit("second page")], 5)).rejects.toMatchObject({ code: "context_too_long" });
    expect(calls).toHaveLength(2);
  });

  it("rethrows any other error without retrying", async () => {
    const { port, calls } = fakePort(() => [], { fail: () => new Error("boom") });
    await expect(makeCardsFromUnits(port, [unit("page")], 5)).rejects.toThrow("boom");
    expect(calls).toHaveLength(1);
  });

  it("drops a front that repeats one from an earlier group and keeps the first", async () => {
    let n = 0;
    const { port } = fakePort(() => [term("Same", `back ${++n}`)]);
    const units = [unit(big("a ")), unit(big("b "))];
    const cards = await makeCardsFromUnits({ ...port, contextSize: () => 2000 }, units, 5);
    expect(cards).toEqual([expect.objectContaining({ front: "Same", back: "back 1" })]);
  });
});

describe("makeQuizFromUnits", () => {
  it("spreads the count across groups and stops at it", async () => {
    const { port, calls } = fakePort(() => [quizItem("Q1"), quizItem("Q2")]);
    const units = [unit(big("a ")), unit(big("b "))];
    const quiz = await makeQuizFromUnits({ ...port, contextSize: () => 2000 }, units, 3);
    expect(calls.map((c) => c.n)).toEqual([2, 2]);
    expect(quiz).toHaveLength(3);
  });
});
