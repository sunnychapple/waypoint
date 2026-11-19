import {
  ApiErrorSchema,
  DoubleCheckResponseSchema,
  InsufficientCreditsErrorSchema,
  StreamDoneSchema,
  type StreamDone,
} from "@waypoint/contracts";
import { DEFAULT_ROUTES, type RouteTable } from "@waypoint/router";
import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { doubleCheckRoute } from "../src/tasks/double-check.ts";
import { moreDetailRoute } from "../src/tasks/more-detail.ts";
import { failingStream, makeTaskEnv, readEvents, TASK_NOW } from "./helpers/tasks.ts";

const USER: SessionUser = {
  id: "u1",
  clerk_id: "user_1",
  plan: "free",
  billing_account_id: "ba1",
  zero_retention: false,
};
const KEY = "abcdefghijklmnop";
const TRANSCRIPT_MARKER = "SECRET-TRANSCRIPT-7f3a";
const ANSWER_MARKER = "SECRET-ANSWER-91c2";
const WORD = "osmosis";
const TRANSCRIPT = `the cell takes in water ${TRANSCRIPT_MARKER}`;
const ANSWER = `It is water moving. ${ANSWER_MARKER}`;
const BODY = { word: WORD, transcript: TRANSCRIPT, answer: ANSWER };
const MORE_DETAIL_ID = `more_detail:u1:${KEY}`;
const DOUBLE_CHECK_ID = `double_check:u1:${KEY}`;
const CHECKED_TEXT = "Correct. Osmosis is water moving across a membrane.";

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
  app.route("/", moreDetailRoute({ now: () => TASK_NOW }));
  app.route("/", doubleCheckRoute({ now: () => TASK_NOW }));
  return app;
}

async function post(
  path: "/v1/tasks/more-detail" | "/v1/tasks/double-check",
  env: object,
  { body = JSON.stringify(BODY), key = KEY }: { body?: string; key?: string | null } = {},
  user?: SessionUser,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== null) headers["Idempotency-Key"] = key;
  return await setup(user).request(path, { method: "POST", headers, body }, env);
}

describe("POST /v1/tasks/more-detail", () => {
  test("happy path: events end with done at 3 credits; one model call with no router; hold settles at 3; one usage event with no text", async () => {
    const made = makeTaskEnv();
    const res = await post("/v1/tasks/more-detail", made.env);
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(events.map((event) => event.event)).toEqual(["delta", "delta", "done"]);
    const done: StreamDone = StreamDoneSchema.parse(events[2]?.data);
    expect(done).toEqual({ credits: 3, tier: "standard", retention: "standard", offer_research: false });

    expect(made.aiCalls).toHaveLength(1);
    const call = made.aiCalls[0];
    expect(call?.model).toBe("workers-ai/deepseek-v4.1-flash");
    expect(call?.inputs).toMatchObject({ stream: true, max_tokens: 1200 });
    expect(JSON.stringify(call?.inputs["messages"])).toContain(ANSWER);

    expect(made.store.read()).toMatchObject({ monthly: 7, holds: [] });
    expect(made.commands).toEqual([
      {
        type: "hold",
        id: MORE_DETAIL_ID,
        hold_id: MORE_DETAIL_ID,
        user_id: "u1",
        task: "more_detail",
        credits: 3,
        expires_at: TASK_NOW + 90_000 + 60_000,
      },
      { type: "settle", id: `more_detail_settle:u1:${KEY}`, hold_id: MORE_DETAIL_ID, actual: 3 },
    ]);
    expect(made.events).toEqual([
      {
        v: 1,
        id: MORE_DETAIL_ID,
        at: TASK_NOW,
        user_id: "u1",
        task: "more_detail",
        outcome: "ok",
        credits: 3,
        tier: "standard",
        model: "workers-ai/deepseek-v4.1-flash",
        retention: "standard",
        router: "skipped",
        bytes_sent: utf8Length(WORD) + utf8Length(TRANSCRIPT) + utf8Length(ANSWER),
        tokens_in: 120,
        tokens_out: 9,
      },
    ]);
  });

  test("the stream fails after one chunk: delta then error, hold released, monthly 10, model_failed with 0 credits", async () => {
    const made = makeTaskEnv({ stream: async () => failingStream('data: {"response":"Water "}\n\n') });
    const res = await post("/v1/tasks/more-detail", made.env);
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(events.map((event) => event.event)).toEqual(["delta", "error"]);
    expect(ApiErrorSchema.parse(events[1]?.data)).toEqual({ code: "internal", message: "model failed", retry_after: null });
    expect(made.store.read()).toMatchObject({ monthly: 10, holds: [] });
    expect(made.events[0]?.outcome).toBe("model_failed");
    expect(made.events[0]?.credits).toBe(0);
  });

  test("monthly 2 gives 402 with shortfall 1, and no AI call or usage event", async () => {
    const made = makeTaskEnv({ monthly: 2 });
    const res = await post("/v1/tasks/more-detail", made.env);
    expect(res.status).toBe(402);
    expect(InsufficientCreditsErrorSchema.parse(await res.json()).shortfall).toBe(1);
    expect(made.aiCalls).toEqual([]);
    expect(made.events).toEqual([]);
  });
});

