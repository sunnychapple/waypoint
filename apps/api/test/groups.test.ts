import { GroupListSchema, GroupViewSchema, InviteViewSchema } from "@waypoint/contracts";
import { sha256, toHex, utf8 } from "@waypoint/crypto";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { activeMembership } from "../src/groups/membership.ts";
import { groupRoutes } from "../src/groups/routes.ts";
import type { BatchDb } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const DAY = 24 * 60 * 60 * 1000;
const G1 = "group_aaaaaaaaaaaa";
const G2 = "group_bbbbbbbbbbbb";
const G3 = "group_cccccccccccc";
const G4 = "group_dddddddddddd";
const GP = "group_pppppppppppp";
const NAME = "bmFtZS1sb2NrZWQ";
const TOKEN = "T".repeat(43);
const TOKEN_EXPIRED = "E".repeat(43);
const TOKEN_ENDED = "N".repeat(43);
const TOKEN_PERSONAL = "P".repeat(43);
const KEY = "k".repeat(20);

type Who = "u1" | "u2" | "u3";
type World = { db: BatchDb; d: Record<Who, TestDevice> };

const hashOf = async (token: string): Promise<string> => toHex(await sha256(utf8(token)));
const HASH = await hashOf(TOKEN);

function userOf(id: string): SessionUser {
  return { id, clerk_id: `clerk_${id}`, plan: "free", billing_account_id: `ba_${id}`, zero_retention: false };
}

function appFor(user: SessionUser): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", groupRoutes({ now: () => NOW }));
  return app;
}

// Users u1, u2 and u3, each with one approved device.
async function world(): Promise<World> {
  const db = createTestDb();
  const d = { u1: await makeTestDevice("dev_u1"), u2: await makeTestDevice("dev_u2"), u3: await makeTestDevice("dev_u3") };
  for (const who of ["u1", "u2", "u3"] as const) {
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)").bind(who, `clerk_${who}`, NOW, `ba_${who}`).run();
    await insertDevice(db, d[who], { userId: who });
  }
  return { db, d };
}

// A signed request from `who`'s device. Each call uses a fresh Idempotency-Key unless one is given.
async function call(w: World, who: Who, method: string, path: string, body?: unknown, key: string = crypto.randomUUID()): Promise<Response> {
  const init = await signedInit(w.d[who], { method, path, body, now: NOW, idempotencyKey: key });
  return appFor(userOf(who)).request(path, init, { DB: w.db });
}

// The same request with no device signature.
async function unsigned(w: World, who: Who, method: string, path: string, body?: unknown): Promise<Response> {
  return appFor(userOf(who)).request(
    path,
    { method, headers: { "Content-Type": "application/json", "Idempotency-Key": KEY }, body: JSON.stringify(body) },
    { DB: w.db },
  );
}

async function count(db: BatchDb, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ n: number }>();
  return row?.n ?? 0;
}

async function seedGroup(db: BatchDb, id: string, kind: "personal" | "shared" = "shared"): Promise<void> {
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES (?, ?, ?, 1, 'u1')").bind(id, kind, NAME).run();
}

type Seat = { role: "owner" | "editor" | "viewer"; startsAt?: number; endsAt?: number | null; historyFrom?: number; leftAt?: number | null };

async function seedMember(db: BatchDb, groupId: string, userId: string, seat: Seat): Promise<void> {
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, ends_at, history_from, left_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(groupId, userId, seat.role, seat.startsAt ?? NOW, seat.endsAt ?? null, seat.historyFrom ?? 0, seat.leftAt ?? null)
    .run();
}

type InviteSeat = { role?: "owner" | "editor" | "viewer"; expiresAt?: number; acceptedBy?: string; historyFrom?: number; endsAt?: number | null };

async function seedInvite(db: BatchDb, tokenHash: string, groupId: string, invite: InviteSeat = {}): Promise<void> {
  await db
    .prepare("INSERT INTO invites (token_hash, group_id, role, expires_at, accepted_by, created_by, history_from, ends_at) VALUES (?, ?, ?, ?, ?, 'u1', ?, ?)")
    .bind(tokenHash, groupId, invite.role ?? "viewer", invite.expiresAt ?? NOW + 7 * DAY, invite.acceptedBy ?? null, invite.historyFrom ?? 0, invite.endsAt ?? null)
    .run();
}

