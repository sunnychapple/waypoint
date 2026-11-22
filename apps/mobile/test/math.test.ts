import { describe, expect, it } from "vitest";
import { checkedPlan, helpFor, looksLikeMath, needsMathPlan, solveMath, type MathPort } from "../src/core/study/math.ts";

const answers: [string, string][] = [
  ["7 + 8", "15"],
  ["63 ÷ 9", "7"],
  ["12 × 11", "132"],
  ["3 + 4 × 2", "11"],
  ["(3 + 4) × 2", "14"],
  ["2^5", "32"],
  ["√144", "12"],
  ["-7 + 12", "5"],
  ["-3^2", "-9"],
  ["15% of 80", "12"],
  ["3/4 + 1/2", "5/4 (or 1 1/4)"],
  ["2/3 × 3/5", "2/5"],
  ["5 1/2 - 2 1/4", "13/4 (or 3 1/4)"],
  ["0.25 + 1.5", "1.75"],
  ["3.2 × 5", "16"],
  ["0.1 + 0.2", "0.3"],
  ["1,000 - 1", "999"],
  ["What is 6 × 7?", "42"],
  ["1) 8 - 3 =", "5"],
  ["Solve for x: 3x + 7 = 22.", "x = 5"],
  ["2x + 3 = 11", "x = 4"],
  ["4y - 7 = 9", "y = 4"],
  ["6 + 2n = 18", "n = 6"],
  ["5k - 10 = 15", "k = 5"],
  ["x/3 + 2 = 6", "x = 12"],
  ["9 = 2a - 1", "a = 5"],
  ["3(x + 2) = 21", "x = 5"],
  ["5x + 2 = 3x + 10", "x = 4"],
  ["x/4 = 7", "x = 28"],
  ["2x + 1 = 2x + 1", "Every number works"],
  ["2x + 1 = 2x + 3", "No solution"],
  ["x^2 - 5x + 6 = 0", "x = 2 or x = 3"],
  ["x^2 = 49", "x = -7 or x = 7"],
  ["x^2 + 1 = 0", "No real solution"],
];

const wordProblem = "30 players each ran 4 miles a day for 5 days. How many miles did each player run?";

describe("solveMath answers", () => {
  it.each(answers)("%s", (problem, answer) => {
    expect(solveMath(problem)?.answer).toBe(answer);
  });

  it("returns null for word problems, scripture, bad values, and bare numbers", () => {
    expect(solveMath(wordProblem)).toBeNull();
    expect(solveMath("John 3:16")).toBeNull();
    expect(solveMath("Psalm 23")).toBeNull();
    expect(solveMath("1/0")).toBeNull();
    expect(solveMath("√2")).toBeNull();
    expect(solveMath("x + y = 3")).toBeNull();
    expect(solveMath("42")).toBeNull();
  });

  it("never shows the wrong intermediate value for 3 + 4 × 2", () => {
    const draft = solveMath("3 + 4 × 2");
    expect(draft?.steps.map((s) => s.detail)).toEqual(["4 × 2 = 8 Now it is 3 + 8.", "3 + 8 = 11"]);
    expect(draft?.steps.map((s) => s.title)).toEqual(["Multiply", "Add"]);
  });

  it("keeps at most 8 steps, with a Finish step after 6 operations", () => {
    const draft = solveMath("1 + 2 + 3 + 4 + 5 + 6 + 7 + 8");
    expect(draft?.steps.length).toBe(6);
    expect(draft?.steps[5]).toEqual({ title: "Finish", detail: "Keep going the same way until one number is left." });
    expect(draft?.answer).toBe("36");
    for (const [problem] of answers) {
      expect(solveMath(problem)?.steps.length ?? 0).toBeLessThanOrEqual(8);
    }
  });

  it("gives every equation at least one step and a Simplify step for 0 = 0 and 0 = 5 cases", () => {
    const every = solveMath("2x + 1 = 2x + 1");
    const none = solveMath("2x + 1 = 2x + 3");
    expect(every?.steps.filter((s) => s.title === "Simplify")).toHaveLength(1);
    expect(none?.steps.filter((s) => s.title === "Simplify")).toHaveLength(1);
  });
});

describe("needsMathPlan and looksLikeMath", () => {
  it("is true for word problems with a number and a math cue", () => {
    expect(needsMathPlan(wordProblem)).toBe(true);
    expect(needsMathPlan("A $60 coat is 10% off. What is the sale price?")).toBe(true);
    expect(needsMathPlan("A number times 3 plus 4 is 19. What is the number?")).toBe(true);
  });

  it("is false for a Bible question with a number", () => {
    expect(needsMathPlan("How many stones did David pick in 1 Samuel 17?")).toBe(false);
    expect(looksLikeMath("How many stones did David pick in 1 Samuel 17?")).toBe(false);
  });

  it("looks like math for an equation or a variable term", () => {
    expect(looksLikeMath("2x + 3 = 11")).toBe(true);
  });
});

