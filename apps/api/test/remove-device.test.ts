import { RemoveDeviceResponseSchema, type ApiError } from "@waypoint/contracts";
import {
  accountKeyInfo,
  bodySha256,
  DEVICE_HEADER,
  deviceCertificateInput,
  fromBase64Url,
  makeEnvelope,
  NONCE_HEADER,
  PURPOSE_ACCOUNT_KEY,
  requestSigningInput,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  toBase64Url,
  utf8,
} from "@waypoint/crypto";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import { removeDeviceRoute } from "../src/devices/remove.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { BatchDb, Db } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { freshNonce, insertDevice, makeTestDevice, selfCertFor, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const PATH = "/v1/devices/ipad_1";

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
  app.route("/", removeDeviceRoute({ now: () => NOW }));
  return app;
}

type World = {
  db: BatchDb;
  account: TestDevice;
  phone: TestDevice;
  ipad: TestDevice;
  pending: TestDevice;
  other: TestDevice;
  next: TestDevice;
};

// u1 has an account key row acct_1, two approved devices (phone_1 and ipad_1), one waiting device (pending_1) with
// its pairing row, and a recovery row. u1 is in groups g1 and g2; g3 belongs to u2, whose device is u2_phone.
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
  const ipad = await makeTestDevice("ipad_1");
  const pending = await makeTestDevice("pending_1");
  const other = await makeTestDevice("u2_phone");
  const next = await makeTestDevice("acct_2");
  await insertDevice(db, account, { userId: "u1", kind: "account", approvedAt: NOW });
  await insertDevice(db, phone, { userId: "u1", approvedAt: NOW });
  await insertDevice(db, ipad, { userId: "u1", approvedAt: NOW });
  await insertDevice(db, pending, { userId: "u1", approvedAt: null });
  await insertDevice(db, other, { userId: "u2", approvedAt: NOW });
  await db
    .prepare("INSERT INTO device_pairings (device_id, commitment, expires_at) VALUES (?, ?, ?)")
    .bind("pending_1", "C".repeat(43), NOW + 600_000)
    .run();
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES ('g1', 'shared', 'sealed', 1, 'u1')").run();
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES ('g2', 'shared', 'sealed', 1, 'u1')").run();
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES ('g3', 'shared', 'sealed', 1, 'u2')").run();
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g1', 'u1', 'owner', ?, ?)")
    .bind(NOW, NOW)
    .run();
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g2', 'u1', 'editor', ?, ?)")
    .bind(NOW, NOW)
    .run();
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g3', 'u2', 'owner', ?, ?)")
    .bind(NOW, NOW)
    .run();
  await db.prepare("INSERT INTO recovery (user_id, wrapped_account_key, verified_at) VALUES ('u1', 'RECOVERY_BLOB', ?)").bind(NOW).run();
  return { db, account, phone, ipad, pending, other, next };
}

// The new account key's rotation for the one remaining device, phone_1 (or the device given as `keep`). The options
// change one part at a time.
async function rotation(
  w: World,
  options: { accountId?: string; certKey?: TestDevice; envelopeSigner?: TestDevice; envelopeSignerId?: string; keep?: TestDevice; selfCert?: string } = {},
) {
  const keep = options.keep ?? w.phone;
  const accountId = options.accountId ?? "acct_2";
  const cert = toBase64Url(await (options.certKey ?? w.next).sign(deviceCertificateInput("u1", keep.id, keep.signPub, keep.boxPub)));
  const signer = options.envelopeSigner ?? keep;
  const envelope = toBase64Url(
    await makeEnvelope({
      purpose: PURPOSE_ACCOUNT_KEY,
      info: accountKeyInfo("u1", accountId, keep.id),
      recipientBoxPub: fromBase64Url(keep.boxPub),
      key: new Uint8Array(64).fill(5),
      signerId: options.envelopeSignerId ?? keep.id,
      sign: signer.sign,
    }),
  );
  return {
    account: { id: accountId, sign_pub: w.next.signPub, box_pub: w.next.boxPub, self_cert: options.selfCert ?? (await selfCertFor(w.next, "u1", accountId)) },
    devices: [{ id: keep.id, cert, account_envelope: envelope }],
  };
}

async function remove(w: World, signer: TestDevice, path: string, body?: unknown, userId = "u1", db: BatchDb = w.db): Promise<Response> {
  return appFor(userOf(userId)).request(path, await signedInit(signer, { method: "DELETE", path, body, now: NOW }), { DB: db });
}