describe("POST /v1/groups", () => {
  test("makes the group and the caller's owner membership, and returns 201 with the group view", async () => {
    const w = await world();
    const res = await call(w, "u1", "POST", "/v1/groups", { id: G1, kind: "shared", name_locked: NAME });
    expect(res.status).toBe(201);
    const view = GroupViewSchema.parse(await res.json());
    expect(view).toEqual({
      id: G1,
      kind: "shared",
      name_locked: NAME,
      key_version: 1,
      created_by: "u1",
      role: "owner",
      members: [{ user_id: "u1", role: "owner", starts_at: NOW, ends_at: null, history_from: 0 }],
    });
    expect(await count(w.db, "SELECT count(*) AS n FROM groups WHERE id = ? AND created_by = 'u1'", G1)).toBe(1);
  });

  test("accepts kind personal and returns 201", async () => {
    const w = await world();
    const res = await call(w, "u1", "POST", "/v1/groups", { id: G1, kind: "personal", name_locked: NAME });
    expect(res.status).toBe(201);
  });

  test("a taken id is 409 'group id taken' and leaves one groups row", async () => {
    const w = await world();
    const body = { id: G1, kind: "shared", name_locked: NAME };
    expect((await call(w, "u1", "POST", "/v1/groups", body)).status).toBe(201);
    const res = await call(w, "u1", "POST", "/v1/groups", body);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "conflict", message: "group id taken" });
    expect(await count(w.db, "SELECT count(*) AS n FROM groups")).toBe(1);
  });

  test("the same request with the same Idempotency-Key gets the first reply again, and one groups row", async () => {
    const w = await world();
    const body = { id: G1, kind: "shared", name_locked: NAME };
    const first = await call(w, "u1", "POST", "/v1/groups", body, "same-key-0001-abcd");
    const firstBody = await first.json();
    const second = await call(w, "u1", "POST", "/v1/groups", body, "same-key-0001-abcd");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await second.json()).toEqual(firstBody);
    expect(await count(w.db, "SELECT count(*) AS n FROM groups")).toBe(1);
  });

  test("a bad body (a 15-character id, or an extra key) is 400 and writes nothing", async () => {
    const w = await world();
    const short = await call(w, "u1", "POST", "/v1/groups", { id: "a".repeat(15), kind: "shared", name_locked: NAME });
    const extra = await call(w, "u1", "POST", "/v1/groups", { id: G1, kind: "shared", name_locked: NAME, extra: true });
    expect(short.status).toBe(400);
    expect(extra.status).toBe(400);
    expect(await count(w.db, "SELECT count(*) AS n FROM groups")).toBe(0);
  });

  test("with 100 current memberships already, is 409 'too many groups'", async () => {
    const w = await world();
    for (let i = 0; i < 100; i++) {
      const id = `grp_${String(i).padStart(12, "0")}`;
      await seedGroup(w.db, id);
      await seedMember(w.db, id, "u1", { role: "owner" });
    }
    const res = await call(w, "u1", "POST", "/v1/groups", { id: G1, kind: "shared", name_locked: NAME });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ message: "too many groups" });
  });

  test("without a device signature is 401 and writes nothing", async () => {
    const w = await world();
    const res = await unsigned(w, "u1", "POST", "/v1/groups", { id: G1, kind: "shared", name_locked: NAME });
    expect(res.status).toBe(401);
    expect(await count(w.db, "SELECT count(*) AS n FROM groups")).toBe(0);
  });
});

describe("GET /v1/groups", () => {
  test("with no groups returns an empty list", async () => {
    const w = await world();
    const res = await appFor(userOf("u1")).request("/v1/groups", {}, { DB: w.db });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ groups: [] });
  });

  test("lists the caller's groups in id order with their active members, and leaves out ended ones", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    await seedMember(w.db, G1, "u2", { role: "editor" });
    await seedMember(w.db, G1, "u3", { role: "viewer", leftAt: NOW - 1000 });
    await seedGroup(w.db, G2);
    await seedMember(w.db, G2, "u1", { role: "viewer" });
    await seedMember(w.db, G2, "u2", { role: "owner", endsAt: NOW });
    await seedGroup(w.db, G3);
    await seedMember(w.db, G3, "u1", { role: "viewer", leftAt: NOW - 1000 });
    await seedGroup(w.db, G4);
    await seedMember(w.db, G4, "u1", { role: "viewer", endsAt: NOW });
    const res = await appFor(userOf("u1")).request("/v1/groups", {}, { DB: w.db });
    const list = GroupListSchema.parse(await res.json());
    expect(list.groups.map((g) => g.id)).toEqual([G1, G2]);
    expect(list.groups.map((g) => g.members.map((m) => m.user_id))).toEqual([["u1", "u2"], ["u1"]]);
  });
});

