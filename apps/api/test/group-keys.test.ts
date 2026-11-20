import { GroupDevicesSchema, MyGroupKeysSchema, type ApiError } from "@waypoint/contracts";
import {
  accountKeyInfo,
  type EnvelopePurpose,
  fromBase64Url,
  groupKeyInfo,
  makeEnvelope,
  PURPOSE_ACCOUNT_KEY,
  PURPOSE_GROUP_KEY,
  toBase64Url,
  verifyAccountCertificate,
} from "@waypoint/crypto";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { groupKeyRoutes } from "../src/keys/routes.ts";
import type { Db } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, selfCertFor, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const G = "g1";
const PATH = "/v1/groups/g1/keys";
const DEVICES_PATH = "/v1/groups/g1/devices";
const TARGETS = ["acct_u1", "dev_u1", "acct_u2", "dev_u2"];

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
  app.route("/", groupKeyRoutes({ now: () => NOW }));
  return app;
}

type World = { db: Db; d: Record<string, TestDevice> };

// Group g1 (key version 2) has members u1 (owner) and u2 (editor). u1 has an account row and one phone; u2 has an
// account row, one phone, a phone waiting for approval and a removed phone. u3 has a phone and is not a member.
async function world(): Promise<World> {
  const db = createTestDb();
  for (const id of ["u1", "u2", "u3"]) {
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)").bind(id, `clerk_${id}`, NOW, `ba_${id}`).run();
  }
  const d: Record<string, TestDevice> = {};
  for (const id of ["acct_u1", "dev_u1", "acct_u2", "dev_u2", "wait_u2", "old_u2", "dev_u3"]) d[id] = await makeTestDevice(id);
  await insertDevice(db, d.acct_u1!, { userId: "u1", kind: "account" });
  await insertDevice(db, d.dev_u1!, { userId: "u1" });
  await insertDevice(db, d.acct_u2!, { userId: "u2", kind: "account" });
  await insertDevice(db, d.dev_u2!, { userId: "u2" });
  await insertDevice(db, d.wait_u2!, { userId: "u2", approvedAt: null });
  await insertDevice(db, d.old_u2!, { userId: "u2", removedAt: NOW });
  await insertDevice(db, d.dev_u3!, { userId: "u3" });
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES ('g1', 'shared', 'sealed', 2, 'u1')").run();
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g1', 'u1', 'owner', ?, ?)")
    .bind(NOW, NOW)
    .run();
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g1', 'u2', 'editor', ?, ?)")
    .bind(NOW, NOW)
    .run();
  return { db, d };
}

// One envelope for `target`, wrapped and signed by `signer` (whose id is the signer id unless overridden).
async function envelope(
  signer: TestDevice,
  target: TestDevice,
  keyVersion: number,
  options: { signerId?: string; purpose?: EnvelopePurpose } = {},
): Promise<{ device_id: string; wrapped_key: string }> {
  const purpose = options.purpose ?? PURPOSE_GROUP_KEY;
  const info = purpose === PURPOSE_GROUP_KEY ? groupKeyInfo(G, keyVersion, target.id) : accountKeyInfo("u1", "acct_u1", target.id);
  const bytes = await makeEnvelope({
    purpose,
    info,
    recipientBoxPub: fromBase64Url(target.boxPub),
    key: new Uint8Array(purpose === PURPOSE_GROUP_KEY ? 32 : 64).fill(9),
    signerId: options.signerId ?? signer.id,
    sign: signer.sign,
  });
  return { device_id: target.id, wrapped_key: toBase64Url(bytes) };
}

async function fullSet(w: World, signer: TestDevice, keyVersion: number, targetIds: string[] = TARGETS): Promise<{ device_id: string; wrapped_key: string }[]> {
  const out = [];
  for (const id of targetIds) out.push(await envelope(signer, w.d[id]!, keyVersion));
  return out;
}

async function post(w: World, userId: string, signer: TestDevice, body: unknown): Promise<Response> {
  return appFor(userOf(userId)).request(PATH, await signedInit(signer, { method: "POST", path: PATH, body, now: NOW }), { DB: w.db });
}

async function rowsFor(db: Db, keyVersion: number): Promise<{ device_id: string; wrapped_key: string }[]> {
  return (
    await db
      .prepare("SELECT device_id, wrapped_key FROM key_envelopes WHERE group_id = 'g1' AND key_version = ? ORDER BY device_id")
      .bind(keyVersion)
      .all<{ device_id: string; wrapped_key: string }>()
  ).results;
}

