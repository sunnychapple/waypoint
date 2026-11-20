import { PRICE_TABLE_2026_11_16_2 } from "@waypoint/pricing";
import { DEFAULT_ROUTES, type RouteTable, type RouterAnswers } from "@waypoint/router";
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

const GOOD: RouterAnswers = {
  difficulty: { value: 1, p: 0.9 },
  needs_web: { value: false, p: 0.9 },
  subject: { value: "science", p: 0.8 },
  unsafe: { value: false, p: 0.99 },
};

function chatReply(content: string): unknown {
  return { choices: [{ message: { content } }] };
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
  test("returns the answers from a chat reply and calls the router model through the gateway", async () => {
    const { ai, calls } = fakeAi(async () => chatReply(JSON.stringify(GOOD)));
    const result = await askRouter(ai, "gw", "@cf/example/clef-flash", INPUT);
    expect(result).toEqual(GOOD);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("@cf/example/clef-flash");
    expect(calls[0]?.options.gateway).toEqual({ id: "gw", collectLog: false, skipCache: true });
    expect(calls[0]?.options.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.inputs.temperature).toBe(0);
    expect(JSON.stringify(calls[0]?.inputs.messages)).toContain("SECRET-TRANSCRIPT");
  });

  test("returns the answers from a { response } reply", async () => {
    const { ai } = fakeAi(async () => ({ response: GOOD }));
    expect(await askRouter(ai, "gw", "m", INPUT)).toEqual(GOOD);
  });

  test("returns the answers when the JSON is wrapped in a code fence", async () => {
    const { ai } = fakeAi(async () => chatReply("```json\n" + JSON.stringify(GOOD) + "\n```"));
    expect(await askRouter(ai, "gw", "m", INPUT)).toEqual(GOOD);
  });

  test("returns null when the call throws", async () => {
    const { ai } = fakeAi(async () => {
      throw new Error("boom");
    });
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when the content is not JSON", async () => {
    const { ai } = fakeAi(async () => chatReply("not json"));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when the JSON is missing answers", async () => {
    const { ai } = fakeAi(async () => chatReply('{"difficulty": 3}'));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when the JSON has an extra key", async () => {
    const { ai } = fakeAi(async () => chatReply(JSON.stringify({ ...GOOD, extra: 1 })));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when difficulty is 6", async () => {
    const { ai } = fakeAi(async () => chatReply(JSON.stringify({ ...GOOD, difficulty: { value: 6, p: 0.9 } })));
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when the reply is a ReadableStream", async () => {
    const { ai } = fakeAi(async () => new ReadableStream());
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });

  test("returns null when the reply is a string", async () => {
    const { ai } = fakeAi(async () => "text");
    expect(await askRouter(ai, "gw", "m", INPUT)).toBeNull();
  });
});

describe("routeTask", () => {
  test("a good answer routes to the light tier with the light model", async () => {
    const { ai, calls } = fakeAi(async () => chatReply(JSON.stringify(GOOD)));
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.router).toBe("ok");
    expect(result.decision).toMatchObject({ ok: true, tier: "light", model: DEFAULT_ROUTES.tiers.light[0]?.model });
    expect(calls[0]?.model).toBe("@cf/example/clef-flash");
    expect(calls[0]?.options.gateway).toEqual(gatewayOptions("gw"));
    expect(calls[0]?.options.signal).toBeInstanceOf(AbortSignal);
  });

  test("difficulty 3 routes to the standard tier", async () => {
    const { ai } = fakeAi(async () => chatReply(JSON.stringify({ ...GOOD, difficulty: { value: 3, p: 0.9 } })));
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.decision).toMatchObject({ ok: true, tier: "standard" });
  });

  test("difficulty 2 with p 0.5 and min_confidence 0.4 routes to the light tier", async () => {
    const { ai } = fakeAi(async () => chatReply(JSON.stringify({ ...GOOD, difficulty: { value: 2, p: 0.5 } })));
    const config = makeConfig({ min_confidence: 0.4 });
    const result = await routeTask({ ai, gatewayId: "gw", config, zeroRetention: false, input: INPUT });
    expect(result.decision).toMatchObject({ ok: true, tier: "light" });
  });

  test("difficulty 2 with p 0.5 and min_confidence 0.6 routes to the strong tier", async () => {
    const { ai } = fakeAi(async () => chatReply(JSON.stringify({ ...GOOD, difficulty: { value: 2, p: 0.5 } })));
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.decision).toMatchObject({ ok: true, tier: "strong" });
  });

  test("needs_web with p 0.9 offers research", async () => {
    const { ai } = fakeAi(async () =>
      chatReply(JSON.stringify({ ...GOOD, needs_web: { value: true, p: 0.9 } })),
    );
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: false, input: INPUT });
    expect(result.decision).toMatchObject({ ok: true, offerResearch: true });
  });

  test("double_check makes no AI call and routes to the strong tier", async () => {
    const { ai, calls } = fakeAi(async () => chatReply(JSON.stringify(GOOD)));
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
    const { ai, calls } = fakeAi(async () => chatReply(JSON.stringify(GOOD)));
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

  test("zero retention with DEFAULT_ROUTES makes no AI call and has no zero-retention route", async () => {
    const { ai, calls } = fakeAi(async () => chatReply(JSON.stringify(GOOD)));
    const result = await routeTask({ ai, gatewayId: "gw", config: makeConfig(), zeroRetention: true, input: INPUT });
    expect(calls).toHaveLength(0);
    expect(result).toEqual({
      router: "skipped",
      decision: { ok: false, reason: "no_zero_retention_route" },
    });
  });

  test("zero retention with a zero-retention strong route makes no AI call and uses that route", async () => {
    const { ai, calls } = fakeAi(async () => chatReply(JSON.stringify(GOOD)));
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