describe("POST /v1/groups/:id/invites", () => {
  test("by an owner stores the hash and returns 201 with the invite view", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    const res = await call(w, "u1", "POST", `/v1/groups/${G1}/invites`, { token_hash: HASH, role: "viewer", history_from: 0, ends_at: null });
    expect(res.status).toBe(201);
    expect(InviteViewSchema.parse(await res.json())).toEqual({
      group_id: G1,
      role: "viewer",
      history_from: 0,
      ends_at: null,
      expires_at: NOW + 604800000,
    });
    const row = await w.db
      .prepare("SELECT token_hash, created_by, accepted_by FROM invites WHERE token_hash = ?")
      .bind(HASH)
      .first<{ token_hash: string; created_by: string; accepted_by: string | null }>();
    expect(row).toEqual({ token_hash: HASH, created_by: "u1", accepted_by: null });
  });

  test("lowers a later history_from to now and keeps 0 as 0", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    const path = `/v1/groups/${G1}/invites`;
    const later = await call(w, "u1", "POST", path, { token_hash: "a".repeat(64), role: "viewer", history_from: NOW + 5000, ends_at: null });
    expect(InviteViewSchema.parse(await later.json()).history_from).toBe(NOW);
    const whole = await call(w, "u1", "POST", path, { token_hash: "b".repeat(64), role: "viewer", history_from: 0, ends_at: null });
    expect(InviteViewSchema.parse(await whole.json()).history_from).toBe(0);
    const stored = await w.db.prepare("SELECT history_from FROM invites WHERE token_hash = ?").bind("a".repeat(64)).first<{ history_from: number }>();
    expect(stored?.history_from).toBe(NOW);
  });

  test("by an editor is 403, by a non-member is 404, and on a personal group is 409", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    await seedMember(w.db, G1, "u2", { role: "editor" });
    await seedGroup(w.db, GP, "personal");
    await seedMember(w.db, GP, "u1", { role: "owner" });
    const body = { token_hash: "c".repeat(64), role: "viewer", history_from: 0, ends_at: null };
    const editor = await call(w, "u2", "POST", `/v1/groups/${G1}/invites`, body);
    expect(editor.status).toBe(403);
    expect(await editor.json()).toMatchObject({ message: "only an owner can invite" });
    const outsider = await call(w, "u3", "POST", `/v1/groups/${G1}/invites`, body);
    expect(outsider.status).toBe(404);
    const personal = await call(w, "u1", "POST", `/v1/groups/${GP}/invites`, body);
    expect(personal.status).toBe(409);
    expect(await personal.json()).toMatchObject({ message: "personal groups have no invites" });
  });

  test("with ends_at at or before now is 400; role owner with ends_at is 400; role editor with ends_at is 201", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    const path = `/v1/groups/${G1}/invites`;
    const atNow = await call(w, "u1", "POST", path, { token_hash: "d".repeat(64), role: "viewer", history_from: 0, ends_at: NOW });
    expect(atNow.status).toBe(400);
    const ownerEnds = await call(w, "u1", "POST", path, { token_hash: "e".repeat(64), role: "owner", history_from: 0, ends_at: NOW + 1000 });
    expect(ownerEnds.status).toBe(400);
    const editorEnds = await call(w, "u1", "POST", path, { token_hash: "f".repeat(64), role: "editor", history_from: 0, ends_at: NOW + 1000 });
    expect(editorEnds.status).toBe(201);
  });

  test("with 20 open invites already is 409 'too many open invites'; expired and accepted ones do not count", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    for (let i = 0; i < 20; i++) await seedInvite(w.db, `${i}`.padStart(64, "0"), G1);
    await seedInvite(w.db, "e".repeat(64), G1, { expiresAt: NOW - 1 });
    await seedInvite(w.db, "f".repeat(64), G1, { acceptedBy: "u2" });
    const res = await call(w, "u1", "POST", `/v1/groups/${G1}/invites`, { token_hash: "9".repeat(64), role: "viewer", history_from: 0, ends_at: null });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ message: "too many open invites" });
  });

  test("the same token_hash twice is 409 'invite token taken'", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    const path = `/v1/groups/${G1}/invites`;
    const body = { token_hash: HASH, role: "viewer", history_from: 0, ends_at: null };
    expect((await call(w, "u1", "POST", path, body)).status).toBe(201);
    const res = await call(w, "u1", "POST", path, body);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ message: "invite token taken" });
    expect(await count(w.db, "SELECT count(*) AS n FROM invites WHERE token_hash = ?", HASH)).toBe(1);
  });

  test("without a device signature is 401 and stores nothing", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    const res = await unsigned(w, "u1", "POST", `/v1/groups/${G1}/invites`, { token_hash: HASH, role: "viewer", history_from: 0, ends_at: null });
    expect(res.status).toBe(401);
    expect(await count(w.db, "SELECT count(*) AS n FROM invites")).toBe(0);
  });
});

