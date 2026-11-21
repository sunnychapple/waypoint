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
const quizItem = (question: string, answer = "a", evidence = answer) => ({ question, evidence, answer, wrongChoices: ["x1", "x2", "x3"], why: "Because." });

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
    const { port, calls } = fakePort((_call, index) => [quizItem(`Q${index}a`), quizItem(`Q${index}b`)]);
    const units = [unit(big("a ")), unit(big("a b "))];  // both pages contain the answer "a"
    const quiz = await makeQuizFromUnits({ ...port, contextSize: () => 2000 }, units, 3);
    expect(calls.map((c) => c.n)).toEqual([2, 2]);
    expect(quiz).toHaveLength(3);
  });

  it("finds the source page when the front spans a line break on the page", async () => {
    const { port } = fakePort(() => [term("Solve 3x + 7 = 22")]);
    const units = [unit("Page one intro.", "p1", null), unit("Worksheet\nSolve 3x + 7\n= 22\nmore", "p2", null)];
    const cards = await makeCardsFromUnits(port, units, 5);
    expect(cards.map((c) => c.captureId)).toEqual(["p2"]);
  });

  it("asks the model nothing when every unit is blank", async () => {
    const { port, calls } = fakePort(() => [term("x")]);
    expect(await makeCardsFromUnits(port, [unit("", "p1"), unit("  \n ", "p2")], 5)).toEqual([]);
    expect(calls).toEqual([]);
  });
  it("keeps a question whose answer is in the page text, and puts the right answer at its marked position", async () => {
    const text = 'Waypoint uses a generated name "Waypoint (164818)" while the record is set up.';
    const { port } = fakePort(() => [
      quizItem("What is the temporary name of the record?", "Waypoint (164818)", 'generated name "Waypoint (164818)"'),
    ]);
    const quiz = await makeQuizFromUnits(port, [unit(text)], 5);
    expect(quiz).toHaveLength(1);
    expect(quiz[0]?.choices[quiz[0].answerIndex]).toBe("Waypoint (164818)");
    expect(quiz[0]?.choices).toHaveLength(4);
    expect(quiz[0]).not.toHaveProperty("evidence");
  });

  it("drops a question whose answer and evidence are not in the page text", async () => {
    const text = 'Waypoint uses a generated name "Waypoint (164818)" while the record is set up.';
    const { port } = fakePort(() => [
      quizItem("What is the temporary name of the App Store Connect record?", "App Store Connect", 'Using generated name "Waypoint (164818)"'),
    ]);
    expect(await makeQuizFromUnits(port, [unit(text)], 5)).toEqual([]);
  });

  it("keeps a grounded question and drops an ungrounded one from the same answer", async () => {
    const text = "Mitosis splits one cell into two.";
    const { port } = fakePort(() => [
      quizItem("What splits a cell?", "Mitosis", "Mitosis splits one cell into two."),
      quizItem("What is the capital of France?", "Paris", "Paris is the capital."),
    ]);
    const quiz = await makeQuizFromUnits(port, [unit(text)], 5);
    expect(quiz.map((q) => q.question)).toEqual(["What splits a cell?"]);
  });

  it("keeps a question whose evidence is in the page text and whose answer is in the evidence", async () => {
    const text = "The sun is a star. Plants use sunlight to make sugar.";
    const { port } = fakePort(() => [quizItem("What do plants use?", "sunlight", "Plants use sunlight to make sugar.")]);
    const quiz = await makeQuizFromUnits(port, [unit(text)], 5);
    expect(quiz.map((q) => q.question)).toEqual(["What do plants use?"]);
  });
  it("drops a question whose answer is on the page but not in its evidence", async () => {
    const text = 'Waypoint uses the generated name "Waypoint (164818)". Later, App Store Connect shows the real name.';
    const { port } = fakePort(() => [
      quizItem("What is the temporary name?", "App Store Connect", 'generated name "Waypoint (164818)"'),
    ]);
    expect(await makeQuizFromUnits(port, [unit(text)], 5)).toEqual([]);
  });

  it("matches evidence across curly quotes, line breaks, case and an ellipsis", async () => {
    const text = "The record is named \u201CWaypoint\u201D\nwhile it is set up, and then it is renamed.";
    const { port } = fakePort(() => [quizItem("What is the name?", "Waypoint", 'named "Waypoint" while it is set up\u2026 renamed')]);
    expect(await makeQuizFromUnits(port, [unit(text)], 5)).toHaveLength(1);
  });

  it("drops a question whose answer or evidence is only punctuation", async () => {
    const { port } = fakePort(() => [quizItem("Q?", "?", "?")]);
    expect(await makeQuizFromUnits(port, [unit("What? Why?")], 5)).toEqual([]);
  });
});

