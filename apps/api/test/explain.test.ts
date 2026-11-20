import {
  ApiErrorSchema,
  InsufficientCreditsErrorSchema,
  StreamDeltaSchema,
  StreamDoneSchema,
  type StreamDone,
} from "@waypoint/contracts";
import { DEFAULT_ROUTES, type RouteTable } from "@waypoint/router";
import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { explainRoute } from "../src/tasks/explain.ts";
import { failingStream, GOOD_ANSWERS, goodStream, makeTaskEnv, readEvents, sse, TASK_NOW } from "./helpers/tasks.ts";

const USER: SessionUser = {
  id: "u1",
  clerk_id: "user_1",
  plan: "free",
  billing_account_id: "ba1",
  zero_retention: false,
};
const KEY = "abcdefghijklmnop";
const MARKER = "SECRET-TRANSCRIPT-7f3a";
const WORD = "osmosis";
const TRANSCRIPT = `the cell takes in water ${MARKER}`;
const BODY = { word: WORD, transcript: TRANSCRIPT };
const HOLD_ID = `explain:u1:${KEY}`;

// A transcript of exactly `length` characters that starts with the marker.
function textOf(length: number): string {
  return (MARKER + "a".repeat(length)).slice(0, length);
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(user: SessionUser = USER) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", explainRoute({ now: () => TASK_NOW }));
  return app;
}

async function post(
  env: object,
  { body = JSON.stringify(BODY), key = KEY }: { body?: string; key?: string | null } = {},
  user?: SessionUser,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== null) headers["Idempotency-Key"] = key;
  return await setup(user).request("/v1/tasks/explain", { method: "POST", headers, body }, env);
}

