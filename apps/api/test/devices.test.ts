import { deviceCertificateInput, toBase64Url } from "@waypoint/crypto";
import { DeviceListSchema, DeviceViewSchema, type ApiError } from "@waypoint/contracts";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { devicesRoute } from "../src/devices/register.ts";
import type { Db } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const COMMITMENT = "C".repeat(43);

type DeviceRowOut = {
  id: string;
  kind: string;
  approved_at: number | null;
  approved_by: string | null;
  cert: string | null;
  can_approve: number;
};

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

function appFor(user: SessionUser) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", devicesRoute({ now: () => NOW }));
  return app;
}

// Registers with the id "new" (the device is signed by its own key, which is sign_pub in the body).
async function postDevice(db: Db, userId: string, body: unknown, signer: TestDevice, idempotencyKey = crypto.randomUUID()) {
  const path = "/v1/devices";
  return appFor(userOf(userId)).request(
    path,
    await signedInit(signer, { method: "POST", path, body, now: NOW, as: "new", idempotencyKey }),
    { DB: db },
  );
}

// The account key signs the device's keys (the certificate the first device carries).
async function certFor(account: TestDevice, userId: string, device: TestDevice): Promise<string> {
  return toBase64Url(await account.sign(deviceCertificateInput(userId, device.id, device.signPub, device.boxPub)));
}

function firstBody(device: TestDevice, account: TestDevice, cert: string, accountId: string = account.id) {
  return {
    id: device.id,
    name: "Mina's iPhone",
    platform: "ios",
    sign_pub: device.signPub,
    box_pub: device.boxPub,
    account: { id: accountId, sign_pub: account.signPub, box_pub: account.boxPub, cert },
  };
}

function newBody(device: TestDevice, id: string = device.id) {
  return { id, name: "Sam's iPad", platform: "ios", sign_pub: device.signPub, box_pub: device.boxPub, commitment: COMMITMENT };
}

async function rowsOf(db: Db, userId: string): Promise<DeviceRowOut[]> {
  return (
    await db
      .prepare("SELECT id, kind, approved_at, approved_by, cert, can_approve FROM devices WHERE user_id = ? ORDER BY id")
      .bind(userId)
      .all<DeviceRowOut>()
  ).results;
}

// Seeds u1 with an account key row (the state after the first device).
async function seedAccount(db: Db, userId: string, account: TestDevice): Promise<void> {
  await insertDevice(db, account, { userId, kind: "account" });
}

