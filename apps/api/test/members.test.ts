import { GroupListSchema, MembershipEndedSchema } from "@waypoint/contracts";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { MAX_EXPIRED_PER_RUN, endExpiredMemberships } from "../src/groups/expiry.ts";
import { memberRoutes } from "../src/groups/members.ts";
import { groupRoutes } from "../src/groups/routes.ts";
import type { BatchDb } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const DAY = 24 * 60 * 60 * 1000;
const G1 = "group_aaaaaaaaaaaa";
const G2 = "group_bbbbbbbbbbbb";
const G3 = "group_cccccccccccc";
const NAME = "bmFtZS1sb2NrZWQ";
const KEY = "k".repeat(20);

type Who = "u1" | "u2" | "u3" | "u4";
type World = { db: BatchDb; d: Record<Who, TestDevice> };

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
  app.route("/", memberRoutes({ now: () => NOW }));
  return app;
}

// Users u1 to u4, each with one approved device.
async function world(): Promise<World> {
  const db = createTestDb();
  const d = { u1: await makeTestDevice("dev_u1"), u2: await makeTestDevice("dev_u2"), u3: await makeTestDevice("dev_u3"), u4: await makeTestDevice("dev_u4") };
  for (const who of ["u1", "u2", "u3", "u4"] as const) {
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
async function unsigned(w: World, who: Who, method: string, path: string): Promise<Response> {
  return appFor(userOf(who)).request(path, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": KEY } }, { DB: w.db });
}

async function count(db: BatchDb, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ n: number }>();
  return row?.n ?? 0;
}

async function keyVersion(db: BatchDb, groupId: string): Promise<number> {
  const row = await db.prepare("SELECT key_version FROM groups WHERE id = ?").bind(groupId).first<{ key_version: number }>();
  return row?.key_version ?? 0;
}

async function leftAt(db: BatchDb, groupId: string, userId: string): Promise<number | null | undefined> {
  const row = await db.prepare("SELECT left_at FROM memberships WHERE group_id = ? AND user_id = ?").bind(groupId, userId).first<{ left_at: number | null }>();
  return row?.left_at;
}

async function seedGroup(db: BatchDb, id: string, kind: "personal" | "shared" = "shared"): Promise<void> {
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES (?, ?, ?, 1, 'u1')").bind(id, kind, NAME).run();
}

type Seat = { role: "owner" | "editor" | "viewer"; endsAt?: number | null; leftAt?: number | null };

async function seedMember(db: BatchDb, groupId: string, userId: string, seat: Seat): Promise<void> {
  await db
    .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, ends_at, history_from, left_at) VALUES (?, ?, ?, ?, ?, 0, ?)")
    .bind(groupId, userId, seat.role, NOW, seat.endsAt ?? null, seat.leftAt ?? null)
    .run();
}

// G1: u1 owner, u2 editor, u3 viewer (key version 1). G2: u2 owner.
async function groupWorld(): Promise<World> {
  const w = await world();
  await seedGroup(w.db, G1);
  await seedMember(w.db, G1, "u1", { role: "owner" });
  await seedMember(w.db, G1, "u2", { role: "editor" });
  await seedMember(w.db, G1, "u3", { role: "viewer" });
  await seedGroup(w.db, G2);
  await seedMember(w.db, G2, "u2", { role: "owner" });
  return w;
}

describe("DELETE /v1/groups/:id/members/:user", () => {
  test("an owner removes an editor: 200 with the new key version, the row has left_at, the other group is unchanged", async () => {
    const w = await groupWorld();
    const res = await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u2`);
    expect(res.status).toBe(200);
    expect(MembershipEndedSchema.parse(await res.json())).toEqual({ group_id: G1, user_id: "u2", key_version: 2 });
    expect(await leftAt(w.db, G1, "u2")).toBe(NOW);
    expect(await keyVersion(w.db, G1)).toBe(2);
    expect(await keyVersion(w.db, G2)).toBe(1);
  });

  test("a member leaves by removing themselves: 200 and the key version is bumped", async () => {
    const w = await groupWorld();
    const res = await call(w, "u2", "DELETE", `/v1/groups/${G1}/members/u2`);
    expect(res.status).toBe(200);
    expect(MembershipEndedSchema.parse(await res.json())).toEqual({ group_id: G1, user_id: "u2", key_version: 2 });
    expect(await leftAt(w.db, G1, "u2")).toBe(NOW);
    expect(await keyVersion(w.db, G1)).toBe(2);
  });

  test("an editor removing a viewer is 403 'only an owner can remove members' and changes nothing", async () => {
    const w = await groupWorld();
    const res = await call(w, "u2", "DELETE", `/v1/groups/${G1}/members/u3`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "forbidden", message: "only an owner can remove members" });
    expect(await leftAt(w.db, G1, "u3")).toBeNull();
    expect(await keyVersion(w.db, G1)).toBe(1);
  });

  test("a caller who is not an active member is 404 'no such group'", async () => {
    const w = await groupWorld();
    const res = await call(w, "u4", "DELETE", `/v1/groups/${G1}/members/u3`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found", message: "no such group" });
    expect(await keyVersion(w.db, G1)).toBe(1);
  });

  test("an unknown target, or one who already left, is 404 'no such member'", async () => {
    const w = await groupWorld();
    const unknown = await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u9`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "not_found", message: "no such member" });
    expect((await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u2`)).status).toBe(200);
    const again = await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u2`);
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ code: "not_found", message: "no such member" });
    expect(await keyVersion(w.db, G1)).toBe(2);
  });

  test("the only owner leaving is 409 'a group needs an owner' and changes nothing", async () => {
    const w = await groupWorld();
    const res = await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u1`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "conflict", message: "a group needs an owner" });
    expect(await leftAt(w.db, G1, "u1")).toBeNull();
    expect(await keyVersion(w.db, G1)).toBe(1);
  });

  test("with two owners, one may be removed; then the last owner cannot leave", async () => {
    const w = await groupWorld();
    await w.db.prepare("UPDATE memberships SET role = 'owner' WHERE group_id = ? AND user_id = 'u2'").bind(G1).run();
    expect((await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u2`)).status).toBe(200);
    const last = await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u1`);
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ code: "conflict", message: "a group needs an owner" });
    expect(await leftAt(w.db, G1, "u1")).toBeNull();
  });

  test("the only member of a group cannot leave: 409 'a group needs an owner'", async () => {
    const w = await world();
    await seedGroup(w.db, G3);
    await seedMember(w.db, G3, "u1", { role: "owner" });
    const res = await call(w, "u1", "DELETE", `/v1/groups/${G3}/members/u1`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "conflict", message: "a group needs an owner" });
    expect(await keyVersion(w.db, G3)).toBe(1);
  });

  test("ending a membership withdraws open invites the user made in that group only; accepted ones and other people's stay", async () => {
    const w = await groupWorld();
    await w.db.prepare("UPDATE memberships SET role = 'owner' WHERE group_id = ? AND user_id = 'u2'").bind(G1).run();
    const invite = (token: string, group: string, by: string, acceptedBy: string | null) =>
      w.db
        .prepare("INSERT INTO invites (token_hash, group_id, role, expires_at, accepted_by, created_by, history_from, ends_at) VALUES (?, ?, 'viewer', ?, ?, ?, 0, NULL)")
        .bind(token, group, NOW + 7 * DAY, acceptedBy, by)
        .run();
    await invite("open_by_u1_in_g1", G1, "u1", null);
    await invite("accepted_by_u1_in_g1", G1, "u1", "u3");
    await invite("open_by_u2_in_g1", G1, "u2", null);
    await invite("open_by_u1_in_g2", G2, "u1", null);
    expect((await call(w, "u2", "DELETE", `/v1/groups/${G1}/members/u1`)).status).toBe(200);
    const left = await w.db.prepare("SELECT token_hash FROM invites ORDER BY token_hash").all<{ token_hash: string }>();
    expect(left.results.map((r) => r.token_hash)).toEqual(["accepted_by_u1_in_g1", "open_by_u1_in_g2", "open_by_u2_in_g1"]);
  });

  test("after a removal the removed member's group list no longer has that group", async () => {
    const w = await groupWorld();
    expect((await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u2`)).status).toBe(200);
    const res = await appFor(userOf("u2")).request("/v1/groups", { method: "GET" }, { DB: w.db });
    expect(res.status).toBe(200);
    const list = GroupListSchema.parse(await res.json());
    expect(list.groups.map((g) => g.id)).toEqual([G2]);
  });

  test("the same request with the same Idempotency-Key gets the first reply again and the key version is bumped once", async () => {
    const w = await groupWorld();
    const first = await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u2`, undefined, "same-key-0001-abcd");
    const second = await call(w, "u1", "DELETE", `/v1/groups/${G1}/members/u2`, undefined, "same-key-0001-abcd");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(await keyVersion(w.db, G1)).toBe(2);
  });

  test("without a device signature it is 401 and changes nothing", async () => {
    const w = await groupWorld();
    const res = await unsigned(w, "u1", "DELETE", `/v1/groups/${G1}/members/u2`);
    expect(res.status).toBe(401);
    expect(await leftAt(w.db, G1, "u2")).toBeNull();
    expect(await keyVersion(w.db, G1)).toBe(1);
  });
});

describe("endExpiredMemberships", () => {
  test("ends passed end dates (left_at = ends_at, group bumped) and leaves future, open-ended, and already-left rows alone", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'ba1')").run();
    await seedGroup(db, G1);
    await seedGroup(db, G2);
    await seedGroup(db, G3);
    await seedMember(db, G1, "u1", { role: "owner", endsAt: NOW - 1 });
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u2', 'clerk_u2', 0, 'ba2')").run();
    await seedMember(db, G2, "u2", { role: "viewer", endsAt: NOW });
    await seedMember(db, G3, "u1", { role: "owner", endsAt: NOW + 1 });
    await seedMember(db, G3, "u2", { role: "viewer", endsAt: null });
    await seedMember(db, G1, "u2", { role: "viewer", endsAt: NOW - 5, leftAt: NOW - 5 });

    expect(await endExpiredMemberships(db, NOW)).toBe(2);
    const g1 = await db.prepare("SELECT left_at FROM memberships WHERE group_id = ? AND user_id = 'u1'").bind(G1).first<{ left_at: number }>();
    expect(g1?.left_at).toBe(NOW - 1);
    expect(await leftAt(db, G2, "u2")).toBe(NOW);
    expect(await keyVersion(db, G1)).toBe(2);
    expect(await keyVersion(db, G2)).toBe(2);
    expect(await keyVersion(db, G3)).toBe(1);
    expect(await leftAt(db, G3, "u1")).toBeNull();
    expect(await leftAt(db, G3, "u2")).toBeNull();
    expect(await leftAt(db, G1, "u2")).toBe(NOW - 5);
    expect(await endExpiredMemberships(db, NOW)).toBe(0);
  });

  test("ends at most MAX_EXPIRED_PER_RUN per run, earliest end date first", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'ba1')").run();
    await seedGroup(db, G1);
    const total = MAX_EXPIRED_PER_RUN + 1;
    for (let i = 0; i < total; i++) {
      await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, 0, ?)").bind(`x${i}`, `clerk_x${i}`, `bax${i}`).run();
      // x0 ends last (NOW - 1), x500 first (NOW - 501).
      await seedMember(db, G1, `x${i}`, { role: "viewer", endsAt: NOW - 1 - i });
    }
    expect(await endExpiredMemberships(db, NOW)).toBe(MAX_EXPIRED_PER_RUN);
    expect(await count(db, "SELECT count(*) AS n FROM memberships WHERE group_id = ? AND left_at IS NULL", G1)).toBe(1);
    expect(await leftAt(db, G1, "x0")).toBeNull();
    expect(await leftAt(db, G1, `x${total - 1}`)).toBe(NOW - total);
    expect(await keyVersion(db, G1)).toBe(1 + MAX_EXPIRED_PER_RUN);
  });
});