describe("POST /v1/tasks/explain: the answer", () => {
  test("happy path: 200 event stream, delta, delta, done; the done is 1 credit; the hold settles at 1", async () => {
    const made = makeTaskEnv();
    const res = await post(made.env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const events = await readEvents(res);
    expect(events.map((event) => event.event)).toEqual(["delta", "delta", "done"]);
    const texts = events
      .filter((event) => event.event === "delta")
      .map((event) => StreamDeltaSchema.parse(event.data).text);
    expect(texts.join("")).toBe("Water moves across a membrane.");

    const done: StreamDone = StreamDoneSchema.parse(events[2]?.data);
    expect(done).toEqual({ credits: 1, tier: "light", retention: "standard", offer_research: false });

    expect(made.store.read()).toMatchObject({ monthly: 9, holds: [] });
    expect(made.commands).toEqual([
      {
        type: "hold",
        id: HOLD_ID,
        hold_id: HOLD_ID,
        user_id: "u1",
        task: "explain",
        credits: 1,
        expires_at: TASK_NOW + 60_000 + 60_000,
      },
      { type: "settle", id: `explain_settle:u1:${KEY}`, hold_id: HOLD_ID, actual: 1 },
    ]);
    expect(made.walletNames.length).toBeGreaterThan(0);
    expect(made.walletNames.every((name) => name === "ba1")).toBe(true);
  });

  test("the one usage event has sizes, route and token counts, and no text", async () => {
    const made = makeTaskEnv();
    await readEvents(await post(made.env));
    expect(made.events).toEqual([
      {
        v: 1,
        id: HOLD_ID,
        at: TASK_NOW,
        user_id: "u1",
        task: "explain",
        outcome: "ok",
        credits: 1,
        tier: "light",
        model: "workers-ai/glm-4.7-flash",
        retention: "standard",
        router: "ok",
        bytes_sent: utf8Length(WORD) + utf8Length(TRANSCRIPT),
        tokens_in: 120,
        tokens_out: 9,
      },
    ]);
  });

  test("two AI calls: the router first (no stream), then the answer model streamed with the gateway options", async () => {
    const made = makeTaskEnv();
    await readEvents(await post(made.env));
    expect(made.aiCalls).toHaveLength(2);

    const router = made.aiCalls[0];
    expect(router?.model).toBe("@cf/example/router");
    expect(router?.inputs["stream"]).toBeUndefined();

    const answer = made.aiCalls[1];
    expect(answer?.model).toBe("workers-ai/glm-4.7-flash");
    expect(answer?.inputs).toMatchObject({
      stream: true,
      max_tokens: 500,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(answer?.options.gateway).toEqual({ id: "gw-test", collectLog: false, skipCache: true });
    expect(answer?.options.signal).toBeInstanceOf(AbortSignal);
    const messages = JSON.stringify(answer?.inputs["messages"]);
    expect(messages).toContain(WORD);
    expect(messages).toContain(MARKER);
  });

  test("bytes_sent counts UTF-8 bytes, not characters: the word e-acute adds 2", async () => {
    const made = makeTaskEnv();
    await readEvents(await post(made.env, { body: JSON.stringify({ word: "é", transcript: "a" }) }));
    expect(made.events[0]?.bytes_sent).toBe(3);
  });

  test("the router says needs_web with p 0.9, so done offers research", async () => {
    const made = makeTaskEnv({
      reply: async () => ({ response: JSON.stringify({ ...GOOD_ANSWERS, needs_web: { value: true, p: 0.9 } }) }),
    });
    const events = await readEvents(await post(made.env));
    expect(StreamDoneSchema.parse(events[events.length - 1]?.data).offer_research).toBe(true);
  });
});

describe("POST /v1/tasks/explain: credits", () => {
  test("monthly 0 gives 402 with shortfall 1, and no AI call or usage event", async () => {
    const made = makeTaskEnv({ monthly: 0 });
    const res = await post(made.env);
    expect(res.status).toBe(402);
    const body: unknown = await res.json();
    expect(InsufficientCreditsErrorSchema.parse(body)).toEqual({
      code: "insufficient_credits",
      message: "not enough credits",
      retry_after: null,
      shortfall: 1,
    });
    expect(made.aiCalls).toEqual([]);
    expect(made.events).toEqual([]);
  });

  test("the same key after a finished request gives 409 conflict, with no new AI call and monthly still 9", async () => {
    const made = makeTaskEnv();
    await readEvents(await post(made.env));
    const callsBefore = made.aiCalls.length;

    const res = await post(made.env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "request already finished", retry_after: null });
    expect(made.aiCalls.length).toBe(callsBefore);
    expect(made.store.read()).toMatchObject({ monthly: 9 });
  });

  test("the same key while that hold is still open: 409 request in progress, no model call, nothing charged", async () => {
    const made = makeTaskEnv();
    made.store.apply(
      {
        type: "hold",
        id: HOLD_ID,
        hold_id: HOLD_ID,
        user_id: "u1",
        task: "explain",
        credits: 1,
        expires_at: TASK_NOW + 5,
      },
      TASK_NOW,
    );
    const callsBefore = made.aiCalls.length;
    const res = await post(made.env);
    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect(await res.json()).toEqual({ code: "conflict", message: "request in progress", retry_after: 1 });
    expect(made.aiCalls.length).toBe(callsBefore);
    expect(made.store.read()).toMatchObject({ monthly: 9 });
    expect(made.events).toEqual([]);
  });

  test("two identical requests at once: the model runs once, one streams, the other gets 409; charged once", async () => {
    const made = makeTaskEnv();
    const [first, second] = await Promise.all([post(made.env), post(made.env)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const streamed = first.status === 200 ? first : second;
    const refused = first.status === 200 ? second : first;
    expect((await readEvents(streamed)).map((event) => event.event).at(-1)).toBe("done");
    expect(await refused.json()).toEqual({ code: "conflict", message: "request in progress", retry_after: 1 });
    const answerCalls = made.aiCalls.filter((call) => call.model !== "@cf/example/router");
    expect(answerCalls.length).toBe(1);
    expect(made.store.read()).toMatchObject({ monthly: 9, holds: [] });
  });
});

describe("POST /v1/tasks/explain: model failures", () => {
  test("the model call throws: 500 model unavailable, hold released, monthly 10, one model_failed event with 0 credits", async () => {
    const made = makeTaskEnv({
      stream: async () => {
        throw new Error("model down");
      },
    });
    const res = await post(made.env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "model unavailable", retry_after: null });
    expect(made.commands.map((command) => command.type)).toEqual(["hold", "release"]);
    expect(made.store.read()).toMatchObject({ monthly: 10, holds: [] });
    expect(made.events).toHaveLength(1);
    expect(made.events[0]?.outcome).toBe("model_failed");
    expect(made.events[0]?.credits).toBe(0);
  });

  test("after that failure the same key gives 409 (the hold is closed), and a new key runs", async () => {
    let fail = true;
    const made = makeTaskEnv({
      stream: async () => {
        if (fail) throw new Error("model down");
        return goodStream();
      },
    });
    await post(made.env);
    fail = false;

    const again = await post(made.env);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ code: "conflict", message: "request already finished", retry_after: null });

    const fresh = await post(made.env, { key: "0123456789abcdef" });
    expect(fresh.status).toBe(200);
    const events = await readEvents(fresh);
    expect(events.map((event) => event.event)).toEqual(["delta", "delta", "done"]);
  });

  test("the model returns a plain object instead of a stream: 500 model unavailable, released", async () => {
    const made = makeTaskEnv({ stream: async () => ({ response: "Water" }) });
    const res = await post(made.env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "model unavailable", retry_after: null });
    expect(made.commands.map((command) => command.type)).toEqual(["hold", "release"]);
    expect(made.store.read()).toMatchObject({ monthly: 10, holds: [] });
  });

  test("the stream fails after one chunk: delta then error, error body equals the model failed error, released, model_failed", async () => {
    const made = makeTaskEnv({ stream: async () => failingStream('data: {"response":"Water "}\n\n') });
    const res = await post(made.env);
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(events.map((event) => event.event)).toEqual(["delta", "error"]);
    expect(ApiErrorSchema.parse(events[1]?.data)).toEqual({
      code: "internal",
      message: "model failed",
      retry_after: null,
    });
    expect(made.store.read()).toMatchObject({ monthly: 10, holds: [] });
    expect(made.events[0]?.outcome).toBe("model_failed");
  });

  test("a stream with only data: [DONE] gives an error event only, released", async () => {
    const made = makeTaskEnv({ stream: async () => sse(["data: [DONE]\n\n"]) });
    const events = await readEvents(await post(made.env));
    expect(events.map((event) => event.event)).toEqual(["error"]);
    expect(made.store.read()).toMatchObject({ monthly: 10, holds: [] });
    expect(made.events[0]?.outcome).toBe("model_failed");
  });

  test("a stream with a bad JSON line gives an error event only, released", async () => {
    const made = makeTaskEnv({ stream: async () => sse(["data: {bad json\n\n"]) });
    const events = await readEvents(await post(made.env));
    expect(events.map((event) => event.event)).toEqual(["error"]);
    expect(made.store.read()).toMatchObject({ monthly: 10, holds: [] });
  });
});

