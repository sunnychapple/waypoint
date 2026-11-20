import { RecoveryViewSchema, type ApiError } from "@waypoint/contracts";
import { recoveryWrapKey, toBase64Url, wrapAccountKey } from "@waypoint/crypto";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { recoveryRoute } from "../src/recovery/route.ts";
import type { Db } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;

function userOf(id: string): SessionUser {
  return { id, clerk_id: `clerk_${id}`, plan: "free", billing_account_id: `ba_${id}`, zero_retention: false };
}

function appFor(user: SessionUser) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", recoveryRoute({ now: () => NOW }));
  return app;
}

// u1 has an active account key row, one approved phone and (in some tests) one waiting phone.
async function fixture(): Promise<{ db: Db; account: TestDevice; phone: TestDevice }> {
  const db = createTestDb();
  await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)").bind("u1", "clerk_u1", NOW, "ba_u1").run();
  const account = await makeTestDevice("acct_1");
  const phone = await makeTestDevice("dev_1");
  await insertDevice(db, account, { userId: "u1", kind: "account" });
  await insertDevice(db, phone, { userId: "u1" });
  return { db, account, phone };
}

// A blob the way the iPhone makes it: 12 words' worth of entropy, wrapped for user u1 and account row acct_1.
async function makeBlob(accountId: string, userId = "u1"): Promise<string> {
  const entropy = crypto.getRandomValues(new Uint8Array(16));
  const wrapKey = await recoveryWrapKey(entropy, userId);
  const blob = await wrapAccountKey({
    wrapKey,
    userId,
    accountDeviceId: accountId,
    accountKey: crypto.getRandomValues(new Uint8Array(64)),
    nonce: crypto.getRandomValues(new Uint8Array(12)),
  });
  return toBase64Url(blob);
}

function putRequest(phone: TestDevice, body: unknown) {
  return signedInit(phone, { method: "PUT", path: "/v1/recovery", body, now: NOW });
}