describe("POST /v1/invites/:token/accept", () => {
  test("by u2 makes the membership with the invite's terms and returns 200 with the group view", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    await seedInvite(w.db, HASH, G1, { role: "viewer", historyFrom: NOW - 1000, endsAt: NOW + DAY });
    const res = await call(w, "u2", "POST", `/v1/invites/${TOKEN}/accept`);
    expect(res.status).toBe(200);
    const view = GroupViewSchema.parse(await res.json());
    expect(view.members.map((m) => m.user_id)).toEqual(["u1", "u2"]);
    const row = await w.db
      .prepare("SELECT role, history_from, ends_at, starts_at, left_at FROM memberships WHERE group_id = ? AND user_id = 'u2'")
      .bind(G1)
      .first();
    expect(row).toEqual({ role: "viewer", history_from: NOW - 1000, ends_at: NOW + DAY, starts_at: NOW, left_at: null });
    const invite = await w.db.prepare("SELECT accepted_by FROM invites WHERE token_hash = ?").bind(HASH).first<{ accepted_by: string }>();
    expect(invite?.accepted_by).toBe("u2");
  });

  test("again by u3 is 404 'no such invite' and u3 gets no membership", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    await seedInvite(w.db, HASH, G1);
    expect((await call(w, "u2", "POST", `/v1/invites/${TOKEN}/accept`)).status).toBe(200);
    const res = await call(w, "u3", "POST", `/v1/invites/${TOKEN}/accept`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ message: "no such invite" });
    expect(await count(w.db, "SELECT count(*) AS n FROM memberships WHERE group_id = ? AND user_id = 'u3'", G1)).toBe(0);
  });

  test("an expired, ended, personal-group or unknown invite, or a 42-character token, is 404", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    await seedGroup(w.db, GP, "personal");
    await seedMember(w.db, GP, "u1", { role: "owner" });
    await seedInvite(w.db, await hashOf(TOKEN_EXPIRED), G1, { expiresAt: NOW });
    await seedInvite(w.db, await hashOf(TOKEN_ENDED), G1, { endsAt: NOW });
    await seedInvite(w.db, await hashOf(TOKEN_PERSONAL), GP);
    const tokens = [TOKEN_EXPIRED, TOKEN_ENDED, TOKEN_PERSONAL, "Z".repeat(43), "T".repeat(42)];
    for (const token of tokens) {
      const res = await call(w, "u2", "POST", `/v1/invites/${token}/accept`);
      expect(res.status, token).toBe(404);
    }
    expect(await count(w.db, "SELECT count(*) AS n FROM memberships WHERE user_id = 'u2'")).toBe(0);
  });

  test("by a user who is already an active member is 409 'already a member', and the invite stays unused", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    await seedMember(w.db, G1, "u2", { role: "editor" });
    await seedInvite(w.db, HASH, G1);
    const res = await call(w, "u2", "POST", `/v1/invites/${TOKEN}/accept`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ message: "already a member" });
    const invite = await w.db.prepare("SELECT accepted_by FROM invites WHERE token_hash = ?").bind(HASH).first<{ accepted_by: string | null }>();
    expect(invite?.accepted_by).toBeNull();
  });

  test("into a group with 50 current members is 409 'group is full'", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    for (let i = 0; i < 49; i++) {
      const id = `m${String(i).padStart(2, "0")}`;
      await w.db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)").bind(id, `clerk_${id}`, NOW, `ba_${id}`).run();
      await seedMember(w.db, G1, id, { role: "viewer" });
    }
    expect(await count(w.db, "SELECT count(*) AS n FROM memberships WHERE group_id = ? AND left_at IS NULL", G1)).toBe(50);
    await seedInvite(w.db, HASH, G1);
    const res = await call(w, "u2", "POST", `/v1/invites/${TOKEN}/accept`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ message: "group is full" });
  });

  test("by a former member who left is 200, and the same row takes the invite's role, left_at null and history_from", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    await seedMember(w.db, G1, "u2", { role: "editor", leftAt: NOW - 1000 });
    await seedInvite(w.db, HASH, G1, { role: "viewer", historyFrom: NOW - 500 });
    const res = await call(w, "u2", "POST", `/v1/invites/${TOKEN}/accept`);
    expect(res.status).toBe(200);
    const row = await w.db
      .prepare("SELECT role, left_at, history_from FROM memberships WHERE group_id = ? AND user_id = 'u2'")
      .bind(G1)
      .first();
    expect(row).toEqual({ role: "viewer", left_at: null, history_from: NOW - 500 });
    expect(await count(w.db, "SELECT count(*) AS n FROM memberships WHERE group_id = ? AND user_id = 'u2'", G1)).toBe(1);
  });

  test("by a member whose ends_at has passed but left_at is still null is 200, with the new invite's terms", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    await seedMember(w.db, G1, "u2", { role: "editor", endsAt: NOW - 1 });
    await seedInvite(w.db, HASH, G1, { role: "viewer", historyFrom: NOW - 500, endsAt: null });
    const res = await call(w, "u2", "POST", `/v1/invites/${TOKEN}/accept`);
    expect(res.status).toBe(200);
    const row = await w.db
      .prepare("SELECT role, ends_at, history_from, starts_at, left_at FROM memberships WHERE group_id = ? AND user_id = 'u2'")
      .bind(G1)
      .first();
    expect(row).toEqual({ role: "viewer", ends_at: null, history_from: NOW - 500, starts_at: NOW, left_at: null });
  });

  test("without a device signature is 401 and makes no membership", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    await seedInvite(w.db, HASH, G1);
    const res = await unsigned(w, "u2", "POST", `/v1/invites/${TOKEN}/accept`);
    expect(res.status).toBe(401);
    expect(await count(w.db, "SELECT count(*) AS n FROM memberships WHERE user_id = 'u2'")).toBe(0);
  });

  test("the invites table never holds the token itself, only its hash", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "owner" });
    const create = await call(w, "u1", "POST", `/v1/groups/${G1}/invites`, { token_hash: HASH, role: "viewer", history_from: 0, ends_at: null });
    expect(create.status).toBe(201);
    expect((await call(w, "u2", "POST", `/v1/invites/${TOKEN}/accept`)).status).toBe(200);
    const rows = (await w.db.prepare("SELECT * FROM invites").all<Record<string, unknown>>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(HASH);
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
  });
});

describe("activeMembership", () => {
  test("gives null when ends_at is now or a membership has left, and the row when ends_at is later", async () => {
    const w = await world();
    await seedGroup(w.db, G1);
    await seedMember(w.db, G1, "u1", { role: "editor", endsAt: NOW });
    await seedMember(w.db, G1, "u2", { role: "editor", endsAt: NOW + 1 });
    await seedMember(w.db, G1, "u3", { role: "editor", leftAt: NOW });
    expect(await activeMembership(w.db, G1, "u1", NOW)).toBeNull();
    expect(await activeMembership(w.db, G1, "u2", NOW)).toEqual({ kind: "shared", key_version: 1, role: "editor", history_from: 0, ends_at: NOW + 1 });
    expect(await activeMembership(w.db, G1, "u3", NOW)).toBeNull();
  });
});