describe("POST /v1/tasks/explain: routes and zero retention", () => {
  test("a zero-retention user with DEFAULT_ROUTES gives 403 forbidden, with no model call and the hold released", async () => {
    const made = makeTaskEnv();
    const res = await post(made.env, {}, { ...USER, zero_retention: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      code: "forbidden",
      message: "no zero-retention route for this task",
      retry_after: null,
    });
    expect(made.aiCalls).toEqual([]);
    expect(made.commands.map((command) => command.type)).toEqual(["hold", "release"]);
    expect(made.store.read()).toMatchObject({ monthly: 10 });
  });

  test("a zero-retention user with a zero strong route gets done at strong, and the only AI call is that model", async () => {
    const routes: RouteTable = {
      ...DEFAULT_ROUTES,
      tiers: { ...DEFAULT_ROUTES.tiers, strong: [{ model: "@cf/zero/strong", retention: "zero" }] },
    };
    const made = makeTaskEnv({ routes });
    const events = await readEvents(await post(made.env, {}, { ...USER, zero_retention: true }));
    expect(StreamDoneSchema.parse(events[events.length - 1]?.data)).toEqual({
      credits: 1,
      tier: "strong",
      retention: "zero",
      offer_research: false,
    });
    expect(made.aiCalls.map((call) => call.model)).toEqual(["@cf/zero/strong"]);
  });

  test("a router reply that is not an answer routes as strong and records router failed", async () => {
    const made = makeTaskEnv({ reply: async () => ({ response: "no idea" }) });
    const events = await readEvents(await post(made.env));
    expect(StreamDoneSchema.parse(events[events.length - 1]?.data).tier).toBe("strong");
    expect(made.events[0]?.router).toBe("failed");
    expect(made.events[0]?.model).toBe("workers-ai/kimi-k2.6");
  });

  test("the usage queue send throws: the stream still ends with done, monthly 9", async () => {
    const made = makeTaskEnv({ usageFails: true });
    const events = await readEvents(await post(made.env));
    expect(events.map((event) => event.event)).toEqual(["delta", "delta", "done"]);
    expect(made.store.read()).toMatchObject({ monthly: 9 });
  });
});

