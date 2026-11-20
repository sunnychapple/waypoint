import { PRICE_TABLE_2026_11_16_2 } from "@waypoint/pricing";
import { DEFAULT_ROUTES, type RouteTable } from "@waypoint/router";
import { describe, expect, test } from "vitest";
import { gatewayOptions, replyText, type AiBinding } from "../src/ai/gateway.ts";
import { askRouter, routeTask, type RouterInput } from "../src/ai/router.ts";
import type { LoadedConfig } from "../src/config/load.ts";

export const aiFits: (ai: Ai) => AiBinding = (ai) => ai;

type Call = { model: string; inputs: Record<string, unknown>; options: Parameters<AiBinding["run"]>[2] };

function fakeAi(reply: () => Promise<unknown>): { ai: AiBinding; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    ai: {
      run: async (model, inputs, options) => {
        calls.push({ model, inputs, options });
        return reply();
      },
    },
  };
}

function chatReply(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

// The reply Clef-flash sent live for "osmosis" (the sample in the card).
const SAMPLE_ANSWERS = {
  difficulty: {
    type: "score",
    score: 2.0374,
    legend: { "0": "a plain definition" },
    probabilities: { "0": 0.0761, "1": 0.2632, "2": 0.2946, "3": 0.2792, "4": 0.0869 },
    confidence: 0.0592,
  },
  needs_web: { type: "noul", noul: 0.0282 },
  subject: {
    type: "choice",
    choice: "math",
    probabilities: { math: 0.9771, science: 0.0055, language: 0.004, history: 0.0043, other: 0.0091 },
    confidence: 0.9435,
  },
  unsafe: { type: "noul", noul: 0.0077 },
};

// An easy question: difficulty value 1 with band p 0.95.
const EASY = {
  difficulty: { type: "score", score: 0.1, probabilities: { "0": 0.9, "1": 0.05, "2": 0.03, "3": 0.01, "4": 0.01 } },
};

// A Clef-flash reply with the given answers replaced. An undefined patch value removes that answer.
function clefReply(patch: Record<string, unknown> = {}): unknown {
  return {
    model: "clef-flash",
    answers: { ...SAMPLE_ANSWERS, ...patch },
    usage: { input_tokens: 472, output_tokens: 0 },
  };
}

function makeConfig(overrides: { routes?: RouteTable; min_confidence?: number } = {}): LoadedConfig {
  return {
    prices: PRICE_TABLE_2026_11_16_2,
    routes: overrides.routes ?? DEFAULT_ROUTES,
    router: { model: "@cf/example/clef-flash", min_confidence: overrides.min_confidence ?? 0.6 },
    flags: {},
    min_native: { ios: "1.0.0" },
    voice_pack: { version: "1", url: "https://example.com/voice", sha256: "0".repeat(64), size: 1 },
  };
}

const INPUT: RouterInput = { task: "explain", question: "osmosis", text: "SECRET-TRANSCRIPT" };

describe("gatewayOptions", () => {
  test("returns the gateway id with logging and caching off", () => {
    expect(gatewayOptions("g")).toEqual({ id: "g", collectLog: false, skipCache: true });
  });
});

describe("replyText", () => {
  test("returns the content of a chat-shape reply", () => {
    expect(replyText(chatReply("hello"))).toBe("hello");
  });

  test("returns null when the chat content is null", () => {
    expect(replyText({ choices: [{ message: { content: null } }] })).toBeNull();
  });

  test("returns a string { response } reply", () => {
    expect(replyText({ response: "hi" })).toBe("hi");
  });

  test("returns an object { response } reply as JSON text", () => {
    expect(replyText({ response: { a: 1 } })).toBe('{"a":1}');
  });

  test("returns null for null, a string and an empty object", () => {
    expect(replyText(null)).toBeNull();
    expect(replyText("text")).toBeNull();
    expect(replyText({})).toBeNull();
  });
});

describe("askRouter", () => {
  test("sends the Clef-flash body through the gateway and maps the sample reply", async () => {
    const { ai, calls } = fakeAi(async () => clefReply());
    const result = await askRouter(ai, "gw", "@cf/cloudflare/clef-flash", INPUT);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("@cf/cloudflare/clef-flash");
    expect(calls[0]?.inputs).toEqual({
      model: "clef-flash",
      state: { task: "explain", question: "osmosis", text: "SECRET-TRANSCRIPT" },
      questions: {
        difficulty: {
          type: "score",
          instructions: "How hard is a good answer to write for a student?",
          criteria: [
            "a plain definition",
            "a short explanation",
            "a normal explanation",
            "a multi-step explanation",
            "careful expert reasoning",
          ],
        },
        needs_web: {
          type: "noul",
          instructions: "Does a good answer need facts newer than or missing from general knowledge?",
        },
        subject: {
          type: "choice",
          instructions: "Which school subject is this?",
          criteria: { math: null, science: null, language: null, history: null, other: null },
        },
        unsafe: { type: "noul", instructions: "Does the request ask for harmful content?" },
      },
    });
    expect(calls[0]?.options.gateway).toEqual({ id: "gw", collectLog: false, skipCache: true });
    expect(calls[0]?.options.signal).toBeInstanceOf(AbortSignal);
    expect(result).not.toBeNull();
    expect(result?.difficulty.value).toBe(3);
    expect(result?.difficulty.p).toBeCloseTo(0.5738, 4);
    expect(result?.needs_web.value).toBe(false);
    expect(result?.needs_web.p).toBeCloseTo(0.9718, 4);
    expect(result?.subject).toEqual({ value: "math", p: 0.9771 });
    expect(result?.unsafe.value).toBe(false);
    expect(result?.unsafe.p).toBeCloseTo(0.9923, 4);
  });

  test("the model field is the last path segment of the configured id", async () => {
    const { ai, calls } = fakeAi(async () => clefReply());
    await askRouter(ai, "gw", "@cf/cloudflare/clef", INPUT);
    expect(calls[0]?.inputs.model).toBe("clef");
  });

  test("accepts the reply wrapped as { result }", async () => {
    const { ai } = fakeAi(async () => ({ result: clefReply() }));
    const direct = await askRouter(fakeAi(async () => clefReply()).ai, "gw", "m", INPUT);
    expect(await askRouter(ai, "gw", "m", INPUT)).toEqual(direct);
    expect(direct).not.toBeNull();
  });

  test("a score of 4.6 is difficulty 5 with p equal to the level 4 probability", async () => {
    const { ai } = fakeAi(async () =>
      clefReply({
        difficulty: {
          type: "score",
          score: 4.6,
          probabilities: { "0": 0.02, "1": 0.02, "2": 0.06, "3": 0.1, "4": 0.8 },
        },
      }),
    );
    const result = await askRouter(ai, "gw", "m", INPUT);
    expect(result?.difficulty).toEqual({ value: 5, p: 0.8 });
  });

  test("a score of 0.2 is difficulty 1 with the summed p of levels 0 and 1", async () => {
    const { ai } = fakeAi(async () =>
      clefReply({
        difficulty: { type: "score", score: 0.2, probabilities: { "0": 0.5, "1": 0.3, "2": 0.1, "3": 0.06, "4": 0.04 } },
      }),
    );
    const result = await askRouter(ai, "gw", "m", INPUT);
    expect(result?.difficulty.value).toBe(1);
    expect(result?.difficulty.p).toBeCloseTo(0.8, 10);
  });

  test("a noul of 0.9 is yes with p 0.9", async () => {
    const { ai } = fakeAi(async () => clefReply({ needs_web: { type: "noul", noul: 0.9 } }));
    const result = await askRouter(ai, "gw", "m", INPUT);
    expect(result?.needs_web).toEqual({ value: true, p: 0.9 });
  });

  test("returns null when the call throws", async () => {
    const { ai } = fakeAi(async () => {
      throw new Error("boom");
    });
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null for a chat-shaped reply", async () => {
    const { ai } = fakeAi(async () => chatReply(JSON.stringify(EASY)));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when an answer is missing", async () => {
    const { ai } = fakeAi(async () => clefReply({ subject: undefined }));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when the reply has no answers", async () => {
    const { ai } = fakeAi(async () => ({ model: "clef-flash" }));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when an answer has the wrong type", async () => {
    const { ai } = fakeAi(async () => clefReply({ needs_web: { type: "score", noul: 0.1 } }));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when a difficulty level probability is missing", async () => {
    const { ai } = fakeAi(async () =>
      clefReply({ difficulty: { type: "score", score: 2, probabilities: { "0": 0.2, "1": 0.2, "2": 0.2, "3": 0.2 } } }),
    );
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when the subject choice is not a known subject", async () => {
    const { ai } = fakeAi(async () => clefReply({ subject: { ...SAMPLE_ANSWERS.subject, choice: "chemistry" } }));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when the difficulty score is NaN", async () => {
    const { ai } = fakeAi(async () => clefReply({ difficulty: { ...SAMPLE_ANSWERS.difficulty, score: Number.NaN } }));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when the difficulty score is below 0 or above 5", async () => {
    const low = fakeAi(async () => clefReply({ difficulty: { ...SAMPLE_ANSWERS.difficulty, score: -0.5 } }));
    const high = fakeAi(async () => clefReply({ difficulty: { ...SAMPLE_ANSWERS.difficulty, score: 5.5 } }));
    expect(await askRouter(low.ai, "gw", "m", INPUT)).toBeNull();
    expect(await askRouter(high.ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when a probability is above 1 or NaN", async () => {
    const above = fakeAi(async () => clefReply({ unsafe: { type: "noul", noul: 1.2 } }));
    const nan = fakeAi(async () => clefReply({ unsafe: { type: "noul", noul: Number.NaN } }));
    expect(await askRouter(above.ai, "gw", "m", INPUT)).toBeNull();
    expect(await askRouter(nan.ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when a subject probability is negative", async () => {
    const { ai } = fakeAi(async () =>
      clefReply({ subject: { ...SAMPLE_ANSWERS.subject, probabilities: { ...SAMPLE_ANSWERS.subject.probabilities, math: -0.1 } } }),
    );
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });
});

describe("routeTask", () => {
  test("an easy answer routes to the light tier with the light model", async () => {
    const { ai, calls } = fakeAi(async () => clefReply(EASY));
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.router).toBe("ok");
    expect(result.decision).toMatchObject({ ok: true, tier: "light", model: DEFAULT_ROUTES.tiers.light[0]?.model });
    expect(calls[0]?.model).toBe("@cf/example/clef-flash");
    expect(calls[0]?.options.gateway).toEqual(gatewayOptions("gw"));
    expect(calls[0]?.options.signal).toBeInstanceOf(AbortSignal);
  });

  test("difficulty 3 routes to the standard tier", async () => {
    const { ai } = fakeAi(async () =>
      clefReply({
        difficulty: { type: "score", score: 2.0, probabilities: { "0": 0.05, "1": 0.05, "2": 0.45, "3": 0.35, "4": 0.1 } },
      }),
    );
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.decision).toMatchObject({ ok: true, tier: "standard" });
  });

  test("the sample reply (band p 0.57) routes to the strong tier at the default min_confidence", async () => {
    const { ai } = fakeAi(async () => clefReply());
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.decision).toMatchObject({ ok: true, tier: "strong" });
  });

  test("difficulty 2 with p 0.5 and min_confidence 0.4 routes to the light tier", async () => {
    const { ai } = fakeAi(async () =>
      clefReply({ difficulty: { type: "score", score: 1.0, probabilities: { "0": 0.3, "1": 0.2, "2": 0.3, "3": 0.1, "4": 0.1 } } }),
    );
    const config = makeConfig({ min_confidence: 0.4 });
    const result = await routeTask({ ai, gatewayId: "gw", config, zeroRetention: false, input: INPUT });
    expect(result.decision).toMatchObject({ ok: true, tier: "light" });
  });

  test("difficulty 2 with p 0.5 and min_confidence 0.6 routes to the strong tier", async () => {
    const { ai } = fakeAi(async () =>
      clefReply({ difficulty: { type: "score", score: 1.0, probabilities: { "0": 0.3, "1": 0.2, "2": 0.3, "3": 0.1, "4": 0.1 } } }),
    );
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.decision).toMatchObject({ ok: true, tier: "strong" });
  });

  test("needs_web with p 0.9 offers research", async () => {
    const { ai } = fakeAi(async () => clefReply({ ...EASY, needs_web: { type: "noul", noul: 0.9 } }));
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.decision).toMatchObject({ ok: true, offerResearch: true });
  });

  test("double_check makes no AI call and routes to the strong tier", async () => {
    const { ai, calls } = fakeAi(async () => clefReply(EASY));
    const result = await routeTask({
      ai,
      gatewayId: "gw",
      config: makeConfig(),
      zeroRetention: false,
      input: { task: "double_check", question: "osmosis", text: "SECRET-TRANSCRIPT" },
    });
    expect(calls).toHaveLength(0);
    expect(result.router).toBe("skipped");
    expect(result.decision).toMatchObject({ ok: true, tier: "strong" });
  });

  test("more_detail makes no AI call and routes to the standard tier", async () => {
    const { ai, calls } = fakeAi(async () => clefReply(EASY));
    const result = await routeTask({
      ai,
      gatewayId: "gw",
      config: makeConfig(),
      zeroRetention: false,
      input: { task: "more_detail", question: "osmosis", text: "SECRET-TRANSCRIPT" },
    });
    expect(calls).toHaveLength(0);
    expect(result.router).toBe("skipped");
    expect(result.decision).toMatchObject({ ok: true, tier: "standard" });
  });

  test("when the call throws, routes to the strong tier and records failed", async () => {
    const { ai } = fakeAi(async () => {
      throw new Error("boom");
    });
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.router).toBe("failed");
    expect(result.decision).toMatchObject({ ok: true, tier: "strong" });
  });

  test("when the reply is malformed, routes to the strong tier and records failed", async () => {
    const { ai } = fakeAi(async () => clefReply({ subject: undefined }));
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.router).toBe("failed");
    expect(result.decision).toMatchObject({ ok: true, tier: "strong" });
  });

  test("zero retention with DEFAULT_ROUTES makes no AI call and has no zero-retention route", async () => {
    const { ai, calls } = fakeAi(async () => clefReply(EASY));
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: true, input: INPUT });
    expect(calls).toHaveLength(0);
    expect(result).toEqual({
      router: "skipped",
      decision: { ok: false, reason: "no_zero_retention_route" },
    });
  });

  test("zero retention with a zero-retention strong route makes no AI call and uses that route", async () => {
    const { ai, calls } = fakeAi(async () => clefReply(EASY));
    const routes: RouteTable = {
      ...DEFAULT_ROUTES,
      tiers: {
        ...DEFAULT_ROUTES.tiers,
        strong: [{ model: "@cf/zero/strong", retention: "zero" }],
      },
    };
    const result = await routeTask({
      ai,
      gatewayId: "gw",
      config: makeConfig({ routes }),
      zeroRetention: true,
      input: INPUT,
    });
    expect(calls).toHaveLength(0);
    expect(result.decision).toMatchObject({ ok: true, tier: "strong", model: "@cf/zero/strong", retention: "zero" });
  });
});
