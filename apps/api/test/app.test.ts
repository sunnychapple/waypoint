import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeAll, describe, expect, test } from "vitest";
import { ApiErrorSchema, InsufficientCreditsErrorSchema, type ApiError } from "@waypoint/contracts";
import { createApp } from "../src/app.ts";
import type { AppEnv } from "../src/env.ts";
import { ApiFailure, handleError, InsufficientCredits } from "../src/errors.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";

const ISSUER = "https://clerk.example.com";
const NOW = 1_800_000_000_000;
const env = {
  DB: createTestDb(),
  CONFIG: {} as KVNamespace,
  CLERK_ISSUER: ISSUER,
  CLERK_AUTHORIZED_PARTIES: "",
};
const VALID_KEY = "abcdefghijklmnop";

let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string };

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sessionToken(): Promise<string> {
  const encode = (value: object): string => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const signingInput = `${encode({ alg: "RS256", kid: "k1", typ: "JWT" })}.${encode({
    iss: ISSUER,
    sub: "user_123",
    nbf: NOW / 1000 - 60,
    exp: NOW / 1000 + 60,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

async function authed(headers: Record<string, string> = {}): Promise<Record<string, string>> {
  return { ...headers, Authorization: `Bearer ${await sessionToken()}` };
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in pair)) throw new Error("expected a key pair");
  privateKey = pair.privateKey;
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  if (!("kty" in exported)) throw new Error("expected a JWK");
  publicJwk = { ...exported, kid: "k1" };
});

function setup() {
  const app = createApp({
    fetchJwks: async () => ({ keys: [publicJwk] }),
    now: () => NOW,
    newId: () => crypto.randomUUID(),
  });
  app.get("/throw-rate", () => {
    throw new ApiFailure("rate_limited", "slow down", 30);
  });
  app.get("/throw-plain", () => {
    throw new Error("secret detail");
  });
  app.get("/throw-401", () => {
    throw new HTTPException(401);
  });
  app.get("/throw-418", () => {
    throw new HTTPException(418);
  });
  app.all("/v1/x", (c) => c.json({ reached: true }));
  app.post("/webhooks/x", (c) => c.json({ reached: true }));
  return app;
}

describe("error replies", () => {
  test("an unknown path gives 404 with the not_found body", async () => {
    const res = await setup().request("/nope", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found", message: "no such endpoint", retry_after: null });
  });

  test("an ApiFailure gives its status, body and Retry-After", async () => {
    const res = await setup().request("/throw-rate", {}, env);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: "rate_limited", message: "slow down", retry_after: 30 });
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  test("a plain Error gives 500 internal and does not leak its message", async () => {
    const res = await setup().request("/throw-plain", {}, env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as ApiError;
    expect(body).toEqual({ code: "internal", message: "something went wrong", retry_after: null });
    expect(JSON.stringify(body)).not.toContain("secret detail");
  });

  test("HTTPException(401) gives 401 unauthorized", async () => {
    const res = await setup().request("/throw-401", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "request failed", retry_after: null });
  });

  test("HTTPException(418) gives 500 internal", async () => {
    const res = await setup().request("/throw-418", {}, env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "request failed", retry_after: null });
  });

  test("every error body passes ApiErrorSchema", async () => {
    const app = setup();
    const paths = ["/nope", "/throw-rate", "/throw-plain", "/throw-401", "/throw-418"];
    for (const path of paths) {
      const res = await app.request(path, {}, env);
      const body: unknown = await res.json();
      expect(() => ApiErrorSchema.parse(body)).not.toThrow();
    }
  });
});

describe("Idempotency-Key check", () => {
  test.each(["POST", "PUT", "PATCH", "DELETE"])("%s /v1/x with no key gives 400 bad_request", async (method) => {
    const res = await setup().request("/v1/x", { method, headers: await authed() }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Idempotency-Key header required",
      retry_after: null,
    });
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"])("%s /v1/x with a 15-character key gives 400", async (method) => {
    const res = await setup().request(
      "/v1/x",
      { method, headers: await authed({ "Idempotency-Key": "a".repeat(15) }) },
      env,
    );
    expect(res.status).toBe(400);
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"])("%s /v1/x with a valid key reaches the route", async (method) => {
    const res = await setup().request(
      "/v1/x",
      { method, headers: await authed({ "Idempotency-Key": VALID_KEY }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  test("GET /v1/x with no key reaches the route", async () => {
    const res = await setup().request("/v1/x", { headers: await authed() }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  test("POST /webhooks/x with no key reaches the route", async () => {
    const res = await setup().request("/webhooks/x", { method: "POST" }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });
});

describe("quote errors", () => {
  test("a route throwing InsufficientCredits(5) gives 402 with shortfall 5 that passes InsufficientCreditsErrorSchema", async () => {
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.get("/throw-402", () => {
      throw new InsufficientCredits(5);
    });
    const res = await app.request("/throw-402", {}, env);
    expect(res.status).toBe(402);
    const body: unknown = await res.json();
    expect(body).toEqual({ code: "insufficient_credits", message: "not enough credits", retry_after: null, shortfall: 5 });
    expect(InsufficientCreditsErrorSchema.safeParse(body).success).toBe(true);
  });

  test("a signed-in POST /v1/tasks/quote with no Idempotency-Key gives 400 bad_request through createApp", async () => {
    const res = await setup().request("/v1/tasks/quote", { method: "POST", headers: await authed() }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Idempotency-Key header required",
      retry_after: null,
    });
  });

  test("POST /v1/tasks/quote with no Authorization header gives 401 through createApp", async () => {
    const res = await setup().request("/v1/tasks/quote", { method: "POST" }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "sign in required", retry_after: null });
  });
});

describe("explain route through createApp", () => {
  test("POST /v1/tasks/explain with no Authorization header gives 401 through createApp", async () => {
    const res = await setup().request("/v1/tasks/explain", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });
});

describe("follow-up routes through createApp", () => {
  test("POST /v1/tasks/more-detail with no Authorization header gives 401 through createApp", async () => {
    const res = await setup().request("/v1/tasks/more-detail", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });

  test("POST /v1/tasks/double-check with no Authorization header gives 401 through createApp", async () => {
    const res = await setup().request("/v1/tasks/double-check", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });
});

describe("wallet", () => {
  test("GET /v1/wallet with no Authorization header gives 401 through createApp", async () => {
    const res = await setup().request("/v1/wallet", {}, env);
    expect(res.status).toBe(401);
  });
});

describe("push tokens through createApp", () => {
  test("POST /v1/push-tokens with no Authorization header gives 401", async () => {
    const res = await setup().request("/v1/push-tokens", { method: "POST" }, env);
    expect(res.status).toBe(401);
  });
});

describe("webhook route through createApp", () => {
  test("POST /webhooks/clerk with no Authorization, no Idempotency-Key and no svix headers gives 401 invalid signature", async () => {
    const res = await setup().request(
      "/webhooks/clerk",
      { method: "POST", body: "{}" },
      { ...env, CLERK_WEBHOOK_SIGNING_SECRET: "whsec_" + btoa("0123456789abcdef0123456789abcdef") },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "invalid signature", retry_after: null });
  });
});

describe("activity through createApp", () => {
  test("GET /v1/activity with no Authorization header gives 401 through createApp", async () => {
    const res = await setup().request("/v1/activity", {}, env);
    expect(res.status).toBe(401);
  });
});

describe("Apple purchase route through createApp", () => {
  test("POST /v1/purchases/apple with no Authorization header gives 401 through createApp", async () => {
    const res = await setup().request("/v1/purchases/apple", { method: "POST", body: "{}" }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "sign in required", retry_after: null });
  });
});

describe("device signatures on the routes merged before S1A", () => {
  let phone: TestDevice;
  let userId: string;

  beforeAll(async () => {
    await setup().request("/v1/x", { headers: await authed() }, env);
    const row = await env.DB.prepare("SELECT id FROM users WHERE clerk_id = 'user_123'").first<{ id: string }>();
    if (row === null) throw new Error("session user missing");
    userId = row.id;
    phone = await makeTestDevice("dev_phone");
    await insertDevice(env.DB, phone, { userId });
  });

  test("each of the four paths, signed in with a key and no Waypoint headers, gives 401 device signature required", async () => {
    const paths = ["/v1/tasks/explain", "/v1/tasks/more-detail", "/v1/tasks/double-check", "/v1/purchases/apple"];
    for (const path of paths) {
      const res = await setup().request(path, { method: "POST", headers: await authed({ "Idempotency-Key": VALID_KEY }) }, env);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: "unauthorized", message: "device signature required", retry_after: null });
    }
  });

  test("POST /v1/tasks/explain signed by the phone with body {} gives 400 invalid request", async () => {
    const init = await signedInit(phone, { method: "POST", path: "/v1/tasks/explain", body: {}, now: NOW });
    const res = await setup().request("/v1/tasks/explain", { ...init, headers: await authed(init.headers as Record<string, string>) }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
  });

  test("POST /v1/purchases/apple signed by the phone with body {} gives 400 invalid request", async () => {
    const init = await signedInit(phone, { method: "POST", path: "/v1/purchases/apple", body: {}, now: NOW });
    const res = await setup().request("/v1/purchases/apple", { ...init, headers: await authed(init.headers as Record<string, string>) }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
  });

  test("POST /v1/tasks/explain signed by a device of another user gives 401", async () => {
    await env.DB.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind("user_other_id", "user_other", NOW, "user_other_id")
      .run();
    const other = await makeTestDevice("dev_other");
    await insertDevice(env.DB, other, { userId: "user_other_id" });
    const init = await signedInit(other, { method: "POST", path: "/v1/tasks/explain", body: {}, now: NOW });
    const res = await setup().request("/v1/tasks/explain", { ...init, headers: await authed(init.headers as Record<string, string>) }, env);
    expect(res.status).toBe(401);
  });

  test("POST /v1/tasks/quote with a valid key, no Waypoint headers and body {} gives 400 invalid request, not 401", async () => {
    const res = await setup().request("/v1/tasks/quote", { method: "POST", headers: await authed({ "Idempotency-Key": VALID_KEY }), body: "{}" }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
  });

  test("POST /v1/x with a valid key and no Waypoint headers gives 200", async () => {
    const res = await setup().request("/v1/x", { method: "POST", headers: await authed({ "Idempotency-Key": VALID_KEY }) }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });
});