async function errorOf(res: Response): Promise<ApiError> {
  return (await res.json()) as ApiError;
}

describe("S2 group keys", () => {
  test("a first set for version 2 covering the four targets → 201 { key_version: 2, first: true }; four rows", async () => {
    const w = await world();
    const res = await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ key_version: 2, first: true });
    expect((await rowsFor(w.db, 2)).map((r) => r.device_id)).toEqual([...TARGETS].sort());
  });

  test("a first set missing one target, or with a waiting, removed or third-user device, or for version 1 or 3 while 2 is current → 409, no rows", async () => {
    const w = await world();
    const signer = w.d.dev_u1!;
    const missing = await post(w, "u1", signer, { key_version: 2, envelopes: await fullSet(w, signer, 2, ["acct_u1", "dev_u1", "acct_u2"]) });
    expect(missing.status).toBe(409);
    for (const extra of ["wait_u2", "old_u2", "dev_u3"]) {
      const res = await post(w, "u1", signer, { key_version: 2, envelopes: await fullSet(w, signer, 2, [...TARGETS, extra]) });
      expect(res.status).toBe(409);
    }
    expect((await post(w, "u1", signer, { key_version: 1, envelopes: await fullSet(w, signer, 1) })).status).toBe(409);
    expect((await post(w, "u1", signer, { key_version: 3, envelopes: await fullSet(w, signer, 3) })).status).toBe(409);
    expect(await rowsFor(w.db, 1)).toEqual([]);
    expect(await rowsFor(w.db, 2)).toEqual([]);
    expect(await rowsFor(w.db, 3)).toEqual([]);
  });

  test("after user 1's first set, user 2's own full first set → 409 and the stored rows are still user 1's", async () => {
    const w = await world();
    const first = await fullSet(w, w.d.dev_u1!, 2);
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: first })).status).toBe(201);
    const second = await post(w, "u2", w.d.dev_u2!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u2!, 2) });
    expect(second.status).toBe(409);
    expect(await errorOf(second)).toMatchObject({ code: "conflict" });
    expect(await rowsFor(w.db, 2)).toEqual([...first].sort((a, b) => a.device_id.localeCompare(b.device_id)));
  });

  test("after a first set, a new approved device of user 2 gets an envelope through an add → 201 { first: false }; adding it again → 409", async () => {
    const w = await world();
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2) })).status).toBe(201);
    const added = await makeTestDevice("dev_u2b");
    await insertDevice(w.db, added, { userId: "u2" });
    const body = { key_version: 2, envelopes: [await envelope(w.d.dev_u2!, added, 2)] };
    const res = await post(w, "u2", w.d.dev_u2!, body);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ key_version: 2, first: false });
    expect((await post(w, "u2", w.d.dev_u2!, body)).status).toBe(409);
  });

  test("an envelope signed by another device id → 400; purpose 2 → 400; a duplicated device id → 400", async () => {
    const w = await world();
    const signer = w.d.dev_u1!;
    const wrongSigner = { key_version: 2, envelopes: [await envelope(signer, w.d.acct_u1!, 2, { signerId: "dev_u2" })] };
    const wrongPurpose = { key_version: 2, envelopes: [await envelope(signer, w.d.acct_u1!, 2, { purpose: PURPOSE_ACCOUNT_KEY })] };
    const duplicated = { key_version: 2, envelopes: [await envelope(signer, w.d.acct_u1!, 2), await envelope(signer, w.d.acct_u1!, 2)] };
    expect((await post(w, "u1", signer, wrongSigner)).status).toBe(400);
    expect((await post(w, "u1", signer, wrongPurpose)).status).toBe(400);
    expect((await post(w, "u1", signer, duplicated)).status).toBe(400);
    expect(await rowsFor(w.db, 2)).toEqual([]);
  });

  test("a caller that is not a member → 404; a member who left (left_at set) → 404", async () => {
    const w = await world();
    const body = { key_version: 2, envelopes: await fullSet(w, w.d.dev_u3!, 2, ["dev_u3"]) };
    expect((await post(w, "u3", w.d.dev_u3!, body)).status).toBe(404);
    await w.db.prepare("UPDATE memberships SET left_at = ? WHERE group_id = 'g1' AND user_id = 'u2'").bind(NOW).run();
    const left = { key_version: 2, envelopes: [await envelope(w.d.dev_u2!, w.d.acct_u1!, 2)] };
    expect((await post(w, "u2", w.d.dev_u2!, left)).status).toBe(404);
  });

  test("GET /v1/groups/g1/devices lists the targets with roles and has_current_key, passes GroupDevicesSchema, and not waiting, removed or non-member devices", async () => {
    const w = await world();
    const before = await appFor(userOf("u1")).request(DEVICES_PATH, {}, { DB: w.db });
    expect(before.status).toBe(200);
    expect((await before.json()) as { devices: { has_current_key: boolean }[] }).toMatchObject({ devices: expect.any(Array) });
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2) })).status).toBe(201);
    const res = await appFor(userOf("u1")).request(DEVICES_PATH, {}, { DB: w.db });
    const view = await res.json();
    expect(GroupDevicesSchema.safeParse(view).success).toBe(true);
    const devices = (view as { devices: { id: string; role: string; has_current_key: boolean }[] }).devices;
    expect(devices.map((x) => x.id).sort()).toEqual([...TARGETS].sort());
    expect(devices.every((x) => x.has_current_key)).toBe(true);
    expect(Object.fromEntries(devices.map((x) => [x.id, x.role]))).toEqual({ acct_u1: "owner", dev_u1: "owner", acct_u2: "editor", dev_u2: "editor" });
  });

  test("GET /v1/groups/g1/devices serves an account row's self-certificate as its cert, and it verifies under the row's own keys", async () => {
    const w = await world();
    const selfCert = await selfCertFor(w.d.acct_u2!, "u2");
    await w.db.prepare("UPDATE devices SET cert = ? WHERE id = 'acct_u2'").bind(selfCert).run();
    const res = await appFor(userOf("u1")).request(DEVICES_PATH, {}, { DB: w.db });
    const devices = ((await res.json()) as { devices: { id: string; user_id: string; kind: string; sign_pub: string; box_pub: string; cert: string | null }[] }).devices;
    const row = devices.find((x) => x.id === "acct_u2");
    expect(row).toMatchObject({ kind: "account", user_id: "u2", cert: selfCert });
    expect(await verifyAccountCertificate(selfCert, "u2", "acct_u2", row?.sign_pub ?? "", row?.box_pub ?? "")).toBe(true);
  });

  test("GET /v1/groups/g1/keys?device=<id> returns that device's envelopes in version order and one entry per signer, passes MyGroupKeysSchema; other user's, removed or missing device → 404", async () => {
    const w = await world();
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2) })).status).toBe(201);
    const older = await envelope(w.d.dev_u2!, w.d.dev_u1!, 1);
    await w.db.prepare("INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) VALUES ('g1', 1, 'dev_u1', ?)").bind(older.wrapped_key).run();
    const res = await appFor(userOf("u1")).request(`${PATH}?device=dev_u1`, {}, { DB: w.db });
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(MyGroupKeysSchema.safeParse(view).success).toBe(true);
    const body = view as { envelopes: { key_version: number }[]; signers: { id: string }[] };
    expect(body.envelopes.map((e) => e.key_version)).toEqual([1, 2]);
    expect(body.signers.map((s) => s.id)).toEqual(["dev_u1", "dev_u2"]);
    for (const device of ["dev_u2", "old_u2", ""]) {
      expect((await appFor(userOf("u1")).request(`${PATH}?device=${device}`, {}, { DB: w.db })).status).toBe(404);
    }
  });

  test("after a member's removal (left_at set and key_version + 1), the removed member's devices are not targets and a first set for the new version must leave them out", async () => {
    const w = await world();
    await w.db.prepare("UPDATE memberships SET left_at = ? WHERE group_id = 'g1' AND user_id = 'u2'").bind(NOW).run();
    await w.db.prepare("UPDATE groups SET key_version = key_version + 1 WHERE id = ?").bind("g1").run();
    const devices = await (await appFor(userOf("u1")).request(DEVICES_PATH, {}, { DB: w.db })).json();
    expect((devices as { devices: { id: string }[] }).devices.map((x) => x.id).sort()).toEqual(["acct_u1", "dev_u1"]);
    const withRemoved = await post(w, "u1", w.d.dev_u1!, { key_version: 3, envelopes: await fullSet(w, w.d.dev_u1!, 3) });
    expect(withRemoved.status).toBe(409);
    const res = await post(w, "u1", w.d.dev_u1!, { key_version: 3, envelopes: await fullSet(w, w.d.dev_u1!, 3, ["acct_u1", "dev_u1"]) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ key_version: 3, first: true });
  });

  test("after a first set, an editor's add for another member's new device → 409 and no row; the owner's add for another member's device → 201", async () => {
    const w = await world();
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2) })).status).toBe(201);
    const added = await makeTestDevice("dev_u1b");
    await insertDevice(w.db, added, { userId: "u1" });
    const byEditor = await post(w, "u2", w.d.dev_u2!, { key_version: 2, envelopes: [await envelope(w.d.dev_u2!, added, 2)] });
    expect(byEditor.status).toBe(409);
    expect(await errorOf(byEditor)).toEqual({ code: "conflict", message: "only an owner can add keys for another member", retry_after: null });
    expect((await rowsFor(w.db, 2)).map((r) => r.device_id)).not.toContain("dev_u1b");
    const u2b = await makeTestDevice("dev_u2b");
    await insertDevice(w.db, u2b, { userId: "u2" });
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: [await envelope(w.d.dev_u1!, u2b, 2)] })).status).toBe(201);
  });

  test("after a first set, an owner's add for a waiting, removed or third-user device → 409 and no row", async () => {
    const w = await world();
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2) })).status).toBe(201);
    for (const id of ["wait_u2", "old_u2", "dev_u3"]) {
      const res = await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: [await envelope(w.d.dev_u1!, w.d[id]!, 2)] });
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toMatchObject({ code: "conflict", message: "not a device of a current member" });
    }
    expect((await rowsFor(w.db, 2)).map((r) => r.device_id)).toEqual([...TARGETS].sort());
  });

  test("a first set for a version after an older version's set, that does not cover every device → 409 and no rows", async () => {
    const w = await world();
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2) })).status).toBe(201);
    await w.db.prepare("UPDATE groups SET key_version = 3 WHERE id = 'g1'").run();
    const partial = await post(w, "u1", w.d.dev_u1!, { key_version: 3, envelopes: await fullSet(w, w.d.dev_u1!, 3, ["acct_u1", "dev_u1"]) });
    expect(partial.status).toBe(409);
    expect(await errorOf(partial)).toMatchObject({ code: "conflict", message: "envelopes must cover every device" });
    expect(await rowsFor(w.db, 3)).toEqual([]);
  });

  test("an add with one new envelope and one for a device that already has one → 409 and the new one is not stored", async () => {
    const w = await world();
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2) })).status).toBe(201);
    const u2b = await makeTestDevice("dev_u2b");
    await insertDevice(w.db, u2b, { userId: "u2" });
    const body = { key_version: 2, envelopes: [await envelope(w.d.dev_u1!, u2b, 2), await envelope(w.d.dev_u1!, w.d.acct_u1!, 2)] };
    const res = await post(w, "u1", w.d.dev_u1!, body);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ code: "conflict", message: "a device already has a key for this version" });
    expect((await rowsFor(w.db, 2)).map((r) => r.device_id)).not.toContain("dev_u2b");
  });

  test("GET devices and GET keys?device= refuse a non-member, a member who left, and a removed device; has_current_key is false before any set", async () => {
    const w = await world();
    const before = (await (await appFor(userOf("u1")).request(DEVICES_PATH, {}, { DB: w.db })).json()) as { devices: { has_current_key: boolean }[] };
    expect(before.devices.length).toBeGreaterThan(0);
    expect(before.devices.every((x) => x.has_current_key === false)).toBe(true);
    expect((await appFor(userOf("u3")).request(DEVICES_PATH, {}, { DB: w.db })).status).toBe(404);
    expect((await appFor(userOf("u3")).request(`${PATH}?device=dev_u3`, {}, { DB: w.db })).status).toBe(404);
    await insertDevice(w.db, await makeTestDevice("old_u1"), { userId: "u1", removedAt: NOW });
    expect((await appFor(userOf("u1")).request(`${PATH}?device=old_u1`, {}, { DB: w.db })).status).toBe(404);
    await w.db.prepare("UPDATE memberships SET left_at = ? WHERE group_id = 'g1' AND user_id = 'u2'").bind(NOW).run();
    expect((await appFor(userOf("u2")).request(DEVICES_PATH, {}, { DB: w.db })).status).toBe(404);
    expect((await appFor(userOf("u2")).request(`${PATH}?device=dev_u2`, {}, { DB: w.db })).status).toBe(404);
  });

  test("POST without a signature → 401", async () => {
    const w = await world();
    const res = await appFor(userOf("u1")).request(
      PATH,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "no-signature-1" },
        body: JSON.stringify({ key_version: 2, envelopes: [{ device_id: "dev_u1", wrapped_key: "E".repeat(10) }] }),
      },
      { DB: w.db },
    );
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toMatchObject({ code: "unauthorized" });
  });
});
