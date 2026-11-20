import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { requireDeviceSignature, type SignatureOptions } from "../src/auth/signature.ts";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { Db } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { freshNonce, insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const WINDOW = 5 * 60 * 1000;
const BODY = { secret: "text the server must not store" };

function userOf(id: string): SessionUser {
  return { id, clerk_id: `clerk_${id}`, plan: "free", billing_account_id: `ba_${id}`, zero_retention: false };
}

// A DB with users u1 and u2.
async function fixture(): Promise<Db> {
  const db = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind(id, `clerk_${id}`, NOW, `ba_${id}`)
      .run();
  }
  return db;
}

// A throwaway POST /v1/x behind the middleware; it answers with the signed device and the body it read.
function appFor(user: SessionUser, options?: SignatureOptions, now = NOW) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.post("/v1/x", requireDeviceSignature({ now: () => now }, options), async (c) =>
    c.json({ device: c.get("device"), body: await c.req.json() }),
  );
  return app;
}

async function send(db: Db, init: RequestInit, user = userOf("u1"), options?: SignatureOptions) {
  return appFor(user, options).request("/v1/x", init, { DB: db });
}

const UNAUTHORIZED = { code: "unauthorized", message: "device signature required", retry_after: null };

describe("requireDeviceSignature", () => {
  test("a good signature reaches the route, sets c.get(\"device\") and the handler can still read the body", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    const response = await send(db, init);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      device: { id: "dev_one", user_id: "u1", kind: "device", approved: true },
      body: BODY,
    });
  });

  test("the same nonce twice: the second request is 401", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW, nonce: "AAAAAAAAAAAAAAAAAAAAAA" });
    expect((await send(db, init)).status).toBe(200);
    expect((await send(db, init)).status).toBe(401);
  });

  test("a timestamp 300,000 ms early or late passes", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    for (const timestamp of [NOW - WINDOW, NOW + WINDOW]) {
      const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: timestamp });
      expect((await send(db, init)).status).toBe(200);
    }
  });

  test("a timestamp 300,001 ms early or late fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    for (const timestamp of [NOW - WINDOW - 1, NOW + WINDOW + 1]) {
      const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: timestamp });
      const response = await send(db, init);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual(UNAUTHORIZED);
    }
  });

  test("a changed body fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, { ...init, body: JSON.stringify({ secret: "changed" }) })).status).toBe(401);
  });

  test("another path fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/other", body: BODY, now: NOW });
    expect((await send(db, init)).status).toBe(401);
  });

  test("another method fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "PUT", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, { ...init, method: "POST" })).status).toBe(401);
  });

  test("a key that is not the stored one fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    const other = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(other, { method: "POST", path: "/v1/x", body: BODY, now: NOW, as: "dev_one" });
    expect((await send(db, init)).status).toBe(401);
  });

  test("an unknown device fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_missing");
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, init)).status).toBe(401);
  });

  test("another user's device fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_two");
    await insertDevice(db, device, { userId: "u2" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, init, userOf("u1"))).status).toBe(401);
  });

  test("a removed device fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1", removedAt: NOW - 1 });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, init)).status).toBe(401);
  });

  test("a pending device and the account row fail by default and pass with allowPending / allowAccount", async () => {
    const db = await fixture();
    const pending = await makeTestDevice("dev_pending");
    const account = await makeTestDevice("dev_account");
    await insertDevice(db, pending, { userId: "u1", approvedAt: null });
    await insertDevice(db, account, { userId: "u1", kind: "account" });
    const pendingInit = await signedInit(pending, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    const accountInit = await signedInit(account, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, pendingInit)).status).toBe(401);
    expect((await send(db, accountInit)).status).toBe(401);
    const pendingOk = await send(db, pendingInit, userOf("u1"), { allowPending: true });
    expect(pendingOk.status).toBe(200);
    expect(await pendingOk.json()).toMatchObject({ device: { id: "dev_pending", kind: "device", approved: false } });
    const accountOk = await send(db, accountInit, userOf("u1"), { allowAccount: true });
    expect(accountOk.status).toBe(200);
    expect(await accountOk.json()).toMatchObject({ device: { id: "dev_account", kind: "account", approved: true } });
  });

  test("each of the four headers missing fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    for (const name of ["Waypoint-Device", "Waypoint-Timestamp", "Waypoint-Nonce", "Waypoint-Signature"]) {
      const headers = { ...(init.headers as Record<string, string>) };
      delete headers[name];
      expect((await send(db, { ...init, headers })).status, name).toBe(401);
    }
  });

  test("a signature that is not base64url fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    const headers = { ...(init.headers as Record<string, string>), "Waypoint-Signature": "not base64url!" };
    expect((await send(db, { ...init, headers })).status).toBe(401);
  });

  test("a 3-character nonce fails", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    const headers = { ...(init.headers as Record<string, string>), "Waypoint-Nonce": "abc" };
    expect((await send(db, { ...init, headers })).status).toBe(401);
  });

  test("every failure body is exactly the 401 unauthorized reply", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    const response = await send(db, { ...init, body: JSON.stringify({ secret: "changed" }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(UNAUTHORIZED);
  });

  test("a request with a bad signature does not store its nonce, so the same nonce works with the right key", async () => {
    const db = await fixture();
    const device: TestDevice = await makeTestDevice("dev_one");
    const wrong = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const nonce = freshNonce();
    const bad = await signedInit(wrong, { method: "POST", path: "/v1/x", body: BODY, now: NOW, nonce, as: "dev_one" });
    expect((await send(db, bad)).status).toBe(401);
    const good = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW, nonce });
    expect((await send(db, good)).status).toBe(200);
  });

  test("an expired nonce row of that device is deleted by the next good request", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    await db
      .prepare("INSERT INTO request_nonces (device_id, nonce, expires_at) VALUES (?, ?, ?)")
      .bind("dev_one", "old-nonce", NOW - 1)
      .run();
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, init)).status).toBe(200);
    const left = await db.prepare("SELECT nonce FROM request_nonces WHERE nonce = ?").bind("old-nonce").first();
    expect(left).toBeNull();
  });

  test("no row of request_nonces holds the signature or the body", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, init)).status).toBe(200);
    const signature = (init.headers as Record<string, string>)["Waypoint-Signature"] ?? "";
    const bodyText = String(init.body);
    const { results } = await db.prepare("SELECT * FROM request_nonces").all<Record<string, unknown>>();
    expect(results.length).toBe(1);
    for (const row of results) {
      for (const value of Object.values(row)) {
        expect(String(value)).not.toContain(signature);
        expect(String(value)).not.toContain(bodyText);
      }
    }
  });

  test("a request accepted at NOW is 401 when the same request is sent again with the clock at NOW + 300,000", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, init)).status).toBe(200);
    const late = await appFor(userOf("u1"), undefined, NOW + WINDOW).request("/v1/x", init, { DB: db });
    expect(late.status).toBe(401);
    expect(await late.json()).toEqual(UNAUTHORIZED);
  });

  test("a request signed for a query string is 401 with another query string, and with none", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    await insertDevice(db, device, { userId: "u1" });
    const app = appFor(userOf("u1"));
    const signed = await signedInit(device, { method: "POST", path: "/v1/x?a=1", body: BODY, now: NOW });
    expect((await app.request("/v1/x?a=1", signed, { DB: db })).status).toBe(200);
    expect((await app.request("/v1/x?a=2", signed, { DB: db })).status).toBe(401);
    expect((await app.request("/v1/x", signed, { DB: db })).status).toBe(401);
    const bare = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await app.request("/v1/x?a=2", bare, { DB: db })).status).toBe(401);
  });

  test("a good request deletes no expired nonce row of another device", async () => {
    const db = await fixture();
    const device = await makeTestDevice("dev_one");
    const other = await makeTestDevice("dev_two");
    await insertDevice(db, device, { userId: "u1" });
    await insertDevice(db, other, { userId: "u1" });
    await db
      .prepare("INSERT INTO request_nonces (device_id, nonce, expires_at) VALUES (?, ?, ?)")
      .bind("dev_two", "other-old-nonce", NOW - 1)
      .run();
    const init = await signedInit(device, { method: "POST", path: "/v1/x", body: BODY, now: NOW });
    expect((await send(db, init)).status).toBe(200);
    const left = await db.prepare("SELECT nonce FROM request_nonces WHERE device_id = ? AND nonce = ?").bind("dev_two", "other-old-nonce").first();
    expect(left).not.toBeNull();
  });
});