describe("POST /v1/devices", () => {
  test("a first device gives 201, both rows are approved, and the reply passes DeviceViewSchema", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    const device = await makeTestDevice("device_1");
    const cert = await certFor(account, "u1", device);
    const res = await postDevice(db, "u1", firstBody(device, account, cert), device);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { device: unknown };
    expect(DeviceViewSchema.parse(body.device)).toMatchObject({ id: "device_1", kind: "device", approved_by: "account_1" });
    expect(await rowsOf(db, "u1")).toEqual([
      { id: "account_1", kind: "account", approved_at: NOW, approved_by: null, cert: null, can_approve: 1 },
      { id: "device_1", kind: "device", approved_at: NOW, approved_by: "account_1", cert, can_approve: 1 },
    ]);
  });

  test("a first device with a certificate from another key, or with account.id equal to id, gives 400 and no rows", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    const other = await makeTestDevice("other_1");
    const device = await makeTestDevice("device_1");
    const wrongCert = await certFor(other, "u1", device);
    const badCert = await postDevice(db, "u1", firstBody(device, account, wrongCert), device);
    expect(badCert.status).toBe(400);
    expect(await badCert.json()).toEqual({ code: "bad_request", message: "invalid certificate", retry_after: null });

    const sameId = await postDevice(db, "u1", firstBody(device, account, await certFor(account, "u1", device), device.id), device);
    expect(sameId.status).toBe(400);
    expect(await sameId.json()).toEqual({ code: "bad_request", message: "invalid certificate", retry_after: null });
    expect(await rowsOf(db, "u1")).toEqual([]);
  });

  test("a first device when the user already has an account row gives 409 and adds no rows", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    await seedAccount(db, "u1", account);
    const device = await makeTestDevice("device_1");
    const res = await postDevice(db, "u1", firstBody(device, account, await certFor(account, "u1", device)), device);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "account key already set", retry_after: null });
    expect((await rowsOf(db, "u1")).map((row) => row.id)).toEqual(["account_1"]);
  });

  test("a new device after the first gives 201, pending, with a pairing that expires in 600,000 ms", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    const first = await makeTestDevice("device_1");
    await postDevice(db, "u1", firstBody(first, account, await certFor(account, "u1", first)), first);
    const waiting = await makeTestDevice("device_2");
    const res = await postDevice(db, "u1", newBody(waiting), waiting);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { device: unknown };
    expect(DeviceViewSchema.parse(body.device)).toMatchObject({ id: "device_2", approved_at: null, approved_by: null });
    const pairings = await db
      .prepare("SELECT device_id, commitment, expires_at FROM device_pairings WHERE device_id = ?")
      .bind("device_2")
      .all<{ device_id: string; commitment: string; expires_at: number }>();
    expect(pairings.results).toEqual([{ device_id: "device_2", commitment: COMMITMENT, expires_at: NOW + 600_000 }]);
  });

  test("a new device when the user has no account row gives 409", async () => {
    const db = await fixture();
    const waiting = await makeTestDevice("device_2");
    const res = await postDevice(db, "u1", newBody(waiting), waiting);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "no account key yet", retry_after: null });
    expect(await rowsOf(db, "u1")).toEqual([]);
  });

  test("a fourth waiting device gives 429 with retry_after 600, and is accepted once one pairing has expired", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    await seedAccount(db, "u1", account);
    const waiting: TestDevice[] = [];
    for (const id of ["waiting_1", "waiting_2", "waiting_3"]) {
      const device = await makeTestDevice(id);
      waiting.push(device);
      expect((await postDevice(db, "u1", newBody(device), device)).status).toBe(201);
    }
    const fourth = await makeTestDevice("waiting_4");
    const limited = await postDevice(db, "u1", newBody(fourth), fourth);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ code: "rate_limited", message: "too many devices waiting", retry_after: 600 });

    await db
      .prepare("UPDATE device_pairings SET expires_at = ? WHERE device_id = ?")
      .bind(NOW - 1, "waiting_1")
      .run();
    expect((await postDevice(db, "u1", newBody(fourth), fourth)).status).toBe(201);
  });

  test("a device id already taken, by any user, gives 409", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    await seedAccount(db, "u1", account);
    const taken = await makeTestDevice("taken_1");
    await insertDevice(db, taken, { userId: "u2" });
    const res = await postDevice(db, "u1", newBody(taken), taken);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "device id taken", retry_after: null });
    expect((await rowsOf(db, "u2")).map((row) => row.id)).toEqual(["taken_1"]);
  });

  test("a body signed by a key other than sign_pub gives 401, and a sign_pub off the curve gives 400", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    await seedAccount(db, "u1", account);
    const device = await makeTestDevice("device_2");
    const impostor = await makeTestDevice("impostor_1");
    const unsigned = await postDevice(db, "u1", newBody(device), impostor);
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ code: "unauthorized", message: "device signature required", retry_after: null });

    const offCurve = { ...newBody(device), sign_pub: "A".repeat(87) };
    const bad = await postDevice(db, "u1", offCurve, device);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
  });

  test("a replay with the same Idempotency-Key and a fresh signature returns the stored 201 with no second row", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    await seedAccount(db, "u1", account);
    const device = await makeTestDevice("device_2");
    const key = "replay-key-00001";
    const first = await postDevice(db, "u1", newBody(device), device, key);
    expect(first.status).toBe(201);
    const firstText = await first.text();
    const replay = await postDevice(db, "u1", newBody(device), device, key);
    expect(replay.status).toBe(201);
    expect(await replay.text()).toBe(firstText);
    expect((await rowsOf(db, "u1")).map((row) => row.id)).toEqual(["account_1", "device_2"]);
    const pairings = await db.prepare("SELECT COUNT(*) AS n FROM device_pairings").first<{ n: number }>();
    expect(pairings?.n).toBe(1);
  });

  test("a device id of \"new\" gives 400 and no row, because \"new\" is reserved for the signature", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    await seedAccount(db, "u1", account);
    const device = await makeTestDevice("device_2");
    const res = await postDevice(db, "u1", newBody(device, "new"), device);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
    expect((await rowsOf(db, "u1")).map((row) => row.id)).toEqual(["account_1"]);
  });

  test("a 65-byte key that starts 0x04 but is off the curve gives 400 and no row, for box_pub and for the account's two keys", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    const device = await makeTestDevice("device_1");
    const offCurve = toBase64Url(new Uint8Array([4, ...new Array<number>(64).fill(1)]));
    const body = firstBody(device, account, await certFor(account, "u1", device));
    const cases = [
      { ...body, box_pub: offCurve },
      { ...body, account: { ...body.account, sign_pub: offCurve } },
      { ...body, account: { ...body.account, box_pub: offCurve } },
    ];
    for (const bad of cases) {
      const res = await postDevice(db, "u1", bad, device);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
    }
    expect(await rowsOf(db, "u1")).toEqual([]);
  });

  test("a waiting device is stored with can_approve 0", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    await seedAccount(db, "u1", account);
    const waiting = await makeTestDevice("device_2");
    expect((await postDevice(db, "u1", newBody(waiting), waiting)).status).toBe(201);
    expect((await rowsOf(db, "u1")).find((row) => row.id === "device_2")?.can_approve).toBe(0);
  });

  test("a user whose only account row is removed can register a first device with an account", async () => {
    const db = await fixture();
    await insertDevice(db, await makeTestDevice("account_0"), { userId: "u1", kind: "account", removedAt: NOW - 1 });
    const account = await makeTestDevice("account_1");
    const device = await makeTestDevice("device_1");
    const res = await postDevice(db, "u1", firstBody(device, account, await certFor(account, "u1", device)), device);
    expect(res.status).toBe(201);
    expect((await rowsOf(db, "u1")).map((row) => row.id)).toEqual(["account_0", "account_1", "device_1"]);
  });

  test("with three waiting devices, a fourth is 201 once one of them is approved, and again once one is removed", async () => {
    const db = await fixture();
    const account = await makeTestDevice("account_1");
    await seedAccount(db, "u1", account);
    for (const id of ["waiting_1", "waiting_2", "waiting_3"]) {
      const device = await makeTestDevice(id);
      expect((await postDevice(db, "u1", newBody(device), device)).status).toBe(201);
    }
    // waiting_1 is approved, so it no longer waits: two still wait and a fourth is accepted.
    await db.prepare("UPDATE devices SET approved_at = ?, approved_by = ? WHERE id = ?").bind(NOW, "account_1", "waiting_1").run();
    const fourth = await makeTestDevice("waiting_4");
    expect((await postDevice(db, "u1", newBody(fourth), fourth)).status).toBe(201);
    // waiting_2 is removed, so it no longer waits: waiting_3 and waiting_4 still wait and a fifth is accepted.
    await db.prepare("UPDATE devices SET removed_at = ? WHERE id = ?").bind(NOW, "waiting_2").run();
    const fifth = await makeTestDevice("waiting_5");
    expect((await postDevice(db, "u1", newBody(fifth), fifth)).status).toBe(201);
  });
});