describe("quiz grounding on real wording", () => {
  it("keeps a question whose evidence shortens the page's sentence, in the same order", async () => {
    const { port } = fakePort(() => [quizItem("What splits?", "Mitosis", "Mitosis splits a cell into two")]);
    const quiz = await makeQuizFromUnits(port, [unit("Mitosis splits one cell into two identical cells during growth.")], 5);
    expect(quiz.map((q) => q.question)).toEqual(["What splits?"]);
  });

  it.each([
    ["a sentence wrapped before a word and colon", "The heart pumps blood to the\nbody: it has four chambers.", "The heart pumps blood to the body", "blood"],
    ["a decimal at the start of a wrapped line", "The distance is about\n3.5 million miles from here.", "The distance is about 3.5 million miles", "3.5 million miles"],
    ["a title abbreviation", "Mr. Smith was born in Ohio.", "Mr. Smith was born in Ohio", "Ohio"],
    ["e.g. inside a sentence", "Mammals, e.g. dogs and cats, have fur.", "Mammals, e.g. dogs and cats, have fur", "fur"],
    ["a word hyphenated across lines", "Plants make food by photo-\nsynthesis in leaves.", "Plants make food by photosynthesis", "photosynthesis"],
  ])("keeps a correct question on %s", async (_name, page, evidence, answer) => {
    const { port } = fakePort(() => [quizItem("Question?", answer, evidence)]);
    expect(await makeQuizFromUnits(port, [unit(page)], 5)).toHaveLength(1);
  });

  it("does not match 3 inside 3.5", async () => {
    const { port } = fakePort(() => [quizItem("How far?", "3", "about 3 miles")]);
    expect(await makeQuizFromUnits(port, [unit("It is about 3.5 miles away.")], 5)).toEqual([]);
  });

  it("keeps list entries apart after a heading, even when one wraps", async () => {
    const page = "Vocabulary\ncoefficient: the number\nmultiplied by a variable\nconstant: a number with no variable";
    const { port } = fakePort(() => [quizItem("What is a coefficient?", "a number with no variable", "coefficient: a number with no variable")]);
    expect(await makeQuizFromUnits(port, [unit(page)], 5)).toEqual([]);
  });

  it("drops a quote stitched from two sentences into a false fact", async () => {
    const { port } = fakePort(() => [quizItem("Where was Washington born?", "Kentucky", "Washington was born in Kentucky")]);
    expect(await makeQuizFromUnits(port, [unit("Lincoln was born in Kentucky. Washington was born in Virginia.")], 5)).toEqual([]);
  });

  it("drops a quote that swaps two facts inside one sentence", async () => {
    const { port } = fakePort(() => [quizItem("What do plants absorb?", "oxygen", "Plants absorb oxygen and release water")]);
    expect(await makeQuizFromUnits(port, [unit("Plants absorb water and release oxygen through their leaves.")], 5)).toEqual([]);
  });

  it("drops a quote mixing two entries of a list", async () => {
    const page = "coefficient: the number multiplied by a variable\nconstant: a number with no variable";
    const { port } = fakePort(() => [quizItem("What is a coefficient?", "a number with no variable", "coefficient: a number with no variable")]);
    expect(await makeQuizFromUnits(port, [unit(page)], 5)).toEqual([]);
  });

  it("drops an answer the page negates", async () => {
    const { port } = fakePort(() => [quizItem("Where do plants get food?", "soil", "Plants do not make food from soil")]);
    expect(await makeQuizFromUnits(port, [unit("Plants do not make food from soil. They use sunlight to make food.")], 5)).toEqual([]);
  });

  it("drops a quote that leaves out the page's not", async () => {
    const { port } = fakePort(() => [quizItem("Where do plants get food?", "soil", "Plants make food from soil")]);
    expect(await makeQuizFromUnits(port, [unit("Plants do not make food from soil. They use sunlight to make food.")], 5)).toEqual([]);
  });

  it("keeps a negative question about a negative fact", async () => {
    const { port } = fakePort(() => [quizItem("Which colony did not send delegates?", "Georgia", "Georgia did not send delegates")]);
    expect(await makeQuizFromUnits(port, [unit("Twelve colonies met in 1774. Georgia did not send delegates.")], 5)).toHaveLength(1);
  });

  it("drops a date the page never writes that way", async () => {
    const { port } = fakePort(() => [quizItem("When?", "June 1775", "in June 1776 and again in 1775")]);
    expect(await makeQuizFromUnits(port, [unit("It met in June 1776 and again in 1775.")], 5)).toEqual([]);
  });

  it("drops a question with a wrong choice that is the answer in another form", async () => {
    const item = { question: "Who protested?", evidence: "The colonists protested taxes", answer: "colonists", wrongChoices: ["colonist", "kings", "soldiers"], why: "Because." };
    const { port } = fakePort(() => [item]);
    expect(await makeQuizFromUnits(port, [unit("The colonists protested taxes.")], 5)).toEqual([]);
  });

  it("drops a question whose answer is not on the page", async () => {
    const { port } = fakePort(() => [quizItem("Which city?", "Paris", "Mitosis splits one cell")]);
    expect(await makeQuizFromUnits(port, [unit("Mitosis splits one cell into two.")], 5)).toEqual([]);
  });

  it("drops a question whose number in the answer is not in the quote", async () => {
    const { port } = fakePort(() => [quizItem("When did the war end?", "1783", "The war began in 1775")]);
    expect(await makeQuizFromUnits(port, [unit("The war began in 1775 and ended in 1783.")], 5)).toEqual([]);
  });

  it("drops a question when a wrong choice appears in the quote", async () => {
    const { port } = fakePort(() => [{ ...quizItem("What splits?", "Mitosis", "Mitosis splits one cell"), wrongChoices: ["one cell", "x2", "x3"] }]);
    expect(await makeQuizFromUnits(port, [unit("Mitosis splits one cell into two.")], 5)).toEqual([]);
  });

  it("keeps a wrong choice that the answer also quotes", async () => {
    const { port } = fakePort(() => [{ ...quizItem("What is it?", "Mitosis cell", "Mitosis cell splits"), wrongChoices: ["Mitosis", "x2", "x3"] }]);
    expect(await makeQuizFromUnits(port, [unit("Mitosis cell splits in two.")], 5)).toHaveLength(1);
  });

  it("stops at the count and tries pieces in even-then-odd order", async () => {
    const pages = ["rivers", "mountains", "forests", "deserts", "oceans", "islands", "valleys", "plains"];
    const units = pages.map((word, index) => unit(`Page ${index} covers ${word} in detail today.`));
    const { port, calls } = fakePort((call, index) => {
      const page = pages.findIndex((word) => call.text.includes(`covers ${word}`));
      return [quizItem(`What does page ${page} cover (a)?`, pages[page] ?? "", `covers ${pages[page]}`), quizItem(`What does page ${page} cover (b)?`, pages[page] ?? "", `covers ${pages[page]}`)];
    });
    const quiz = await makeQuizFromUnits(port, units, 5);
    expect(quiz).toHaveLength(5);
    expect(calls.map((c) => c.text.match(/Page (\d)/)?.[1])).toEqual(["0", "2", "4"]);
  });

  it("goes on to odd pages when the even pages give no grounded question", async () => {
    const pages = ["rivers", "mountains", "forests", "deserts", "oceans", "islands", "valleys", "plains"];
    const units = pages.map((word, index) => unit(`Page ${index} covers ${word} in detail today.`));
    const { port, calls } = fakePort((call) => {
      const page = pages.findIndex((word) => call.text.includes(`covers ${word}`));
      return page % 2 === 0 ? [quizItem("Wrong?", "Paris", "covers Paris")] : [quizItem(`What does page ${page} cover?`, pages[page] ?? "", `covers ${pages[page]}`)];
    });
    const quiz = await makeQuizFromUnits(port, units, 5);
    expect(quiz).toHaveLength(4);
    expect(calls.map((c) => c.text.match(/Page (\d)/)?.[1])).toEqual(["0", "2", "4", "6", "1", "3", "5", "7"]);
  });

  it("keeps the questions from other pieces when one piece is declined", async () => {
    const { port } = fakePort(
      (call) => {
        const word = ["rivers", "mountains", "forests"].find((w) => call.text.includes(w)) ?? "";
        return [quizItem(`What does ${word} cover?`, word, `covers ${word}`)];
      },
      { fail: (_call, index) => (index === 1 ? { code: "declined" } : undefined) },
    );
    const units = [unit("Page covers rivers in detail today."), unit("Page covers mountains in detail today."), unit("Page covers forests in detail today.")];
    const quiz = await makeQuizFromUnits(port, units, 5);
    expect(quiz.map((q) => q.question)).toEqual(["What does forests cover?", "What does mountains cover?"]);
  });

  it("rethrows the first error when every piece fails", async () => {
    const { port, calls } = fakePort(() => [], { fail: (_call, index) => ({ code: `e${index}` }) });
    await expect(makeQuizFromUnits(port, [unit("Page covers rivers in detail."), unit("Page covers mountains in detail.")], 5)).rejects.toMatchObject({ code: "e1" });
    expect(calls).toHaveLength(2);
  });

  it("rethrows unsupported_language at once", async () => {
    const { port, calls } = fakePort(() => [], { fail: () => ({ code: "unsupported_language" }) });
    await expect(makeQuizFromUnits(port, [unit("Page covers rivers in detail."), unit("Page covers mountains in detail.")], 5)).rejects.toMatchObject({
      code: "unsupported_language",
    });
    expect(calls).toHaveLength(1);
  });
});

describe("card groups that fail", () => {
  it("skips a failed group and keeps the cards from the rest", async () => {
    const { port } = fakePort(
      (call) => [term(call.text.startsWith("a") ? "First" : "Kept")],
      { contextSize: 2000, fail: (_call, index) => (index === 1 ? { code: "declined" } : undefined) },
    );
    const cards = await makeCardsFromUnits(port, [unit(big("a ")), unit(big("b "))], 5);
    expect(cards.map((c) => c.front)).toEqual(["Kept"]);
  });

  it("rethrows unsupported_language at once", async () => {
    const { port, calls } = fakePort(() => [], { contextSize: 2000, fail: () => ({ code: "unsupported_language" }) });
    await expect(makeCardsFromUnits(port, [unit(big("a ")), unit(big("b "))], 5)).rejects.toMatchObject({ code: "unsupported_language" });
    expect(calls).toHaveLength(1);
  });
});
