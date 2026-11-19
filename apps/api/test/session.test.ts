import { beforeAll, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { createTestDb } from "./helpers/d1.ts";

const ISSUER = "https://clerk.example.com";
const NOW = 1_800_000_000_000;
const VALID_KEY = "abcdefghijklmnop";

let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string };

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sessionToken(sub = "user_123", key: CryptoKey = privateKey): Promise<string> {
  const encode = (value: object): string => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const signingInput = `${encode({ alg: "RS256", kid: "k1", typ: "JWT" })}.${encode({
    iss: ISSUER,
    sub,
    nbf: NOW / 1000 - 60,
    exp: NOW / 1000 + 60,
  })}`;
  const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
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

function setup(fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({ keys: [publicJwk] }))) {
  const app = createApp({ fetchJwks, now: () => NOW, newId: () => crypto.randomUUID() });
  app.get("/v1/me", (c) => c.json(c.get("user")));
  app.post("/v1/x", (c) => c.json({ reached: true }));
  return { app, fetchJwks };
}

function envWith(db = createTestDb()) {
  return { DB: db, CONFIG: {} as KVNamespace, CLERK_ISSUER: ISSUER, CLERK_AUTHORIZED_PARTIES: "" };
}

describe("requireSession", () => {
  test("no Authorization header gives 401", async () => {
    const { app } = setup();
    const res = await app.request("/v1/me", {}, envWith());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "sign in required", retry_after: null });
  });

  test("a Basic Authorization header gives 401", async () => {
    const { app } = setup();
    const res = await app.request("/v1/me", { headers: { Authorization: "Basic dXNlcjpwYXNz" } }, envWith());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "sign in required", retry_after: null });
  });

  test("a bad token gives 401", async () => {
    const { app } = setup();
    const token = await sessionToken("user_123", await otherKey());
    const res = await app.request("/v1/me", { headers: { Authorization: `Bearer ${token}` } }, envWith());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "sign in required", retry_after: null });
  });

  test("a good token reaches the route, and c.get('user') is the D1 user", async () => {
    const db = createTestDb();
    const { app } = setup();
    const token = await sessionToken();
    const res = await app.request("/v1/me", { headers: { Authorization: `Bearer ${token}` } }, envWith(db));
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = await db.prepare("SELECT id, clerk_id, plan, billing_account_id, zero_retention FROM users").first();
    expect(body).toEqual({ ...row, zero_retention: false });
    expect(body).toEqual({
      id: expect.any(String),
      clerk_id: "user_123",
      plan: "free",
      billing_account_id: expect.any(String),
      zero_retention: false,
    });
  });

  test("a second request reuses the JWKS (one fetch)", async () => {
    const db = createTestDb();
    const { app, fetchJwks } = setup();
    const headers = { Authorization: `Bearer ${await sessionToken()}` };
    await app.request("/v1/me", { headers }, envWith(db));
    const res = await app.request("/v1/me", { headers }, envWith(db));
    expect(res.status).toBe(200);
    expect(fetchJwks).toHaveBeenCalledTimes(1);
  });

  test("GET /v1/config with no header is not 401 (it is 404 until PR 09)", async () => {
    const { app } = setup();
    const res = await app.request("/v1/config", {}, envWith());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found", message: "no such endpoint", retry_after: null });
  });

  test("a write with a good token and no Idempotency-Key gives 400", async () => {
    const { app } = setup();
    const headers = { Authorization: `Bearer ${await sessionToken()}` };
    const res = await app.request("/v1/x", { method: "POST", headers }, envWith());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: "bad_request",
      message: "Idempotency-Key header required",
      retry_after: null,
    });
  });

  test("a write with a good token and a valid Idempotency-Key reaches the route", async () => {
    const { app } = setup();
    const headers = { Authorization: `Bearer ${await sessionToken()}`, "Idempotency-Key": VALID_KEY };
    const res = await app.request("/v1/x", { method: "POST", headers }, envWith());
    expect(res.status).toBe(200);
  });

  test("a write with no token and no Idempotency-Key gives 401", async () => {
    const { app } = setup();
    const res = await app.request("/v1/x", { method: "POST" }, envWith());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "sign in required", retry_after: null });
  });
});

async function otherKey(): Promise<CryptoKey> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in pair)) throw new Error("expected a key pair");
  return pair.privateKey;
}