// Holds each db.batch until `parties` batches are waiting, then runs them one after the other: every request has
// made its reads before any of them writes.
function holdBatches(db: BatchDb, parties: number): BatchDb {
  const waiting: Array<() => void> = [];
  return {
    prepare: (query) => db.prepare(query),
    batch: async (statements) => {
      await new Promise<void>((release) => {
        waiting.push(release);
        if (waiting.length === parties) for (const go of waiting) go();
      });
      return db.batch(statements);
    },
  };
}

// A signed DELETE whose body is sent exactly as given, for bodies that are not JSON.
async function rawDelete(device: TestDevice, path: string, text: string): Promise<RequestInit> {
  const nonce = freshNonce();
  const input = requestSigningInput({
    method: "DELETE",
    target: path,
    deviceId: device.id,
    timestamp: NOW,
    nonce,
    bodySha256: await bodySha256(utf8(text)),
  });
  return {
    method: "DELETE",
    headers: {
      [DEVICE_HEADER]: device.id,
      [TIMESTAMP_HEADER]: String(NOW),
      [NONCE_HEADER]: nonce,
      [SIGNATURE_HEADER]: toBase64Url(await device.sign(input)),
      "Idempotency-Key": `idem-${nonce}`,
      "Content-Type": "application/json",
    },
    body: text,
  };
}

async function snapshot(db: Db) {
  const devices = await db.prepare("SELECT id, kind, removed_at, cert, account_envelope FROM devices ORDER BY id").all();
  const groups = await db.prepare("SELECT id, key_version FROM groups ORDER BY id").all();
  const recovery = await db.prepare("SELECT user_id FROM recovery").all();
  const pairings = await db.prepare("SELECT device_id FROM device_pairings ORDER BY device_id").all();
  return { devices: devices.results, groups: groups.results, recovery: recovery.results, pairings: pairings.results };
}

async function errorOf(res: Response): Promise<ApiError> {
  return (await res.json()) as ApiError;
}