describe("GET /v1/devices", () => {
  test("lists the user's non-removed rows in order, passes DeviceListSchema, and skips other users and removed rows", async () => {
    const db = await fixture();
    await insertDevice(db, await makeTestDevice("b_dev"), { userId: "u1" });
    await insertDevice(db, await makeTestDevice("a_dev"), { userId: "u1" });
    await insertDevice(db, await makeTestDevice("acc_u1"), { userId: "u1", kind: "account" });
    await insertDevice(db, await makeTestDevice("removed_1"), { userId: "u1", removedAt: NOW });
    await insertDevice(db, await makeTestDevice("other_1"), { userId: "u2" });
    const res = await appFor(userOf("u1")).request("/v1/devices", { method: "GET" }, { DB: db });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const list = DeviceListSchema.parse(body);
    expect(list.user_id).toBe("u1");
    expect(list.devices.map((device) => device.id)).toEqual(["a_dev", "acc_u1", "b_dev"]);
  });

  test("orders by added_at before id: the device added later comes last, whatever its id", async () => {
    const db = await fixture();
    await insertDevice(db, await makeTestDevice("a_dev"), { userId: "u1" });
    await insertDevice(db, await makeTestDevice("b_dev"), { userId: "u1" });
    await db.prepare("UPDATE devices SET added_at = ? WHERE id = ?").bind(NOW + 1, "a_dev").run();
    await db.prepare("UPDATE devices SET added_at = ? WHERE id = ?").bind(NOW, "b_dev").run();
    const res = await appFor(userOf("u1")).request("/v1/devices", { method: "GET" }, { DB: db });
    expect(res.status).toBe(200);
    const list = DeviceListSchema.parse(await res.json());
    expect(list.devices.map((device) => device.id)).toEqual(["b_dev", "a_dev"]);
  });
});

describe("devices through createApp", () => {
  test("POST /v1/devices without a session gives 401", async () => {
    const app = createApp({
      fetchJwks: async () => ({ keys: [] }),
      now: () => NOW,
      newId: () => crypto.randomUUID(),
    });
    const env = {
      DB: createTestDb(),
      CONFIG: {} as KVNamespace,
      CLERK_ISSUER: "https://clerk.example.com",
      CLERK_AUTHORIZED_PARTIES: "",
    };
    const res = await app.request("/v1/devices", { method: "POST", headers: { "Idempotency-Key": "key-0001-abcdefgh" } }, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiError;
    expect(body.code).toBe("unauthorized");
  });
});
