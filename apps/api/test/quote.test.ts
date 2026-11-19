import {
  ApiErrorSchema,
  InsufficientCreditsErrorSchema,
  QuoteResponseSchema,
  type ApiError,
} from "@waypoint/contracts";
import { PRICE_TABLE_2026_11_16_2 } from "@waypoint/pricing";
import { DEFAULT_ROUTES } from "@waypoint/router";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { quoteRoute } from "../src/tasks/quote.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { SessionUser } from "../src/auth/users.ts";
import type { WalletView } from "../src/wallet/store.ts";

const USER: SessionUser = {
  id: "user-1",
  clerk_id: "user_123",
  plan: "plus",
  billing_account_id: "billing-account-1",
  zero_retention: false,
};

function goodConfigEntries(): Record<string, unknown> {
  return {
    "config:current": { prices: "2026-11-16.2", routes: "2026-11-16.1" },
    "config:prices:2026-11-16.2": PRICE_TABLE_2026_11_16_2,
    "config:routes:2026-11-16.1": DEFAULT_ROUTES,
    "config:router": { model: "example/router", min_confidence: 0.6 },
    "config:flags": { new_export: true },
    "config:min-native": { ios: "1.4.0" },
    "config:voice-pack": {
      version: "2026-11-01",
      url: "https://packs.example.com/voices.zip",
      sha256: "ab".repeat(32),
      size: 1024,
    },
  };
}

function view(monthly: number, purchased: number, owed: number): WalletView {
  return { monthly, purchased, owed, monthly_resets_at: null, holds: [] };
}

// Builds the env for one request: a Map-backed CONFIG and a WALLET stub that records the names it was asked for.
function makeEnv(entries: Record<string, unknown>, wallet: WalletView) {
  const map = new Map<string, unknown>(Object.entries(entries));
  const names: string[] = [];
  const CONFIG = {
    async get(key: string) {
      return map.has(key) ? map.get(key) : null;
    },
  };
  const WALLET = {
    idFromName(name: string) {
      return name;
    },
    get(id: string) {
      names.push(id);
      return { read: async () => wallet };
    },
  };
  return { env: { CONFIG, WALLET }, names };
}

function setup(user: SessionUser = USER) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", quoteRoute);
  return app;
}

function post(body: string, env: object, user?: SessionUser) {
  return setup(user).request(
    "/v1/tasks/quote",
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
    env,
  );
}

describe("POST /v1/tasks/quote: quotes", () => {
  test("explain with 10 monthly gives 200, the quote, balance_after 9, and looks up the billing account", async () => {
    const { env, names } = makeEnv(goodConfigEntries(), view(10, 0, 0));
    const res = await post(JSON.stringify({ task: "explain" }), env);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(QuoteResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      credits: 1,
      price_table: "2026-11-16.2",
      retention: "standard",
      balance_after: 9,
      expires_in: 300,
    });
    expect(names).toEqual(["billing-account-1"]);
  });

  test.each([
    ["overview_script with fallback_voice", { task: "overview_script", fallback_voice: true }, 42],
    ["retranscribe with 4 minutes", { task: "retranscribe", minutes: 4 }, 4],
    ["research at deep depth", { task: "research", depth: "deep" }, 125],
  ])("%s quotes the right credits", async (_name, request, credits) => {
    const { env } = makeEnv(goodConfigEntries(), view(1000, 0, 0));
    const res = await post(JSON.stringify(request), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ credits });
  });

  test("a user with zero_retention gets retention zero", async () => {
    const { env } = makeEnv(goodConfigEntries(), view(10, 0, 0));
    const res = await post(JSON.stringify({ task: "explain" }), env, { ...USER, zero_retention: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ retention: "zero" });
  });

  test("monthly 1 and purchased 2 with more_detail (3) gives 200 and balance_after 0", async () => {
    const { env } = makeEnv(goodConfigEntries(), view(1, 2, 0));
    const res = await post(JSON.stringify({ task: "more_detail" }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ credits: 3, balance_after: 0 });
  });

  test("owed credits do not block a quote that fits in monthly", async () => {
    const { env } = makeEnv(goodConfigEntries(), view(50, 0, 90));
    const res = await post(JSON.stringify({ task: "explain" }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ credits: 1, balance_after: 49 });
  });
});

describe("POST /v1/tasks/quote: shortfall", () => {
  test("purchased 3 and owed 7 with double_check (4) gives 402 with shortfall 8", async () => {
    const { env } = makeEnv(goodConfigEntries(), view(0, 3, 7));
    const res = await post(JSON.stringify({ task: "double_check" }), env);
    expect(res.status).toBe(402);
    const body: unknown = await res.json();
    expect(body).toEqual({
      code: "insufficient_credits",
      message: "not enough credits",
      retry_after: null,
      shortfall: 8,
    });
    expect(InsufficientCreditsErrorSchema.safeParse(body).success).toBe(true);
  });
});

describe("POST /v1/tasks/quote: bad requests", () => {
  const cases: [string, string][] = [
    ["bad JSON", '{"task": "explain", secret-text'],
    ["an unknown task", '{"task": "nope", "note": "secret-text"}'],
    ["research without depth", '{"task": "research", "note": "secret-text"}'],
    ["fallback_voice on explain", '{"task": "explain", "fallback_voice": true, "note": "secret-text"}'],
    ["an extra key", '{"task": "explain", "secret-text": 1}'],
    ["a JSON array body", '[{"task": "explain", "note": "secret-text"}]'],
    ["a JSON null body", "null"],
    ["a JSON number body", "5"],
    ["an empty body", ""],
  ];

  test.each(cases)("%s gives 400 bad_request without echoing the request", async (_name, raw) => {
    const { env } = makeEnv(goodConfigEntries(), view(10, 0, 0));
    const res = await post(raw, env);
    expect(res.status).toBe(400);
    const text = await res.text();
    const body = JSON.parse(text) as ApiError;
    expect(() => ApiErrorSchema.parse(body)).not.toThrow();
    expect(body).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
    expect(text).not.toContain("secret");
  });
});

describe("POST /v1/tasks/quote: config", () => {
  test("config:current missing gives 500 internal 'config unavailable'", async () => {
    const entries = goodConfigEntries();
    delete entries["config:current"];
    const { env } = makeEnv(entries, view(10, 0, 0));
    const res = await post(JSON.stringify({ task: "explain" }), env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "config unavailable", retry_after: null });
  });

  test("a non-ConfigError thrown by CONFIG is rethrown and gives 500 internal 'something went wrong'", async () => {
    const { env } = makeEnv(goodConfigEntries(), view(10, 0, 0));
    const broken = {
      ...env,
      CONFIG: {
        async get(): Promise<unknown> {
          throw new TypeError("kv down");
        },
      },
    };
    const res = await post(JSON.stringify({ task: "explain" }), broken);
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    expect(body).toEqual({ code: "internal", message: "something went wrong", retry_after: null });
    expect(JSON.stringify(body)).not.toContain("kv down");
  });
});