describe("checkedPlan", () => {
  const problem = "3 cups for 2 loaves, how many for 8 loaves";
  const plan = (expression: string, unit = "cups") => ({ expression, unit });

  it("accepts three agreeing plans", () => {
    const draft = checkedPlan(problem, [plan("3 / 2 * 8"), plan("3 * 8 / 2"), plan("(3 * 8) / 2")]);
    expect(draft?.answer).toBe("12 cups");
    expect(draft?.steps[0]).toEqual({ title: "Write the math", detail: "3 ÷ 2 × 8" });
  });

  it("rejects plans that disagree", () => {
    expect(checkedPlan(problem, [plan("3 / 2 * 8"), plan("3 * 8 / 2"), plan("3 * 8 / 4")])).toBeNull();
  });

  it("rejects a number that is not in the problem", () => {
    expect(checkedPlan(problem, [plan("(3 * 4) / 2"), plan("(3 * 4) / 2"), plan("(3 * 4) / 2")])).toBeNull();
  });

  it("rejects a problem number that the expression leaves out", () => {
    expect(checkedPlan(problem, [plan("3 * 2"), plan("3 * 2"), plan("3 * 2")])).toBeNull();
  });

  it("rejects a negative answer to how many", () => {
    expect(checkedPlan("How many are left from 3 and 8?", [plan("3 - 8"), plan("3 - 8"), plan("3 - 8")])).toBeNull();
  });

  it("rejects a fractional answer to how many", () => {
    expect(checkedPlan(problem, [plan("3 / 8 * 2"), plan("3 / 8 * 2"), plan("3 / 8 * 2")])).toBeNull();
  });
});

describe("helpFor", () => {
  const context = "";
  function port(overrides: Partial<MathPort> = {}): MathPort & { planCalls: number; helpCalls: number } {
    const fake = {
      planCalls: 0,
      helpCalls: 0,
      planMath: async (_problem: string) => {
        fake.planCalls++;
        return { expression: "2 * 3", unit: "" };
      },
      helpWithProblem: async (_problem: string, _context: string) => {
        fake.helpCalls++;
        return { steps: [{ title: "Recall", detail: "Look at the Bible text." }], answer: "Ruth" };
      },
      ...overrides,
    };
    return fake;
  }

  it("makes no model call for 2x + 3 = 11", async () => {
    const fake = port();
    const result = await helpFor(fake, { text: "2x + 3 = 11", context });
    expect(result?.draft.answer).toBe("x = 4");
    expect(result?.answerChecked).toBe(true);
    expect(fake.planCalls).toBe(0);
    expect(fake.helpCalls).toBe(0);
  });

  it("marks unchecked math false when the plans disagree", async () => {
    const answersByCall = ["2 * 3", "2 * 4", "2 * 5"];
    let calls = 0;
    const fake = port({
      planMath: async () => ({ expression: answersByCall[calls++] ?? "", unit: "" }),
    });
    const result = await helpFor(fake, { text: wordProblem, context });
    expect(calls).toBe(3);
    expect(result?.answerChecked).toBe(false);
  });

  it("marks a Bible question checked with the model's answer", async () => {
    const result = await helpFor(port(), { text: "How many stones did David pick in 1 Samuel 17?", context });
    expect(result?.draft.answer).toBe("Ruth");
    expect(result?.answerChecked).toBe(true);
  });

  it("rethrows unsupported_language from the planner", async () => {
    const error = Object.assign(new Error("no"), { code: "unsupported_language" });
    const fake = port({ planMath: async () => Promise.reject(error) });
    await expect(helpFor(fake, { text: wordProblem, context })).rejects.toBe(error);
  });
});