describe("POST /v1/tasks/double-check", () => {
  test("happy path: 200 JSON with the text at 4 credits, strong tier; one model call with no stream; hold settles at 4; usage has token counts", async () => {
    const made = makeTaskEnv({
      reply: async () => ({
        choices: [{ message: { content: CHECKED_TEXT } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      }),
    });
    const res = await post("/v1/tasks/double-check", made.env);
    expect(res.status).toBe(200);
    expect(DoubleCheckResponseSchema.parse(await res.json())).toEqual({
      text: CHECKED_TEXT,
      credits: 4,
      tier: "strong",
      retention: "standard",
    });

    expect(made.aiCalls).toHaveLength(1);
    const call = made.aiCalls[0];
    expect(call?.model).toBe("workers-ai/kimi-k2.6");
    expect(call?.inputs["stream"]).toBeUndefined();
    expect(call?.inputs).toMatchObject({ max_tokens: 600 });
    expect(call?.options.gateway).toEqual({ id: "gw-test", collectLog: false, skipCache: true });

    expect(made.store.read()).toMatchObject({ monthly: 6, holds: [] });
    expect(made.commands).toEqual([
      {
        type: "hold",
        id: DOUBLE_CHECK_ID,
        hold_id: DOUBLE_CHECK_ID,
        user_id: "u1",
        task: "double_check",
        credits: 4,
        expires_at: TASK_NOW + 120_000 + 60_000,
      },
      { type: "settle", id: `double_check_settle:u1:${KEY}`, hold_id: DOUBLE_CHECK_ID, actual: 4 },
    ]);
    expect(made.events).toHaveLength(1);
    expect(made.events[0]).toMatchObject({
      id: DOUBLE_CHECK_ID,
      task: "double_check",
      outcome: "ok",
      credits: 4,
      router: "skipped",
      tokens_in: 5,
      tokens_out: 3,
    });
  });

  test("the older { response } reply shape gives 200 with that text", async () => {
    const made = makeTaskEnv({ reply: async () => ({ response: "Correct." }) });
    const res = await post("/v1/tasks/double-check", made.env);
    expect(res.status).toBe(200);
    expect(DoubleCheckResponseSchema.parse(await res.json()).text).toBe("Correct.");
  });

  test("the model call throws: 500 model unavailable, hold released, monthly 10, one model_failed event with 0 credits", async () => {
    const made = makeTaskEnv({
      reply: async () => {
        throw new Error("model down");
      },
    });
    const res = await post("/v1/tasks/double-check", made.env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "model unavailable", retry_after: null });
    expect(made.commands.map((command) => command.type)).toEqual(["hold", "release"]);
    expect(made.store.read()).toMatchObject({ monthly: 10, holds: [] });
    expect(made.events).toHaveLength(1);
    expect(made.events[0]?.outcome).toBe("model_failed");
    expect(made.events[0]?.credits).toBe(0);
  });

  test("the model answers with only spaces: 500 model unavailable, released", async () => {
    const made = makeTaskEnv({ reply: async () => ({ choices: [{ message: { content: "   " } }] }) });
    const res = await post("/v1/tasks/double-check", made.env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "model unavailable", retry_after: null });
    expect(made.commands.map((command) => command.type)).toEqual(["hold", "release"]);
    expect(made.store.read()).toMatchObject({ monthly: 10, holds: [] });
  });

  test("the same key after a finished check gives 409 request already finished, with no second model call", async () => {
    const made = makeTaskEnv({ reply: async () => ({ choices: [{ message: { content: CHECKED_TEXT } }] }) });
    expect((await post("/v1/tasks/double-check", made.env)).status).toBe(200);
    const again = await post("/v1/tasks/double-check", made.env);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ code: "conflict", message: "request already finished", retry_after: null });
    expect(made.aiCalls).toHaveLength(1);
    expect(made.store.read()).toMatchObject({ monthly: 6 });
  });
});