describe("DELETE /v1/devices/:id", () => {
  test("phone removes the iPad with a new account key: 200 and the rows, certificates, groups and recovery it leaves", async () => {
    const w = await world();
    const body = await rotation(w);
    const res = await remove(w, w.phone, PATH, body);
    expect(res.status).toBe(200);
    const reply = await res.json();
    expect(RemoveDeviceResponseSchema.safeParse(reply).success).toBe(true);
    expect(reply).toEqual({ removed: "ipad_1", account_id: "acct_2" });

    const removedAt = async (id: string) =>
      (await w.db.prepare("SELECT removed_at FROM devices WHERE id = ?").bind(id).first<{ removed_at: number | null }>())?.removed_at;
    expect(await removedAt("ipad_1")).toBe(NOW);
    expect(await removedAt("acct_1")).toBe(NOW);

    const next = await w.db
      .prepare("SELECT user_id, kind, removed_at, approved_at, approved_by, cert FROM devices WHERE id = ?")
      .bind("acct_2")
      .first();
    expect(next).toEqual({ user_id: "u1", kind: "account", removed_at: null, approved_at: NOW, approved_by: "phone_1", cert: body.account.self_cert });

    const [sent] = body.devices;
    if (sent === undefined) throw new Error("the rotation sends one device");
    const phone = await w.db.prepare("SELECT cert, account_envelope FROM devices WHERE id = ?").bind("phone_1").first();
    expect(phone).toEqual({ cert: sent.cert, account_envelope: sent.account_envelope });

    const groups = await w.db.prepare("SELECT id, key_version FROM groups ORDER BY id").all<{ id: string; key_version: number }>();
    expect(groups.results).toEqual([
      { id: "g1", key_version: 2 },
      { id: "g2", key_version: 2 },
      { id: "g3", key_version: 1 },
    ]);
    const recovery = await w.db.prepare("SELECT count(*) AS n FROM recovery WHERE user_id = ?").bind("u1").first<{ n: number }>();
    expect(recovery?.n).toBe(0);
  });

  test("the removed iPad's signature is refused afterwards (401 on any signed route)", async () => {
    const w = await world();
    expect((await remove(w, w.phone, PATH, await rotation(w))).status).toBe(200);
    const again = await remove(w, w.ipad, "/v1/devices/phone_1");
    expect(again.status).toBe(401);
    expect((await errorOf(again)).code).toBe("unauthorized");
  });

  test("a body missing the phone's certificate, or with an extra device, gets 409 and nothing changes", async () => {
    const w = await world();
    const body = await rotation(w);
    const before = await snapshot(w.db);
    const missing = await remove(w, w.phone, PATH, { ...body, devices: [{ ...body.devices[0], id: "ipad_1" }] });
    expect(missing.status).toBe(409);
    const extra = await remove(w, w.phone, PATH, { ...body, devices: [...body.devices, { ...body.devices[0], id: "ghost_1" }] });
    expect(extra.status).toBe(409);
    expect(await snapshot(w.db)).toEqual(before);
  });

  test("a certificate signed by the old account key gets 400; an account envelope signed by another device id gets 400; {} when devices remain gets 400", async () => {
    const w = await world();
    const before = await snapshot(w.db);
    const oldCert = await remove(w, w.phone, PATH, await rotation(w, { certKey: w.account }));
    expect(oldCert.status).toBe(400);
    expect((await errorOf(oldCert)).message).toBe("invalid certificate");
    const otherSigner = await remove(w, w.phone, PATH, await rotation(w, { envelopeSigner: w.ipad, envelopeSignerId: "ipad_1" }));
    expect(otherSigner.status).toBe(400);
    expect((await errorOf(otherSigner)).message).toBe("invalid envelope");
    const noAccount = await remove(w, w.phone, PATH, {});
    expect(noAccount.status).toBe(400);
    expect(await snapshot(w.db)).toEqual(before);
  });

  test("a new account key whose self_cert does not verify gets 400 and nothing changes", async () => {
    const w = await world();
    const before = await snapshot(w.db);
    const body = await rotation(w);
    const cases = [
      // The attack: the new key's real sign_pub and self_cert with a box_pub someone else chose.
      { ...body, account: { ...body.account, box_pub: w.ipad.boxPub } },
      // Signed by the old account key.
      await rotation(w, { selfCert: await selfCertFor(w.account, "u1", "acct_2") }),
      // Made for another account row id.
      await rotation(w, { selfCert: await selfCertFor(w.next, "u1", "acct_9") }),
    ];
    for (const bad of cases) {
      const res = await remove(w, w.phone, PATH, bad);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).message).toBe("invalid certificate");
    }
    expect(await snapshot(w.db)).toEqual(before);
  });

  test("an account.id that is already taken gets 409 and nothing changes", async () => {
    const w = await world();
    const before = await snapshot(w.db);
    const res = await remove(w, w.phone, PATH, await rotation(w, { accountId: "acct_1" }));
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toBe("account key id taken");
    expect(await snapshot(w.db)).toEqual(before);
  });

  test("removing a waiting device with {} gets 200, its pairing row is gone and groups are not bumped; with an account body it gets 400", async () => {
    const w = await world();
    const withBody = await remove(w, w.phone, "/v1/devices/pending_1", await rotation(w));
    expect(withBody.status).toBe(400);
    const res = await remove(w, w.phone, "/v1/devices/pending_1", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: "pending_1", account_id: null });
    const pairings = await w.db.prepare("SELECT count(*) AS n FROM device_pairings WHERE device_id = ?").bind("pending_1").first<{ n: number }>();
    expect(pairings?.n).toBe(0);
    const groups = await w.db.prepare("SELECT key_version FROM groups ORDER BY id").all<{ key_version: number }>();
    expect(groups.results.map((g) => g.key_version)).toEqual([1, 1, 1]);
  });

  test("the last device removing itself with {} gets 200, its groups are bumped, and the account row and recovery are kept", async () => {
    const w = await world();
    await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'ipad_1'").bind(NOW).run();
    const res = await remove(w, w.phone, "/v1/devices/phone_1", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: "phone_1", account_id: null });
    const groups = await w.db.prepare("SELECT id, key_version FROM groups ORDER BY id").all<{ id: string; key_version: number }>();
    expect(groups.results).toEqual([
      { id: "g1", key_version: 2 },
      { id: "g2", key_version: 2 },
      { id: "g3", key_version: 1 },
    ]);
    const account = await w.db.prepare("SELECT removed_at FROM devices WHERE id = 'acct_1'").first<{ removed_at: number | null }>();
    expect(account?.removed_at).toBeNull();
    const recovery = await w.db.prepare("SELECT count(*) AS n FROM recovery WHERE user_id = 'u1'").first<{ n: number }>();
    expect(recovery?.n).toBe(1);
  });

  test("another user's device, the account row, and an unknown id get 404", async () => {
    const w = await world();
    const before = await snapshot(w.db);
    for (const id of ["u2_phone", "acct_1", "nobody"]) {
      const res = await remove(w, w.phone, `/v1/devices/${id}`, {});
      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe("not_found");
    }
    expect(await snapshot(w.db)).toEqual(before);
  });

  test("an empty request body counts as {}; invalid JSON gets 400", async () => {
    const w = await world();
    const empty = await remove(w, w.phone, "/v1/devices/pending_1");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ removed: "pending_1", account_id: null });

    const before = await snapshot(w.db);
    const broken = await appFor(userOf("u1")).request(PATH, await rawDelete(w.phone, PATH, "{"), { DB: w.db });
    expect(broken.status).toBe(400);
    expect((await errorOf(broken)).message).toBe("invalid request");
    expect(await snapshot(w.db)).toEqual(before);
  });

  test("without a signature gets 401", async () => {
    const w = await world();
    const res = await appFor(userOf("u1")).request(PATH, { method: "DELETE", headers: { "Idempotency-Key": "no-signature-1" } }, { DB: w.db });
    expect(res.status).toBe(401);
  });

  test("two devices removing each other at once: one gets 200, the other 409, and one device, its account key and the groups' single bump remain", async () => {
    const w = await world();
    const held = holdBatches(w.db, 2);
    const [phoneRemovesIpad, ipadRemovesPhone] = await Promise.all([
      remove(w, w.phone, PATH, await rotation(w), "u1", held),
      remove(w, w.ipad, "/v1/devices/phone_1", await rotation(w, { accountId: "acct_3", keep: w.ipad }), "u1", held),
    ]);
    expect([phoneRemovesIpad.status, ipadRemovesPhone.status].sort()).toEqual([200, 409]);
    const loser = phoneRemovesIpad.status === 409 ? phoneRemovesIpad : ipadRemovesPhone;
    expect(await errorOf(loser)).toEqual({ code: "conflict", message: "devices changed, try again", retry_after: null });
    const live = await w.db
      .prepare("SELECT id FROM devices WHERE user_id = 'u1' AND approved_at IS NOT NULL AND removed_at IS NULL ORDER BY kind, id")
      .all<{ id: string }>();
    expect(live.results).toHaveLength(2); // one account row and one device
    const groups = await w.db.prepare("SELECT key_version FROM groups ORDER BY id").all<{ key_version: number }>();
    expect(groups.results.map((g) => g.key_version)).toEqual([2, 2, 1]);
  });

  test("a device approved between the reads and the batch: 409 and nothing changes", async () => {
    const w = await world();
    const before = await snapshot(w.db);
    const approving: BatchDb = {
      prepare: (query) => w.db.prepare(query),
      batch: async (statements) => {
        await w.db.prepare("UPDATE devices SET approved_at = ? WHERE id = 'pending_1'").bind(NOW).run();
        return w.db.batch(statements);
      },
    };
    const res = await remove(w, w.phone, PATH, await rotation(w), "u1", approving);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toBe("devices changed, try again");
    await w.db.prepare("UPDATE devices SET approved_at = NULL WHERE id = 'pending_1'").run();
    expect(await snapshot(w.db)).toEqual(before);
  });

  test("the last device removing itself after another removal landed first: 409 and no second bump", async () => {
    const w = await world();
    await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'ipad_1'").bind(NOW).run();
    const removedFirst: BatchDb = {
      prepare: (query) => w.db.prepare(query),
      batch: async (statements) => {
        await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'phone_1'").bind(NOW).run();
        return w.db.batch(statements);
      },
    };
    const res = await remove(w, w.phone, "/v1/devices/phone_1", {}, "u1", removedFirst);
    expect(res.status).toBe(409);
    const groups = await w.db.prepare("SELECT key_version FROM groups ORDER BY id").all<{ key_version: number }>();
    expect(groups.results.map((g) => g.key_version)).toEqual([1, 1, 1]);
  });

  test("removing an already removed device gets 404 and bumps nothing", async () => {
    const w = await world();
    expect((await remove(w, w.phone, PATH, await rotation(w))).status).toBe(200);
    const again = await remove(w, w.phone, PATH, await rotation(w, { accountId: "acct_3" }));
    expect(again.status).toBe(404);
    const groups = await w.db.prepare("SELECT key_version FROM groups ORDER BY id").all<{ key_version: number }>();
    expect(groups.results.map((g) => g.key_version)).toEqual([2, 2, 1]);
  });

  test("a group the user has left keeps its key version", async () => {
    const w = await world();
    await w.db.prepare("UPDATE memberships SET left_at = ? WHERE group_id = 'g2' AND user_id = 'u1'").bind(NOW).run();
    expect((await remove(w, w.phone, PATH, await rotation(w))).status).toBe(200);
    const groups = await w.db.prepare("SELECT key_version FROM groups ORDER BY id").all<{ key_version: number }>();
    expect(groups.results.map((g) => g.key_version)).toEqual([2, 1, 1]);
  });

  test("the last device removing itself with an account body gets 400 and nothing changes", async () => {
    const w = await world();
    await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'ipad_1'").bind(NOW).run();
    const before = await snapshot(w.db);
    const res = await remove(w, w.phone, "/v1/devices/phone_1", await rotation(w));
    expect(res.status).toBe(400);
    expect(await snapshot(w.db)).toEqual(before);
  });
});
