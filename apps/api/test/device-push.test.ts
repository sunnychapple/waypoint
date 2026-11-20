import { accountKeyInfo, deviceCertificateInput, fromBase64Url, makeEnvelope, pairingCommitment, PURPOSE_ACCOUNT_KEY, toBase64Url } from "@waypoint/crypto";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import { pairingRoutes } from "../src/devices/pairing.ts";
import { devicesRoute } from "../src/devices/register.ts";
import { removeDeviceRoute } from "../src/devices/remove.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { PushMessage, PushQueue } from "../src/push/messages.ts";
import type { BatchDb } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, selfCertFor, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const U1: SessionUser = { id: "u1", clerk_id: "clerk_u1", plan: "free", billing_account_id: "ba_u1", zero_retention: false };

type World = { db: BatchDb; account: TestDevice; phone: TestDevice; tablet: TestDevice; ipad: TestDevice; pushes: PushMessage[]; queue: PushQueue };

// u1 has an account row and two approved devices (phone_0001, tablet_0001), plus a removed device and a pending one;
// u2 has an approved device. ipad_0001 is not registered yet.
async function world(options: { queueFails?: boolean } = {}): Promise<World> {
  const db = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)").bind(id, `clerk_${id}`, NOW, `ba_${id}`).run();
  }
  const account = await makeTestDevice("acct_0001");
  const phone = await makeTestDevice("phone_0001");
  const tablet = await makeTestDevice("tablet_0001");
  const ipad = await makeTestDevice("ipad_0001");
  await insertDevice(db, account, { userId: "u1", kind: "account" });
  await insertDevice(db, phone, { userId: "u1" });
  await insertDevice(db, tablet, { userId: "u1" });
  await insertDevice(db, await makeTestDevice("old_00001"), { userId: "u1", removedAt: NOW - 1 });
  await insertDevice(db, await makeTestDevice("wait_0001"), { userId: "u1", approvedAt: null });
  await insertDevice(db, await makeTestDevice("other_0001"), { userId: "u2" });
  const pushes: PushMessage[] = [];
  const queue: PushQueue = {
    send: async (message) => {
      if (options.queueFails === true) throw new Error("queue down");
      pushes.push(message);
    },
  };
  return { db, account, phone, tablet, ipad, pushes, queue };
}

function app() {
  const a = new Hono<AppEnv>();
  a.onError(handleError);
  a.use(async (c, next) => {
    c.set("user", U1);
    await next();
  });
  a.route("/", devicesRoute({ now: () => NOW }));
  a.route("/", pairingRoutes({ now: () => NOW }));
  a.route("/", removeDeviceRoute({ now: () => NOW }));
  return a;
}

async function registerIpad(w: World, key = crypto.randomUUID()) {
  const path = "/v1/devices";
  const body = { id: "ipad_0001", name: "iPad", platform: "ios", sign_pub: w.ipad.signPub, box_pub: w.ipad.boxPub, commitment: await pairingCommitment(w.ipad.signPub, w.ipad.boxPub, "A".repeat(43)) };
  return app().request(path, await signedInit(w.ipad, { method: "POST", path, body, now: NOW, as: "new", idempotencyKey: key }), { DB: w.db, PUSH_QUEUE: w.queue });
}

// The approve body for the iPad: a certificate from the account key, and the account key wrapped for the iPad by the phone.
async function approveBody(w: World) {
  const cert = toBase64Url(await w.account.sign(deviceCertificateInput("u1", "ipad_0001", w.ipad.signPub, w.ipad.boxPub)));
  const envelope = toBase64Url(
    await makeEnvelope({
      purpose: PURPOSE_ACCOUNT_KEY,
      info: accountKeyInfo("u1", "acct_0001", "ipad_0001"),
      recipientBoxPub: fromBase64Url(w.ipad.boxPub),
      key: new Uint8Array(64).fill(9),
      signerId: "phone_0001",
      sign: w.phone.sign,
    }),
  );
  return { cert, account_envelope: envelope, envelopes: [] };
}

// The new account key's rotation for the one remaining device, phone_0001 (the S1D rotation body).
async function rotation(w: World, next: TestDevice) {
  const cert = toBase64Url(await next.sign(deviceCertificateInput("u1", "phone_0001", w.phone.signPub, w.phone.boxPub)));
  const envelope = toBase64Url(
    await makeEnvelope({
      purpose: PURPOSE_ACCOUNT_KEY,
      info: accountKeyInfo("u1", "acct_0002", "phone_0001"),
      recipientBoxPub: fromBase64Url(w.phone.boxPub),
      key: new Uint8Array(64).fill(5),
      signerId: "phone_0001",
      sign: w.phone.sign,
    }),
  );
  return { account: { id: "acct_0002", sign_pub: next.signPub, box_pub: next.boxPub, self_cert: await selfCertFor(next, "u1", "acct_0002") }, devices: [{ id: "phone_0001", cert, account_envelope: envelope }] };
}