describe("follow-up routes: zero retention and request checks", () => {
  test("a zero-retention user with DEFAULT_ROUTES gets 403 on both endpoints, with no model call and the hold released", async () => {
    const zero = { ...USER, zero_retention: true };
    for (const path of ["/v1/tasks/more-detail", "/v1/tasks/double-check"] as const) {
      const made = makeTaskEnv();
      const res = await post(path, made.env, {}, zero);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        code: "forbidden",
        message: "no zero-retention route for this task",
        retry_after: null,
      });
      expect(made.aiCalls).toEqual([]);
      expect(made.commands.map((command) => command.type)).toEqual(["hold", "release"]);
      expect(made.store.read()).toMatchObject({ monthly: 10 });
    }
  });

  test("a zero-retention route only in the light tier still gives 403 on both endpoints, since the fixed tiers do not move down", async () => {
    const routes: RouteTable = {
      ...DEFAULT_ROUTES,
      tiers: { ...DEFAULT_ROUTES.tiers, light: [{ model: "@cf/zero/light", retention: "zero" }] },
    };
    const zero = { ...USER, zero_retention: true };
    for (const path of ["/v1/tasks/more-detail", "/v1/tasks/double-check"] as const) {
      const made = makeTaskEnv({ routes });
      const res = await post(path, made.env, {}, zero);
      expect(res.status).toBe(403);
      expect(made.aiCalls).toEqual([]);
      expect(made.store.read()).toMatchObject({ monthly: 10 });
    }
  });

  test("a missing answer gives 400 bad_request on both endpoints, with no wallet command and no AI call", async () => {
    const body = JSON.stringify({ word: WORD, transcript: TRANSCRIPT });
    for (const path of ["/v1/tasks/more-detail", "/v1/tasks/double-check"] as const) {
      const made = makeTaskEnv();
      const res = await post(path, made.env, { body });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
      expect(made.commands).toEqual([]);
      expect(made.aiCalls).toEqual([]);
    }
  });

  test("privacy: no console method is called, and no command or usage event holds either marker", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const moreDetail = makeTaskEnv();
    await readEvents(await post("/v1/tasks/more-detail", moreDetail.env));
    const doubleCheck = makeTaskEnv();
    await (await post("/v1/tasks/double-check", doubleCheck.env)).text();
    const failing = makeTaskEnv({
      reply: async () => {
        throw new Error("model down");
      },
    });
    await (await post("/v1/tasks/double-check", failing.env)).text();

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const dump = JSON.stringify([
      moreDetail.commands,
      moreDetail.events,
      doubleCheck.commands,
      doubleCheck.events,
      failing.commands,
      failing.events,
    ]);
    expect(dump).not.toContain(TRANSCRIPT_MARKER);
    expect(dump).not.toContain(ANSWER_MARKER);
  });
});
