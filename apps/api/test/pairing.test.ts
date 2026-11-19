import { DeviceViewSchema, PairingViewSchema, type ApiError } from "@waypoint/contracts";
import {
  accountKeyInfo,
  deviceCertificateInput,
  type EnvelopePurpose,
  fromBase64Url,
  groupKeyInfo,
  makeEnvelope,
  pairingCode,
  pairingCommitment,
  PURPOSE_ACCOUNT_KEY,
  PURPOSE_GROUP_KEY,
  toBase64Url,
} from "@waypoint/crypto";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import { devicesRoute } from "../src/devices/register.ts";
import { pairingRoutes } from "../src/devices/pairing.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { Db } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const TTL = 10 * 60 * 1000;
const PATH = "/v1/devices/ipad_1/pairing";
const APPROVE = "/v1/devices/ipad_1/approve";

function userOf(id: string): SessionUser {
  return { id, clerk_id: `clerk_${id}`, plan: "free", billing_account_id: `ba_${id}`, zero_retention: false };
}

function appFor(user: SessionUser, now: number = NOW) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", devicesRoute({ now: () => now }));
  app.route("/", pairingRoutes({ now: () => now }));
  return app;
}

function nonce(n: number): string {
  return toBase64Url(new Uint8Array(32).fill(n));
}

type World = {
  db: Db;
  account: TestDevice;
  phone: TestDevice;
  phone2: TestDevice;
  ipad: TestDevice;
  ipadNonce: string;
  phoneNonce: string;
};

// User u1 with an account key, an approved phone (in group g1 with one envelope) and a second approved phone.
// Group g2 belongs to u2 only. The iPad is not registered yet.
async function world(): Promise<World> {
  const db = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind(id, `clerk_${id}`, NOW, `ba_${id}`)
      .run();
  }
  const account = await makeTestDevice("acct_1");
  const phone = await makeTestDevice("phone_1");
  const phone2 = await makeTestDevice("phone_2");
  const ipad = await makeTestDevice("ipad_1");
  await insertDevice(db, account, { userId: "u1", kind: "account" });
  await insertDevice(db, phone, { userId: "u1" });
  await insertDevice(db, phone2, { userId: "u1" });
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES ('g1', 'shared', 'sealed', 1, 'u1')").run();
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES ('g2', 'shared', 'sealed', 1, 'u2')").run();
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g1', 'u1', 'owner', ?, ?)")
    .bind(NOW, NOW)
    .run();
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g2', 'u2', 'owner', ?, ?)")
    .bind(NOW, NOW)
    .run();
  await db.prepare("INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) VALUES ('g1', 1, 'phone_1', 'PHONE_ENVELOPE')").run();
  return { db, account, phone, phone2, ipad, ipadNonce: nonce(7), phoneNonce: nonce(3) };
}

// The iPad registers as a new device with its commitment (POST /v1/devices, signed with id "new").
async function register(w: World): Promise<Response> {
  const path = "/v1/devices";
  const body = {
    id: "ipad_1",
    name: "Sam's iPad",
    platform: "ios",
    sign_pub: w.ipad.signPub,
    box_pub: w.ipad.boxPub,
    commitment: await pairingCommitment(w.ipad.signPub, w.ipad.boxPub, w.ipadNonce),
  };
  return appFor(userOf("u1")).request(path, await signedInit(w.ipad, { method: "POST", path, body, now: NOW, as: "new" }), { DB: w.db });
}

async function send(w: World, signer: TestDevice, path: string, body: unknown, options: { userId?: string; now?: number } = {}): Promise<Response> {
  const now = options.now ?? NOW;
  return appFor(userOf(options.userId ?? "u1"), now).request(path, await signedInit(signer, { method: "POST", path, body, now }), { DB: w.db });
}

async function count(db: Db, sql: string, bind: string): Promise<number> {
  return (await db.prepare(sql).bind(bind).first<{ n: number }>())?.n ?? -1;
}

async function wrap(w: World, purpose: EnvelopePurpose, info: Uint8Array, signer: TestDevice, signerId: string, keyBytes: number): Promise<string> {
  const bytes = await makeEnvelope({
    purpose,
    info,
    recipientBoxPub: fromBase64Url(w.ipad.boxPub),
    key: new Uint8Array(keyBytes).fill(9),
    signerId,
    sign: signer.sign,
  });
  return toBase64Url(bytes);
}