describe("math review cases", () => {
  it.each([
    ["1/2 ÷ 1/4", "2"],
    ["2 ÷ 1/2 + 1", "5"],
    ["3/4 ÷ 3/4 * 2", "2"],
    ["5 1/2 ÷ 1/2 + 1", "12"],
    ["x ÷ 1/2 = 4", "x = 2"],
    ["3 x 4", "12"],
    ["3. 2x + 1 = 7", "x = 3"],
    ["(2) 3 + 4", "10"],
    ["12-5", "7"],
    ["1.5x = 3", "x = 2"],
  ])("solves %s", (problem, answer) => {
    expect(solveMath(problem)?.answer).toBe(answer);
  });

  it.each(["11/22/2026", "1/2/2026", "12-25", "12-25-2026", "555-123-4567", "555-1234", "3-5", "pp. 3-5", "v. 3-5", "Ch. 3-5", "No. 5 + 3", "10 % 3", "0^0", "3 x 4 = 12"])(
    "does not solve %s",
    (problem) => {
      expect(solveMath(problem)).toBeNull();
    },
  );

  it.each([
    ["10 ÷ 5 / 2", "1"],
    ["12 ÷ 3 / 2", "2"],
    ["3 x (4 + 1)", "15"],
  ])("works %s left to right", (problem, answer) => {
    expect(solveMath(problem)?.answer).toBe(answer);
  });

  it.each(["1-800-555-1234", "(555) 123-4567"])("does not solve the phone number %s", (problem) => {
    expect(solveMath(problem)).toBeNull();
  });

  it("solves for x when x is next to parentheses", () => {
    expect(solveMath("2 x (x+1) = 6")).toBeNull();
  });

  it.each(["Tim 4, Sam 3. How many in total?", "There are 7 kids: Mark 5, Sam 2. How many boys?"])("treats the names in %s as people", (problem) => {
    expect(needsMathPlan(problem)).toBe(true);
    expect(looksLikeMath(problem)).toBe(true);
  });

  it.each(["Read Psalm 23.", "What does 1 John 4:8 say?", "In Acts 2, how many were baptized?", "Read Mark 5.", "John 3 says what?", "How many stones in 1 Samuel 17?"])(
    "treats %s as a reference",
    (problem) => {
      expect(looksLikeMath(problem)).toBe(false);
    },
  );

  it("removes a stated result from an unchecked step", async () => {
    const port: MathPort = {
      planMath: async () => ({ expression: "1", unit: "" }),
      helpWithProblem: async () => ({ steps: [{ title: "Work", detail: "Subtract 5 from 12 to get 7. The total is 7." }], answer: "7" }),
    };
    expect((await helpFor(port, { text: "What is 15 divided by 3?", context: "" }))?.draft.steps[0]?.detail).toBe("Try this part yourself.");
  });

  it("shows the minus sign as its own last step", () => {
    const draft = solveMath("-2^2");
    expect(draft?.answer).toBe("-4");
    expect(draft?.steps.at(-1)?.title).toBe("Make it negative");
  });

  it("puts parentheses around a fraction or negative base", () => {
    expect(solveMath("(1/2)^2 + 1")?.steps.map((s) => s.detail).join(" ")).not.toContain("1/2^2 + 1");
    expect(solveMath("(-3)^2 + (-2)^2")?.steps[0]?.detail).toContain("(−2)^2");
  });

  it("keeps a sentence's number that only looks like a scripture reference", () => {
    const problem = "Buy 3 shirts at $15 each and 2 hats at $8 each. How much in total?";
    const plan = (expression: string) => ({ expression, unit: "" });
    expect(checkedPlan(problem, [plan("15*2+8*2"), plan("15*2+8*2"), plan("15*2+8*2")])).toBeNull();
    expect(checkedPlan(problem, [plan("3*15+2*8"), plan("3*15+2*8"), plan("3*15+2*8")])?.answer).toBe("61");
  });

  it("does not treat a person's name and a number as scripture", () => {
    expect(looksLikeMath("Mark 5 papers and then 3 more.")).toBe(true);
    expect(looksLikeMath("What does John 3:16 say?")).toBe(false);
    expect(looksLikeMath("What does verse 3 say?")).toBe(false);
  });

  it("hides a model's unchecked answer and worked-out results for math without a cue", async () => {
    const port: MathPort = {
      planMath: async () => ({ expression: "1", unit: "" }),
      helpWithProblem: async () => ({ steps: [{ title: "Divide", detail: "Divide the numbers. 15 ÷ 3 = 7." }], answer: "7" }),
    };
    const help = await helpFor(port, { text: "What is 15 divided by 3?", context: "" });
    expect(help?.answerChecked).toBe(false);
    expect(help?.draft.steps[0]?.detail).toBe("Divide the numbers.");
  });

  it("needs the same unit from all three plans", () => {
    const problem = "A train travels 60 miles per hour for 3 hours. How far does it go?";
    const draft = checkedPlan(problem, [{ expression: "60*3", unit: "miles" }, { expression: "60*3", unit: "hours" }, { expression: "60*3", unit: "miles" }]);
    expect(draft?.answer).toBe("180");
  });
});