describe("PUT and GET /v1/recovery", () => {
  test("PUT with verified true returns the account row and time; GET returns the blob, the account keys and verified_at", async () => {
    const { db, account, phone } = await fixture();
    const blob = await makeBlob("acct_1");
    const put = await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(phone, { account_device_id: "acct_1", wrapped_account_key: blob, verified: true }),
      { DB: db },
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ account_device_id: "acct_1", verified_at: NOW });

    const get = await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db });
    expect(get.status).toBe(200);
    const view = await get.json();
    expect(RecoveryViewSchema.safeParse(view).success).toBe(true);
    expect(view).toEqual({
      account_device_id: "acct_1",
      sign_pub: account.signPub,
      box_pub: account.boxPub,
      wrapped_account_key: blob,
      verified_at: NOW,
    });
  });

  test("PUT again with verified false replaces the blob and sets verified_at to null, still one row", async () => {
    const { db, phone } = await fixture();
    const first = await makeBlob("acct_1");
    const second = await makeBlob("acct_1");
    await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(phone, { account_device_id: "acct_1", wrapped_account_key: first, verified: true }),
      { DB: db },
    );
    const again = await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(phone, { account_device_id: "acct_1", wrapped_account_key: second, verified: false }),
      { DB: db },
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ account_device_id: "acct_1", verified_at: null });

    const view = (await (await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db })).json()) as { wrapped_account_key: string; verified_at: number | null };
    expect(view.wrapped_account_key).toBe(second);
    expect(view.verified_at).toBeNull();
    const rows = await db.prepare("SELECT count(*) AS n FROM recovery WHERE user_id = ?").bind("u1").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  test("an account_device_id that is not the active account row (another id, or a removed account row) gets 409 and nothing is stored", async () => {
    const { db, phone } = await fixture();
    await insertDevice(db, await makeTestDevice("acct_old"), { userId: "u1", kind: "account", removedAt: NOW - 1 });
    const blob = await makeBlob("acct_1");
    for (const wrong of ["dev_1", "acct_old"]) {
      const res = await appFor(userOf("u1")).request(
        "/v1/recovery",
        await putRequest(phone, { account_device_id: wrong, wrapped_account_key: blob, verified: true }),
        { DB: db },
      );
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiError).code).toBe("conflict");
    }
    const rows = await db.prepare("SELECT count(*) AS n FROM recovery WHERE user_id = ?").bind("u1").first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  test("a blob with version byte 2, 92 bytes, or characters outside base64url gets 400", async () => {
    const { db, phone } = await fixture();
    const good = await makeBlob("acct_1");
    const bytes = Uint8Array.from(atob(good.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    bytes[0] = 2;
    const version2 = toBase64Url(bytes);
    const short = toBase64Url(bytes.slice(0, 92));
    const notBase64Url = "+".repeat(124);
    for (const wrapped of [version2, short, notBase64Url]) {
      const res = await appFor(userOf("u1")).request(
        "/v1/recovery",
        await putRequest(phone, { account_device_id: "acct_1", wrapped_account_key: wrapped, verified: true }),
        { DB: db },
      );
      expect(res.status).toBe(400);
    }
  });

  test("GET gets 404 with no recovery row, and again after the account row is replaced", async () => {
    const { db, phone } = await fixture();
    const before = await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db });
    expect(before.status).toBe(404);

    const blob = await makeBlob("acct_1");
    await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(phone, { account_device_id: "acct_1", wrapped_account_key: blob, verified: true }),
      { DB: db },
    );
    expect((await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db })).status).toBe(200);

    // What S1D does when the account key is rotated: old row removed, new row inserted, recovery deleted.
    await db.prepare("UPDATE devices SET removed_at = ? WHERE id = ?").bind(NOW, "acct_1").run();
    await insertDevice(db, await makeTestDevice("acct_2"), { userId: "u1", kind: "account" });
    await db.prepare("DELETE FROM recovery WHERE user_id = ?").bind("u1").run();
    const after = await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db });
    expect(after.status).toBe(404);
  });

  test("a waiting device's session can GET; PUT signed by a waiting device, or with no signature, gets 401", async () => {
    const { db, phone } = await fixture();
    const waiting = await makeTestDevice("dev_waiting");
    await insertDevice(db, waiting, { userId: "u1", approvedAt: null });
    const blob = await makeBlob("acct_1");
    await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(phone, { account_device_id: "acct_1", wrapped_account_key: blob, verified: true }),
      { DB: db },
    );
    const get = await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db });
    expect(get.status).toBe(200);

    const signedByWaiting = await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(waiting, { account_device_id: "acct_1", wrapped_account_key: blob, verified: false }),
      { DB: db },
    );
    expect(signedByWaiting.status).toBe(401);

    const unsigned = await appFor(userOf("u1")).request(
      "/v1/recovery",
      { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": "idem-unsigned" }, body: JSON.stringify({ account_device_id: "acct_1", wrapped_account_key: blob, verified: false }) },
      { DB: db },
    );
    expect(unsigned.status).toBe(401);
  });

  test("the reply and D1 hold only the blob as it was sent, not a decoded or re-encoded copy", async () => {
    const { db, phone } = await fixture();
    const blob = await makeBlob("acct_1");
    const put = await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(phone, { account_device_id: "acct_1", wrapped_account_key: blob, verified: true }),
      { DB: db },
    );
    const putText = await put.text();
    expect(putText).not.toContain(blob);
    expect(Object.keys(JSON.parse(putText)).sort()).toEqual(["account_device_id", "verified_at"]);

    const stored = await db.prepare("SELECT wrapped_account_key FROM recovery WHERE user_id = ?").bind("u1").first<{ wrapped_account_key: string }>();
    expect(stored?.wrapped_account_key).toBe(blob);
    const get = await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db });
    expect(((await get.json()) as { wrapped_account_key: string }).wrapped_account_key).toBe(blob);
  });

  test("u1 reads only u1's recovery row and account keys, and cannot point a PUT at u0's account row", async () => {
    const db = createTestDb();
    // u0 is set up first: u0 sorts before u1, and the partial index on devices(user_id) and the recovery primary key both walk in user_id order, so a query that ignores user_id finds u0 first.
    for (const id of ["u0", "u1"]) {
      await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)").bind(id, `clerk_${id}`, NOW, `ba_${id}`).run();
    }
    const account2 = await makeTestDevice("acct_2");
    await insertDevice(db, account2, { userId: "u0", kind: "account" });
    await db
      .prepare("INSERT INTO recovery (user_id, wrapped_account_key, verified_at) VALUES ('u0', ?, ?)")
      .bind(await makeBlob("acct_2", "u0"), NOW)
      .run();
    const account = await makeTestDevice("acct_1");
    const phone = await makeTestDevice("dev_1");
    await insertDevice(db, account, { userId: "u1", kind: "account" });
    await insertDevice(db, phone, { userId: "u1" });
    const blob = await makeBlob("acct_1");
    const put = await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(phone, { account_device_id: "acct_1", wrapped_account_key: blob, verified: true }),
      { DB: db },
    );
    expect(put.status).toBe(200);

    const get = await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      account_device_id: "acct_1",
      sign_pub: account.signPub,
      box_pub: account.boxPub,
      wrapped_account_key: blob,
      verified_at: NOW,
    });

    const steal = await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(phone, { account_device_id: "acct_2", wrapped_account_key: await makeBlob("acct_2", "u0"), verified: false }),
      { DB: db },
    );
    expect(steal.status).toBe(409);
    const after = (await (await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db })).json()) as { wrapped_account_key: string };
    expect(after.wrapped_account_key).toBe(blob);
  });

  test("GET returns the active account row's id and keys when a removed account row has a lower id", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', ?, 'ba_u1')").bind(NOW).run();
    // The removed row is inserted first and has the lower id.
    await insertDevice(db, await makeTestDevice("acct_0"), { userId: "u1", kind: "account", removedAt: NOW - 1 });
    const account = await makeTestDevice("acct_1");
    await insertDevice(db, account, { userId: "u1", kind: "account" });
    const blob = await makeBlob("acct_1");
    await db
      .prepare("INSERT INTO recovery (user_id, wrapped_account_key, verified_at) VALUES ('u1', ?, ?)")
      .bind(blob, NOW)
      .run();
    const get = await appFor(userOf("u1")).request("/v1/recovery", {}, { DB: db });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      account_device_id: "acct_1",
      sign_pub: account.signPub,
      box_pub: account.boxPub,
      wrapped_account_key: blob,
      verified_at: NOW,
    });
  });
});
