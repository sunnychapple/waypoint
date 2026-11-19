import { describe, expect, test } from "vitest";
import {
  DEFAULT_ROUTES,
  RouterAnswersSchema,
  chooseTier,
  decideRoute,
  type RouteTable,
  type RouterAnswers,
} from "../src/index.ts";

function answers(
  difficulty: number,
  difficultyP = 0.9,
  overrides: { needsWeb?: [boolean, number]; unsafe?: [boolean, number] } = {},
): RouterAnswers {
  const [needsWebValue, needsWebP] = overrides.needsWeb ?? [false, 0.9];
  const [unsafeValue, unsafeP] = overrides.unsafe ?? [false, 0.9];
  return RouterAnswersSchema.parse({
    difficulty: { value: difficulty, p: difficultyP },
    needs_web: { value: needsWebValue, p: needsWebP },
    subject: { value: "science", p: 0.9 },
    unsafe: { value: unsafeValue, p: unsafeP },
  });
}

const zeroRoutes: RouteTable = {
  version: "test",
  tiers: {
    light: [
      { model: "light-standard", retention: "standard" },
      { model: "light-zero", retention: "zero" },
    ],
    standard: [{ model: "standard-standard", retention: "standard" }],
    strong: [{ model: "strong-zero", retention: "zero" }],
  },
  fixed: {},
};

const noZeroRoutes: RouteTable = {
  ...DEFAULT_ROUTES,
  version: "test",
  fixed: {},
};

describe("chooseTier", () => {
  test.each([
    [1, "light"],
    [2, "light"],
    [3, "standard"],
    [4, "standard"],
    [5, "strong"],
  ] as const)("difficulty %i goes to %s", (difficulty, tier) => {
    expect(chooseTier(answers(difficulty))).toBe(tier);
  });

  test("low confidence on difficulty goes strong", () => {
    expect(chooseTier(answers(1, 0.5))).toBe("strong");
    expect(chooseTier(answers(3, 0.59))).toBe("strong");
  });

  test("confidence exactly at the minimum keeps the difficulty band", () => {
    expect(chooseTier(answers(1, 0.6))).toBe("light");
  });
});

