import { ConfigResponseSchema } from "@waypoint/contracts";
import { PRICE_TABLE_2026_11_16_2 } from "@waypoint/pricing";
import { DEFAULT_ROUTES } from "@waypoint/router";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { configRoute } from "../src/config/route.ts";
import { ConfigError, loadConfig, type ConfigKv } from "../src/config/load.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";

export const kvFits: (kv: KVNamespace) => ConfigKv = (kv) => kv;

const CONFIG_KEYS = [
  "config:current",
  "config:prices:2026-11-16.2",
  "config:routes:2026-11-16.1",
  "config:router",
  "config:flags",
  "config:min-native",
  "config:voice-pack",
] as const;

function goodEntries(): Record<string, unknown> {
  return {
    "config:current": { prices: "2026-11-16.2", routes: "2026-11-16.1" },
    "config:prices:2026-11-16.2": PRICE_TABLE_2026_11_16_2,
    "config:routes:2026-11-16.1": DEFAULT_ROUTES,
    "config:router": { model: "example/router", min_confidence: 0.6 },
    "config:flags": { new_export: true },
    "config:min-native": { ios: "1.4.0" },
    "config:voice-pack": goodVoicePack(),
  };
}

function goodVoicePack() {
  return {
    version: "2026-11-01",
    url: "https://packs.example.com/voices.zip",
    sha256: "ab".repeat(32),
    size: 1024,
  };
}

type Call = { key: string; options: { type: "json"; cacheTtl: number } };

function stubKv(entries: Record<string, unknown>) {
  const map = new Map<string, unknown>(Object.entries(entries));
  const calls: Call[] = [];
  const kv: ConfigKv = {
    async get(key, options) {
      calls.push({ key, options });
      return map.has(key) ? map.get(key) : null;
    },
  };
  return { kv, calls };
}

async function loadError(entries: Record<string, unknown>): Promise<ConfigError> {
  const outcome = await loadConfig(stubKv(entries).kv).then(
    () => null,
    (err: unknown) => err,
  );
  if (!(outcome instanceof ConfigError)) throw new Error("expected a ConfigError");
  return outcome;
}

function withoutKey(key: string): Record<string, unknown> {
  const entries = goodEntries();
  delete entries[key];
  return entries;
}

function withValue(key: string, value: unknown): Record<string, unknown> {
  return { ...goodEntries(), [key]: value };
}

describe("loadConfig", () => {
  test("loads a full good config and reads every key with type json and cacheTtl 60", async () => {
    const { kv, calls } = stubKv(goodEntries());
    const config = await loadConfig(kv);
    expect(config.prices).toEqual(PRICE_TABLE_2026_11_16_2);
    expect(config.routes).toEqual(DEFAULT_ROUTES);
    expect(config.router).toEqual({ model: "example/router", min_confidence: 0.6 });
    expect(config.flags).toEqual({ new_export: true });
    expect(config.min_native).toEqual({ ios: "1.4.0" });
    expect(config.voice_pack.size).toBe(1024);
    expect(calls).toHaveLength(7);
    expect(calls[0]?.key).toBe("config:current");
    expect(calls.map((c) => c.key).sort()).toEqual([...CONFIG_KEYS].sort());
    for (const call of calls) {
      expect(call.options).toEqual({ type: "json", cacheTtl: 60 });
    }
  });

  test.each(CONFIG_KEYS)("a missing %s gives ConfigError naming that key", async (key) => {
    const err = await loadError(withoutKey(key));
    expect(err.key).toBe(key);
    expect(err.message).toContain(key);
  });

  test("a price table whose version differs from config:current gives ConfigError", async () => {
    const err = await loadError(
      withValue("config:prices:2026-11-16.2", { ...PRICE_TABLE_2026_11_16_2, version: "2026-11-16.3" }),
    );
    expect(err.key).toBe("config:prices:2026-11-16.2");
  });

  test("a route table whose version differs from config:current gives ConfigError", async () => {
    const err = await loadError(withValue("config:routes:2026-11-16.1", { ...DEFAULT_ROUTES, version: "2026-11-16.9" }));
    expect(err.key).toBe("config:routes:2026-11-16.1");
  });

  test("router min_confidence of 0 is rejected", async () => {
    const err = await loadError(withValue("config:router", { model: "example/router", min_confidence: 0 }));
    expect(err.key).toBe("config:router");
  });

  test("min-native ios '1.4' is rejected", async () => {
    const err = await loadError(withValue("config:min-native", { ios: "1.4" }));
    expect(err.key).toBe("config:min-native");
  });

  test("voice-pack sha256 in capitals is rejected", async () => {
    const err = await loadError(
      withValue("config:voice-pack", { ...goodVoicePack(), sha256: "AB".repeat(32) }),
    );
    expect(err.key).toBe("config:voice-pack");
  });

  test("voice-pack http:// URL is rejected", async () => {
    const err = await loadError(
      withValue("config:voice-pack", { ...goodVoicePack(), url: "http://packs.example.com/voices.zip" }),
    );
    expect(err.key).toBe("config:voice-pack");
  });

  test("a flag name with a capital letter is rejected", async () => {
    const err = await loadError(withValue("config:flags", { NewExport: true }));
    expect(err.key).toBe("config:flags");
  });

  test("a price of 0 is rejected", async () => {
    const err = await loadError(
      withValue("config:prices:2026-11-16.2", {
        ...PRICE_TABLE_2026_11_16_2,
        credits: { ...PRICE_TABLE_2026_11_16_2.credits, explain: 0 },
      }),
    );
    expect(err.key).toBe("config:prices:2026-11-16.2");
  });
});

describe("GET /v1/config", () => {
  function routeApp() {
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.route("/", configRoute);
    return app;
  }

  test("gives 200, a ConfigResponse body, no router config and no model ids, with Cache-Control", async () => {
    const { kv } = stubKv(goodEntries());
    const res = await routeApp().request("/v1/config", {}, { CONFIG: kv });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    const text = await res.text();
    const body: unknown = JSON.parse(text);
    expect(ConfigResponseSchema.safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty("router");
    expect(text).not.toContain("example/router");
    expect(text).not.toContain("workers-ai/");
    expect(text).not.toContain('"tiers"');
  });

  test("with one key missing gives 500 internal and the reply does not contain the key name", async () => {
    const { kv } = stubKv(withoutKey("config:router"));
    const res = await routeApp().request("/v1/config", {}, { CONFIG: kv });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ code: "internal", message: "config unavailable", retry_after: null });
    expect(text).not.toContain("config:router");
  });
});