async function certOf(w: World, signer: TestDevice): Promise<string> {
  return toBase64Url(await signer.sign(deviceCertificateInput("u1", "ipad_1", w.ipad.signPub, w.ipad.boxPub)));
}

async function errorOf(res: Response): Promise<ApiError> {
  return (await res.json()) as ApiError;
}

describe("S1C pairing and approval", () => {
  test("the whole flow: start, reveal, matching 6-digit codes, approve, and the rows it leaves", async () => {
    const w = await world();
    expect((await register(w)).status).toBe(201);

    const started = await send(w, w.phone, PATH, { nonce: w.phoneNonce });
    expect(started.status).toBe(200);
    const phoneView = PairingViewSchema.parse(await started.json());
    expect(phoneView.approver).toEqual({ id: "phone_1", sign_pub: w.phone.signPub });

    const revealed = await send(w, w.ipad, `${PATH}/reveal`, { nonce: w.ipadNonce });
    expect(revealed.status).toBe(200);
    const ipadView = PairingViewSchema.parse(await revealed.json());

    const ipadCode = await pairingCode({
      newSignPub: w.ipad.signPub,
      newBoxPub: w.ipad.boxPub,
      approverSignPub: ipadView.approver?.sign_pub ?? "",
      approverNonce: ipadView.approver_nonce ?? "",
      newNonce: ipadView.device_nonce ?? "",
    });
    const phoneCode = await pairingCode({
      newSignPub: w.ipad.signPub,
      newBoxPub: w.ipad.boxPub,
      approverSignPub: w.phone.signPub,
      approverNonce: w.phoneNonce,
      newNonce: w.ipadNonce,
    });
    expect(ipadCode).toBe(phoneCode);
    expect(phoneCode).toMatch(/^\d{6}$/);

    const cert = await certOf(w, w.account);
    const accountEnvelope = await wrap(w, PURPOSE_ACCOUNT_KEY, accountKeyInfo("u1", "acct_1", "ipad_1"), w.phone, "phone_1", 64);
    const groupEnvelope = await wrap(w, PURPOSE_GROUP_KEY, groupKeyInfo("g1", 1, "ipad_1"), w.phone, "phone_1", 32);
    const approved = await send(w, w.phone, APPROVE, { cert, account_envelope: accountEnvelope, envelopes: [{ group_id: "g1", key_version: 1, wrapped_key: groupEnvelope }] });
    expect(approved.status).toBe(200);
    const body = (await approved.json()) as { device: unknown };
    expect(DeviceViewSchema.parse(body.device)).toMatchObject({ id: "ipad_1", approved_by: "phone_1" });

    const row = await w.db
      .prepare("SELECT approved_at, approved_by, cert, account_envelope FROM devices WHERE id = ?")
      .bind("ipad_1")
      .first<{ approved_at: number; approved_by: string; cert: string; account_envelope: string }>();
    expect(row).toEqual({ approved_at: NOW, approved_by: "phone_1", cert, account_envelope: accountEnvelope });
    expect(await count(w.db, "SELECT COUNT(*) AS n FROM key_envelopes WHERE device_id = ?", "ipad_1")).toBe(1);
    expect(await count(w.db, "SELECT COUNT(*) AS n FROM device_pairings WHERE device_id = ?", "ipad_1")).toBe(0);
  });

  test("GET /v1/devices/:id/pairing gives 404 for another user's device, and 404 for a device with no pairing", async () => {
    const w = await world();
    await register(w);
    const otherUser = await appFor(userOf("u2")).request(PATH, { method: "GET" }, { DB: w.db });
    expect(otherUser.status).toBe(404);
    const noPairing = await appFor(userOf("u1")).request("/v1/devices/phone_1/pairing", { method: "GET" }, { DB: w.db });
    expect(noPairing.status).toBe(404);
  });

  test("start: by the iPad itself, or by a pending device, is refused with 401; a second start gives 409; after expiry 409; for an approved device 409", async () => {
    const w = await world();
    await register(w);
    // The iPad is pending, so the signature check refuses it with 401 before the self-approval check runs.
    // The card says 403 for this case; see the PR questions.
    const self = await send(w, w.ipad, PATH, { nonce: w.phoneNonce });
    expect(self.status).toBe(401);
    const pendingSigner = await send(w, w.ipad, "/v1/devices/phone_1/pairing", { nonce: w.phoneNonce });
    expect(pendingSigner.status).toBe(401);

    expect((await send(w, w.phone, PATH, { nonce: w.phoneNonce })).status).toBe(200);
    const twice = await send(w, w.phone2, PATH, { nonce: nonce(4) });
    expect(twice.status).toBe(409);
    expect(await errorOf(twice)).toMatchObject({ code: "conflict", message: "pairing already started" });

    const late = await send(w, w.phone, PATH, { nonce: nonce(5) }, { now: NOW + TTL });
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toMatchObject({ code: "conflict", message: "pairing expired" });

    const approvedTarget = await send(w, w.phone2, "/v1/devices/phone_1/pairing", { nonce: nonce(6) });
    expect(approvedTarget.status).toBe(409);
    expect(await errorOf(approvedTarget)).toMatchObject({ code: "conflict", message: "device already approved" });
  });

  test("reveal: before the approver's nonce 409; by the phone 403; the correct reveal 200 then again 409; a wrong nonce 409 and the pairing row is deleted", async () => {
    const w = await world();
    await register(w);
    const early = await send(w, w.ipad, `${PATH}/reveal`, { nonce: w.ipadNonce });
    expect(early.status).toBe(409);
    expect(await errorOf(early)).toMatchObject({ message: "no approver yet" });

    expect((await send(w, w.phone, PATH, { nonce: w.phoneNonce })).status).toBe(200);
    const byPhone = await send(w, w.phone, `${PATH}/reveal`, { nonce: w.ipadNonce });
    expect(byPhone.status).toBe(403);

    expect((await send(w, w.ipad, `${PATH}/reveal`, { nonce: w.ipadNonce })).status).toBe(200);
    const again = await send(w, w.ipad, `${PATH}/reveal`, { nonce: w.ipadNonce });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toMatchObject({ message: "already revealed" });

    const other = await world();
    await register(other);
    expect((await send(other, other.phone, PATH, { nonce: other.phoneNonce })).status).toBe(200);
    const wrong = await send(other, other.ipad, `${PATH}/reveal`, { nonce: nonce(8) });
    expect(wrong.status).toBe(409);
    expect(await errorOf(wrong)).toMatchObject({ message: "nonce does not match the commitment" });
    expect(await count(other.db, "SELECT COUNT(*) AS n FROM device_pairings WHERE device_id = ?", "ipad_1")).toBe(0);
  });

  test("approve: refused with 409 before the reveal, 409 for a device that did not start, 400 for a bad certificate or envelope, 409 for a group or version that does not fit, 400 for a duplicate, and writes nothing", async () => {
    const w = await world();
    await register(w);
    expect((await send(w, w.phone, PATH, { nonce: w.phoneNonce })).status).toBe(200);
    const cert = await certOf(w, w.account);
    const accountEnvelope = await wrap(w, PURPOSE_ACCOUNT_KEY, accountKeyInfo("u1", "acct_1", "ipad_1"), w.phone, "phone_1", 64);
    const groupEnvelope = await wrap(w, PURPOSE_GROUP_KEY, groupKeyInfo("g1", 1, "ipad_1"), w.phone, "phone_1", 32);
    const one = (wrapped: string, groupId = "g1", version = 1) => ({ group_id: groupId, key_version: version, wrapped_key: wrapped });
    const body = (certText: string, accountEnv: string, envelopes: ReturnType<typeof one>[]) => ({
      cert: certText,
      account_envelope: accountEnv,
      envelopes,
    });

    const early = await send(w, w.phone, APPROVE, body(cert, accountEnvelope, [one(groupEnvelope)]));
    expect(early.status).toBe(409);
    expect(await errorOf(early)).toMatchObject({ message: "pairing not finished" });

    expect((await send(w, w.ipad, `${PATH}/reveal`, { nonce: w.ipadNonce })).status).toBe(200);

    const notStarter = await send(w, w.phone2, APPROVE, body(cert, accountEnvelope, [one(groupEnvelope)]));
    expect(notStarter.status).toBe(409);

    const other = await makeTestDevice("other_1");
    const badCert = await send(w, w.phone, APPROVE, body(await certOf(w, other), accountEnvelope, [one(groupEnvelope)]));
    expect(badCert.status).toBe(400);
    expect(await errorOf(badCert)).toMatchObject({ message: "invalid certificate" });

    const wrongPurpose = await send(w, w.phone, APPROVE, body(cert, groupEnvelope, [one(groupEnvelope)]));
    expect(wrongPurpose.status).toBe(400);
    expect(await errorOf(wrongPurpose)).toMatchObject({ message: "invalid envelope" });

    const wrongSigner = await wrap(w, PURPOSE_GROUP_KEY, groupKeyInfo("g1", 1, "ipad_1"), w.phone, "phone_2", 32);
    const signerMismatch = await send(w, w.phone, APPROVE, body(cert, accountEnvelope, [one(wrongSigner)]));
    expect(signerMismatch.status).toBe(400);

    const notMember = await send(w, w.phone, APPROVE, body(cert, accountEnvelope, [one(groupEnvelope, "g2", 1)]));
    expect(notMember.status).toBe(409);
    expect(await errorOf(notMember)).toMatchObject({ message: "unknown group or key version" });

    const aboveVersion = await send(w, w.phone, APPROVE, body(cert, accountEnvelope, [one(groupEnvelope, "g1", 2)]));
    expect(aboveVersion.status).toBe(409);

    await w.db.prepare("UPDATE groups SET key_version = 2 WHERE id = 'g1'").run();
    const noEnvelopes = await send(w, w.phone, APPROVE, body(cert, accountEnvelope, [one(groupEnvelope, "g1", 2)]));
    expect(noEnvelopes.status).toBe(409);

    const duplicate = await send(w, w.phone, APPROVE, body(cert, accountEnvelope, [one(groupEnvelope), one(groupEnvelope)]));
    expect(duplicate.status).toBe(400);
    expect(await errorOf(duplicate)).toMatchObject({ message: "invalid request" });

    const row = await w.db.prepare("SELECT approved_at FROM devices WHERE id = ?").bind("ipad_1").first<{ approved_at: number | null }>();
    expect(row?.approved_at).toBeNull();
    expect(await count(w.db, "SELECT COUNT(*) AS n FROM key_envelopes WHERE device_id = ?", "ipad_1")).toBe(0);
    expect(await count(w.db, "SELECT COUNT(*) AS n FROM device_pairings WHERE device_id = ?", "ipad_1")).toBe(1);
  });

  test("recovery: with no pairing at all, the account key row can approve a pending device (200)", async () => {
    const w = await world();
    await insertDevice(w.db, w.ipad, { userId: "u1", approvedAt: null });
    const cert = await certOf(w, w.account);
    const accountEnvelope = await wrap(w, PURPOSE_ACCOUNT_KEY, accountKeyInfo("u1", "acct_1", "ipad_1"), w.account, "acct_1", 64);
    const groupEnvelope = await wrap(w, PURPOSE_GROUP_KEY, groupKeyInfo("g1", 1, "ipad_1"), w.account, "acct_1", 32);
    const res = await send(w, w.account, APPROVE, { cert, account_envelope: accountEnvelope, envelopes: [{ group_id: "g1", key_version: 1, wrapped_key: groupEnvelope }] });
    expect(res.status).toBe(200);
    const row = await w.db.prepare("SELECT approved_by FROM devices WHERE id = ?").bind("ipad_1").first<{ approved_by: string }>();
    expect(row?.approved_by).toBe("acct_1");
  });

  test("every route except GET needs a device signature: without one each gives 401", async () => {
    const w = await world();
    await register(w);
    for (const path of [PATH, `${PATH}/reveal`, APPROVE]) {
      const res = await appFor(userOf("u1")).request(
        path,
        { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "unsigned-key-0001" }, body: "{}" },
        { DB: w.db },
      );
      expect(res.status).toBe(401);
    }
  });
});