describe("POST /v1/tasks/explain: request checks", () => {
  test.each([
    ["bad JSON", "{"],
    ["an empty word", JSON.stringify({ word: "", transcript: TRANSCRIPT })],
    ["a word of 101 characters", JSON.stringify({ word: "a".repeat(101), transcript: TRANSCRIPT })],
    ["a transcript of 4,001 characters", JSON.stringify({ word: WORD, transcript: textOf(4001) })],
    ["a missing transcript", JSON.stringify({ word: WORD })],
    ["an extra key", JSON.stringify({ ...BODY, extra: 1 })],
  ])("%s gives 400 bad_request, with no wallet command and no AI call", async (_name, body) => {
    const made = makeTaskEnv();
    const res = await post(made.env, { body });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
    expect(text).not.toContain(MARKER);
    expect(made.commands).toEqual([]);
    expect(made.aiCalls).toEqual([]);
  });

  test("a transcript of exactly 4,000 characters gives 200", async () => {
    const made = makeTaskEnv();
    const res = await post(made.env, { body: JSON.stringify({ word: WORD, transcript: textOf(4000) }) });
    expect(res.status).toBe(200);
    await readEvents(res);
  });

  test("no Idempotency-Key header gives 400 with the header message", async () => {
    const made = makeTaskEnv();
    const res = await post(made.env, { key: null });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Idempotency-Key header required",
      retry_after: null,
    });
    expect(made.commands).toEqual([]);
  });

  test("config:current missing gives 500 config unavailable, with no wallet command", async () => {
    const made = makeTaskEnv();
    made.env.CONFIG = { get: async () => null };
    const res = await post(made.env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "config unavailable", retry_after: null });
    expect(made.commands).toEqual([]);
  });

  test("privacy: no console method is called, and no command or usage event holds the marker", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const good = makeTaskEnv();
    await readEvents(await post(good.env));
    const failing = makeTaskEnv({
      stream: async () => {
        throw new Error("model down");
      },
    });
    await (await post(failing.env)).text();

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const dump = JSON.stringify([good.commands, good.events, failing.commands, failing.events]);
    expect(dump).not.toContain(MARKER);
  });
});

describe("POST /v1/tasks/explain: a repeated key after a failed stream", () => {
  test("a first request whose stream fails releases the hold; the same key again is 409 request already finished, with no model call and no credits moved", async () => {
    const made = makeTaskEnv({ stream: async () => failingStream('data: {"response":"Water "}\n\n') });
    const first = await post(made.env);
    expect(first.status).toBe(200);
    expect((await readEvents(first)).map((event) => event.event)).toEqual(["delta", "error"]);
    const callsBefore = made.aiCalls.length;
    const eventsBefore = made.events.length;

    const again = await post(made.env);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ code: "conflict", message: "request already finished", retry_after: null });
    expect(made.aiCalls).toHaveLength(callsBefore);
    expect(made.store.read()).toMatchObject({ monthly: 10, holds: [] });
    expect(made.events).toHaveLength(eventsBefore);
  });
});

describe("POST /v1/tasks/explain: the app goes away", () => {
  test("the app drops the stream after the first delta: the work is handed to waitUntil, settles at 1 credit and sends its usage event", async () => {
    const made = makeTaskEnv();
    const waiting: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waiting.push(p), passThroughOnException: () => undefined, props: {} };
    const init = { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": KEY }, body: JSON.stringify(BODY) };
    const res = await setup().request("/v1/tasks/explain", init, made.env, ctx);
    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error("expected a body");
    await reader.read();
    await reader.cancel();
    expect(waiting).toHaveLength(1);
    await Promise.all(waiting);
    expect(made.store.read()).toMatchObject({ monthly: 9, holds: [] });
    expect(made.events).toMatchObject([{ id: HOLD_ID, outcome: "ok", credits: 1 }]);
  });
});