describe("decideRoute", () => {
  test("routes by difficulty band with the first entry of the tier", () => {
    const decision = decideRoute({
      task: "explain",
      answers: answers(4),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(decision).toEqual({
      ok: true,
      tier: "standard",
      requested_tier: "standard",
      model: "workers-ai/deepseek-v4.1-flash",
      retention: "standard",
      offerResearch: false,
      unsafe: false,
    });
  });

  test("low confidence goes to the strong model", () => {
    const decision = decideRoute({
      task: "explain",
      answers: answers(1, 0.2),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(decision).toMatchObject({ ok: true, tier: "strong", model: "workers-ai/kimi-k2.6" });
  });

  test("fixed tasks ignore the answers", () => {
    const withAnswers = decideRoute({
      task: "more_detail",
      answers: answers(5),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(withAnswers).toMatchObject({ ok: true, tier: "standard" });

    const withoutAnswers = decideRoute({
      task: "double_check",
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(withoutAnswers).toMatchObject({ ok: true, tier: "strong", model: "workers-ai/kimi-k2.6" });
  });

  test("an unfixed task with no answers needs answers", () => {
    expect(
      decideRoute({ task: "explain", zeroRetention: false, routes: DEFAULT_ROUTES }),
    ).toEqual({ ok: false, reason: "answers_required" });
  });

  test("zero retention with no zero routes fails", () => {
    expect(
      decideRoute({
        task: "explain",
        answers: answers(1),
        zeroRetention: true,
        routes: noZeroRoutes,
      }),
    ).toEqual({ ok: false, reason: "no_zero_retention_route" });
  });

  test("zero retention picks a zero entry from a stronger tier, never a standard one", () => {
    const decision = decideRoute({
      task: "explain",
      answers: answers(3),
      zeroRetention: true,
      routes: zeroRoutes,
    });
    // Changed by the fix round: tier is now the tier of the entry actually used (strong),
    // and requested_tier keeps the tier the router asked for (standard).
    expect(decision).toMatchObject({
      ok: true,
      tier: "strong",
      requested_tier: "standard",
      model: "strong-zero",
      retention: "zero",
    });
  });

  test("zero retention applies to a fixed task too", () => {
    const decision = decideRoute({
      task: "more_detail",
      zeroRetention: true,
      routes: { ...zeroRoutes, fixed: { more_detail: "standard" } },
    });
    expect(decision).toMatchObject({
      ok: true,
      tier: "strong",
      requested_tier: "standard",
      model: "strong-zero",
      retention: "zero",
    });
  });

  test("zero retention never uses a standard entry or a weaker tier's zero entry", () => {
    const routes: RouteTable = {
      ...zeroRoutes,
      tiers: {
        light: [{ model: "light-zero", retention: "zero" }],
        standard: [{ model: "standard-standard", retention: "standard" }],
        strong: [{ model: "strong-standard", retention: "standard" }],
      },
    };
    expect(
      decideRoute({ task: "explain", answers: answers(3), zeroRetention: true, routes }),
    ).toEqual({ ok: false, reason: "no_zero_retention_route" });
  });

  test("unsafe at exactly the minimum confidence is reported", () => {
    const decision = decideRoute({
      task: "explain",
      answers: answers(2, 0.9, { unsafe: [true, 0.6] }),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(decision).toMatchObject({ ok: true, unsafe: true });
  });

  test("research is not offered just under the minimum confidence", () => {
    const decision = decideRoute({
      task: "explain",
      answers: answers(2, 0.9, { needsWeb: [true, 0.59] }),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(decision).toMatchObject({ ok: true, offerResearch: false });
  });

  test("a custom minConfidence changes the unsure rule, tier and flags", () => {
    expect(chooseTier(answers(1, 0.7), 0.8)).toBe("strong");
    expect(chooseTier(answers(1, 0.7), 0.5)).toBe("light");

    const decision = decideRoute({
      task: "explain",
      answers: answers(1, 0.7, { needsWeb: [true, 0.7], unsafe: [true, 0.7] }),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
      minConfidence: 0.8,
    });
    expect(decision).toMatchObject({
      ok: true,
      tier: "strong",
      requested_tier: "strong",
      offerResearch: false,
      unsafe: false,
    });
  });

  test.each([NaN, Infinity, 0, -0.1, 1.5])("minConfidence %s is rejected", (minConfidence) => {
    expect(() => chooseTier(answers(2), minConfidence)).toThrow(RangeError);
    expect(() =>
      decideRoute({
        task: "more_detail",
        zeroRetention: false,
        routes: DEFAULT_ROUTES,
        minConfidence,
      }),
    ).toThrow(RangeError);
    expect(() =>
      decideRoute({
        task: "explain",
        answers: answers(2),
        zeroRetention: false,
        routes: DEFAULT_ROUTES,
        minConfidence,
      }),
    ).toThrow(RangeError);
  });

  test("optional answers and minConfidence typed as possibly undefined are accepted", () => {
    const maybe: RouterAnswers | undefined = undefined;
    const decision = decideRoute({
      task: "diagram",
      answers: maybe,
      minConfidence: undefined,
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(decision).toMatchObject({ ok: true, tier: "strong" });
  });

  test.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "%s is not a fixed task",
    (task) => {
      expect(
        decideRoute({ task, answers: answers(2), zeroRetention: false, routes: DEFAULT_ROUTES }),
      ).toMatchObject({ ok: true, tier: "light", requested_tier: "light" });
      expect(decideRoute({ task, zeroRetention: false, routes: DEFAULT_ROUTES })).toEqual({
        ok: false,
        reason: "answers_required",
      });
    },
  );

  test("__proto__ as a task with zero retention uses the routed tier, not an inherited value", () => {
    expect(
      decideRoute({
        task: "__proto__",
        answers: answers(2),
        zeroRetention: true,
        routes: zeroRoutes,
      }),
    ).toMatchObject({ ok: true, tier: "light", requested_tier: "light", model: "light-zero" });
  });

  test("zero retention prefers a zero entry in the same tier", () => {
    const decision = decideRoute({
      task: "explain",
      answers: answers(1),
      zeroRetention: true,
      routes: zeroRoutes,
    });
    expect(decision).toMatchObject({ ok: true, tier: "light", model: "light-zero", retention: "zero" });
  });

  test("offers research when needs_web is confident", () => {
    const decision = decideRoute({
      task: "explain",
      answers: answers(2, 0.9, { needsWeb: [true, 0.6] }),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(decision).toMatchObject({ ok: true, offerResearch: true });
  });

  test("does not offer research when needs_web is unsure, or without answers", () => {
    const unsure = decideRoute({
      task: "explain",
      answers: answers(2, 0.9, { needsWeb: [true, 0.4] }),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(unsure).toMatchObject({ ok: true, offerResearch: false });

    const fixed = decideRoute({ task: "diagram", zeroRetention: false, routes: DEFAULT_ROUTES });
    expect(fixed).toMatchObject({ ok: true, offerResearch: false, unsafe: false });
  });

  test("reports unsafe without changing the route", () => {
    const plain = decideRoute({
      task: "explain",
      answers: answers(2),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    const flagged = decideRoute({
      task: "explain",
      answers: answers(2, 0.9, { unsafe: [true, 0.95] }),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(flagged).toMatchObject({ ok: true, unsafe: true, tier: "light" });
    expect(plain).toMatchObject({ ok: true, unsafe: false, tier: "light" });
    expect(flagged).toMatchObject({ model: "workers-ai/glm-4.7-flash" });
  });

  test("unsafe below the minimum confidence is not reported", () => {
    const decision = decideRoute({
      task: "explain",
      answers: answers(2, 0.9, { unsafe: [true, 0.5] }),
      zeroRetention: false,
      routes: DEFAULT_ROUTES,
    });
    expect(decision).toMatchObject({ ok: true, unsafe: false });
  });
});