// Push tokens for the phone and the tablet of u1, and for the waiting device's id under u2 (a different user).
async function seedTokens(w: World): Promise<void> {
  for (const [user, device] of [
    ["u1", "phone_0001"],
    ["u1", "tablet_0001"],
    ["u1", "wait_0001"],
    ["u2", "wait_0001"],
  ]) {
    await w.db
      .prepare("INSERT INTO push_tokens (user_id, device_id, token, environment, updated_at) VALUES (?, ?, ?, 'sandbox', ?)")
      .bind(user, device, `tok_${user}_${device}`, NOW)
      .run();
  }
}

describe("S1F device pushes and push-token cleanup", () => {
  test("registering the iPad sends device_request to each approved device, in id order, and nothing to the others", async () => {
    const w = await world();
    const res = await registerIpad(w);
    expect(res.status).toBe(201);
    expect(w.pushes).toEqual([
      { user_id: "u1", kind: "device_request", ref: "ipad_0001", device_id: "phone_0001" },
      { user_id: "u1", kind: "device_request", ref: "ipad_0001", device_id: "tablet_0001" },
    ]);
  });

  test("the same registration again with the same key gives the stored 201 and sends nothing more", async () => {
    const w = await world();
    const key = crypto.randomUUID();
    expect((await registerIpad(w, key)).status).toBe(201);
    const again = await registerIpad(w, key);
    expect(again.status).toBe(201);
    expect(w.pushes).toHaveLength(2);
  });

  test("registering with a queue that throws still gives 201 and the row exists", async () => {
    const w = await world();
    const failing: World = { ...w, queue: { send: async () => { throw new Error("queue down"); } } };
    expect((await registerIpad(failing)).status).toBe(201);
    const row = await w.db.prepare("SELECT id FROM devices WHERE id = ?").bind("ipad_0001").first<{ id: string }>();
    expect(row).toEqual({ id: "ipad_0001" });
  });

  test("registering an id that is already taken gives 409 and sends nothing", async () => {
    const w = await world();
    expect((await registerIpad(w)).status).toBe(201);
    expect(w.pushes).toHaveLength(2);
    const taken = await registerIpad(w);
    expect(taken.status).toBe(409);
    expect(w.pushes).toHaveLength(2);
  });

  test("a first device (no account row yet) sends nothing", async () => {
    const w = await world();
    await w.db.prepare("DELETE FROM devices WHERE user_id = ?").bind("u1").run();
    const path = "/v1/devices";
    const cert = toBase64Url(await w.account.sign(deviceCertificateInput("u1", "ipad_0001", w.ipad.signPub, w.ipad.boxPub)));
    const body = {
      id: "ipad_0001",
      name: "iPad",
      platform: "ios",
      sign_pub: w.ipad.signPub,
      box_pub: w.ipad.boxPub,
      account: { id: "acct_0001", sign_pub: w.account.signPub, box_pub: w.account.boxPub, cert, self_cert: await selfCertFor(w.account, "u1", "acct_0001") },
    };
    const res = await app().request(path, await signedInit(w.ipad, { method: "POST", path, body, now: NOW, as: "new" }), { DB: w.db, PUSH_QUEUE: w.queue });
    expect(res.status).toBe(201);
    expect(w.pushes).toEqual([]);
  });

  test("approving the iPad sends exactly one device_approved to the iPad", async () => {
    const w = await world();
    await registerIpad(w);
    w.pushes.splice(0);
    await w.db
      .prepare("UPDATE device_pairings SET approver_id = ?, approver_nonce = ?, device_nonce = ? WHERE device_id = ?")
      .bind("phone_0001", "B".repeat(43), "C".repeat(43), "ipad_0001")
      .run();
    const path = "/v1/devices/ipad_0001/approve";
    const res = await app().request(path, await signedInit(w.phone, { method: "POST", path, body: await approveBody(w), now: NOW }), { DB: w.db, PUSH_QUEUE: w.queue });
    expect(res.status).toBe(200);
    expect(w.pushes).toEqual([{ user_id: "u1", kind: "device_approved", ref: "ipad_0001", device_id: "ipad_0001" }]);
  });

  test("an approval refused with 409 (pairing not finished) sends nothing", async () => {
    const w = await world();
    await registerIpad(w);
    w.pushes.splice(0);
    await w.db.prepare("UPDATE device_pairings SET approver_id = ? WHERE device_id = ?").bind("phone_0001", "ipad_0001").run();
    const path = "/v1/devices/ipad_0001/approve";
    const res = await app().request(path, await signedInit(w.phone, { method: "POST", path, body: await approveBody(w), now: NOW }), { DB: w.db, PUSH_QUEUE: w.queue });
    expect(res.status).toBe(409);
    expect(w.pushes).toEqual([]);
  });

  test("approving with a queue that throws still gives 200 and the device is approved", async () => {
    const w = await world();
    await registerIpad(w);
    await w.db
      .prepare("UPDATE device_pairings SET approver_id = ?, approver_nonce = ?, device_nonce = ? WHERE device_id = ?")
      .bind("phone_0001", "B".repeat(43), "C".repeat(43), "ipad_0001")
      .run();
    const path = "/v1/devices/ipad_0001/approve";
    const failing: PushQueue = { send: async () => { throw new Error("queue down"); } };
    const res = await app().request(path, await signedInit(w.phone, { method: "POST", path, body: await approveBody(w), now: NOW }), { DB: w.db, PUSH_QUEUE: failing });
    expect(res.status).toBe(200);
    const row = await w.db.prepare("SELECT approved_at FROM devices WHERE id = ?").bind("ipad_0001").first<{ approved_at: number | null }>();
    expect(row?.approved_at).toBe(NOW);
  });

  test("removing the waiting device deletes its token row and keeps the phone's row and u2's row with the same device id", async () => {
    const w = await world();
    await seedTokens(w);
    const path = "/v1/devices/wait_0001";
    const res = await app().request(path, await signedInit(w.phone, { method: "DELETE", path, now: NOW }), { DB: w.db, PUSH_QUEUE: w.queue });
    expect(res.status).toBe(200);
    const rows = await w.db.prepare("SELECT user_id, device_id FROM push_tokens ORDER BY user_id, device_id").all<{ user_id: string; device_id: string }>();
    expect(rows.results).toEqual([
      { user_id: "u1", device_id: "phone_0001" },
      { user_id: "u1", device_id: "tablet_0001" },
      { user_id: "u2", device_id: "wait_0001" },
    ]);
  });

  test("removing the tablet with a new account key deletes the tablet's token row and keeps the phone's", async () => {
    const w = await world();
    await seedTokens(w);
    const next = await makeTestDevice("acct_0002");
    const path = "/v1/devices/tablet_0001";
    const res = await app().request(path, await signedInit(w.phone, { method: "DELETE", path, body: await rotation(w, next), now: NOW }), { DB: w.db, PUSH_QUEUE: w.queue });
    expect(res.status).toBe(200);
    const rows = await w.db.prepare("SELECT user_id, device_id FROM push_tokens WHERE user_id = ? ORDER BY device_id").bind("u1").all<{ user_id: string; device_id: string }>();
    expect(rows.results).toEqual([{ user_id: "u1", device_id: "phone_0001" }, { user_id: "u1", device_id: "wait_0001" }]);
  });

  test("the phone removing itself as the last approved device deletes the phone's token row", async () => {
    const w = await world();
    await seedTokens(w);
    await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = ?").bind(NOW, "tablet_0001").run();
    const path = "/v1/devices/phone_0001";
    const res = await app().request(path, await signedInit(w.phone, { method: "DELETE", path, now: NOW }), { DB: w.db, PUSH_QUEUE: w.queue });
    expect(res.status).toBe(200);
    const row = await w.db.prepare("SELECT device_id FROM push_tokens WHERE user_id = ? AND device_id = ?").bind("u1", "phone_0001").first();
    expect(row).toBeNull();
  });

  test("a refused removal (409, certificates must cover every remaining device) keeps the token row", async () => {
    const w = await world();
    await seedTokens(w);
    const next = await makeTestDevice("acct_0002");
    const body = await rotation(w, next);
    const path = "/v1/devices/tablet_0001";
    const wrong = { ...body, devices: [{ ...body.devices[0], id: "tablet_0001" }] };
    const res = await app().request(path, await signedInit(w.phone, { method: "DELETE", path, body: wrong, now: NOW }), { DB: w.db, PUSH_QUEUE: w.queue });
    expect(res.status).toBe(409);
    const row = await w.db.prepare("SELECT device_id FROM push_tokens WHERE user_id = ? AND device_id = ?").bind("u1", "tablet_0001").first();
    expect(row).toEqual({ device_id: "tablet_0001" });
  });
});
