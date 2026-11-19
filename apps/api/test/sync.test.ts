import { ChangesPageSchema, PostChangeResponseSchema, type ApiError } from "@waypoint/contracts";
import { context, fromBase64Url, importContentKey, lockContent, toBase64Url, utf8 } from "@waypoint/crypto";
import { Hono } from "hono";
import { expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { PushMessageSchema } from "../src/push/messages.ts";
import { syncRoutes } from "../src/sync/routes.ts";
import type { BatchDb } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { fakeRoomNamespace } from "./helpers/room.ts";
import { insertDevice, makeTestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const G = "group_aaaaaaaaaaaa";
const CHANGES = `/v1/groups/${G}/changes`;
const SYNC = `/v1/groups/${G}/sync`;
const CONTENT_KEY = await importContentKey(new Uint8Array(32).fill(7));

// Device ids are at least 8 characters: PushMessageSchema refuses shorter ones.
const U1A = "device_u1a";
const U1B = "device_u1b";
const U2A = "device_u2a";
const U2WAIT = "device_u2wait";
const U2OLD = "device_u2old";
const U3A = "device_u3a";
const U4A = "device_u4a";

type Env = {
  DB: BatchDb;
  GROUP_ROOM: ReturnType<typeof fakeRoomNamespace>;
  PUSH_QUEUE: { sendBatch(messages: { body: unknown }[]): Promise<void> };
};

type World = { env: Env; clock: { at: number }; sent: { body: unknown }[] };

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
  app.route("/", syncRoutes({ now: () => NOW }));
  return app;
}

async function addUser(db: BatchDb, id: string): Promise<void> {
  await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)").bind(id, `clerk_${id}`, NOW, `ba_${id}`).run();
}

// Group G (key version 2): u1 owner, u2 editor, u3 viewer whose history starts one millisecond after NOW.
// u1 has two phones, u2 one phone plus a waiting and a removed phone, u3 one phone.
async function world(): Promise<World> {
  const db = createTestDb();
  const clock = { at: NOW };
  const sent: { body: unknown }[] = [];
  for (const id of ["u1", "u2", "u3"]) await addUser(db, id);
  for (const [userId, deviceId, approvedAt, removedAt] of [
    ["u1", U1A, NOW, null],
    ["u1", U1B, NOW, null],
    ["u2", U2A, NOW, null],
    ["u2", U2WAIT, null, null],
    ["u2", U2OLD, NOW, NOW],
    ["u3", U3A, NOW, null],
  ] as const) {
    await insertDevice(db, await makeTestDevice(deviceId), { userId, approvedAt, removedAt });
  }
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES (?, 'shared', 'sealed', 2, 'u1')").bind(G).run();
  await db.prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES (?, 'u1', 'owner', ?, 0)").bind(G, NOW).run();
  await db.prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES (?, 'u2', 'editor', ?, 0)").bind(G, NOW).run();
  await db.prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES (?, 'u3', 'viewer', ?, ?)").bind(G, NOW, NOW + 1).run();
  const room = fakeRoomNamespace(() => clock.at);
  const env: Env = {
    DB: db,
    GROUP_ROOM: room,
    PUSH_QUEUE: {
      sendBatch: async (messages) => {
        sent.push(...messages);
      },
    },
  };
  return { env, clock, sent };
}

let nonceCount = 0;
function nonce(): Uint8Array {
  nonceCount += 1;
  const out = new Uint8Array(12);
  new DataView(out.buffer).setUint32(8, nonceCount);
  return out;
}

// Locked bytes for a change from `deviceId`, as the app makes them (key version `keyVersion` in the header).
async function sealed(deviceId: string, kind: string, keyVersion = 2, text = "change"): Promise<string> {
  const bytes = await lockContent(CONTENT_KEY, keyVersion, context("change", G, deviceId, kind), utf8(text), nonce());
  return toBase64Url(bytes);
}

function changeBody(deviceId: string, locked: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ device_id: deviceId, key_version: 2, kind: "note_edit", locked_bytes: locked, blob_key: null, ...extra });
}

// An unsigned request as `who`, with an Idempotency-Key (a fresh one unless given).
async function call(env: Env, who: string, method: string, path: string, body?: string, key: string = crypto.randomUUID()): Promise<Response> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json", "Idempotency-Key": key } };
  if (body !== undefined) init.body = body;
  return appFor(userOf(who)).request(path, init, env);
}

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  const body = (await res.json()) as ApiError;
  return { code: body.code, message: body.message };
}

test("u1 posts from device_u1a and gets 201 { seq: 1 }, and the room holds the locked bytes unchanged", async () => {
  const w = await world();
  const locked = await sealed(U1A, "note_edit");
  const res = await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, locked));
  expect(res.status).toBe(201);
  const reply = await res.json();
  expect(PostChangeResponseSchema.safeParse(reply).success).toBe(true);
  expect(reply).toEqual({ seq: 1 });
  const { changes } = w.env.GROUP_ROOM.roomFor(G).store.after(0, 10);
  expect(changes).toHaveLength(1);
  expect(changes[0]!.device_id).toBe(U1A);
  expect(changes[0]!.kind).toBe("note_edit");
  expect(changes[0]!.key_version).toBe(2);
  expect(changes[0]!.blob_key).toBeNull();
  expect(new Uint8Array(changes[0]!.locked_bytes)).toEqual(fromBase64Url(locked));
});

test("a post queues exactly one sync message for each other approved device of an active member, each passing PushMessageSchema", async () => {
  const w = await world();
  const res = await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit")));
  expect(res.status).toBe(201);
  expect(w.sent.map((m) => m.body)).toEqual([
    { user_id: "u1", kind: "sync", ref: G, device_id: U1B },
    { user_id: "u2", kind: "sync", ref: G, device_id: U2A },
    { user_id: "u3", kind: "sync", ref: G, device_id: U3A },
  ]);
  for (const message of w.sent) expect(PushMessageSchema.safeParse(message.body).success).toBe(true);
});

test("a second post from the same minute queues no sync message", async () => {
  const w = await world();
  await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit", 2, "one")));
  expect(w.sent).toHaveLength(3);
  const again = await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit", 2, "two")));
  expect(again.status).toBe(201);
  expect(w.sent).toHaveLength(3);
});

test("a device with an open socket gets { type: changed, last_seq } and no sync push", async () => {
  const w = await world();
  const socket = w.env.GROUP_ROOM.roomFor(G).host.connect([`device:${U2A}`, "user:u2", "until:never"]);
  const res = await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit")));
  expect(res.status).toBe(201);
  expect(socket.sent).toEqual(['{"type":"changed","last_seq":1}']);
  expect(w.sent.map((m) => (m.body as { device_id: string }).device_id)).not.toContain(U2A);
});

test("a PUSH_QUEUE that throws still gives 201 and the change is stored", async () => {
  const w = await world();
  const env: Env = { ...w.env, PUSH_QUEUE: { sendBatch: async () => {
    throw new Error("queue unavailable");
  } } };
  const res = await call(env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit")));
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ seq: 1 });
  expect(w.env.GROUP_ROOM.roomFor(G).store.after(0, 10).changes).toHaveLength(1);
});

test("the same request with the same Idempotency-Key returns the stored { seq: 1 } and the room keeps one change", async () => {
  const w = await world();
  const body = changeBody(U1A, await sealed(U1A, "note_edit"));
  const key = crypto.randomUUID();
  const first = await call(w.env, "u1", "POST", CHANGES, body, key);
  expect(first.status).toBe(201);
  const replay = await call(w.env, "u1", "POST", CHANGES, body, key);
  expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
  expect(await replay.json()).toEqual({ seq: 1 });
  expect(w.env.GROUP_ROOM.roomFor(G).store.after(0, 10).changes).toHaveLength(1);
});

test("a viewer's post gets 403 'viewers cannot write'", async () => {
  const w = await world();
  const res = await call(w.env, "u3", "POST", CHANGES, changeBody(U3A, await sealed(U3A, "note_edit")));
  expect(res.status).toBe(403);
  expect(await errorOf(res)).toEqual({ code: "forbidden", message: "viewers cannot write" });
});

test("a device_id that is another user's, waiting or removed gets 403 and nothing is appended", async () => {
  const w = await world();
  for (const deviceId of [U3A, U2WAIT, U2OLD]) {
    const res = await call(w.env, "u1", "POST", CHANGES, changeBody(deviceId, await sealed(deviceId, "note_edit")));
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toEqual({ code: "forbidden", message: "not an approved device of this user" });
  }
  expect(w.env.GROUP_ROOM.roomFor(G).store.after(0, 10).changes).toHaveLength(0);
});

test("a key_version that is not the group's gets 409 'key version is not current' and nothing is appended", async () => {
  const w = await world();
  for (const keyVersion of [1, 3]) {
    const res = await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit", keyVersion), { key_version: keyVersion }));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: "conflict", message: "key version is not current" });
  }
  expect(w.env.GROUP_ROOM.roomFor(G).store.after(0, 10).changes).toHaveLength(0);
});

test("locked bytes with another key version in their header, a blob_key of another group, and bad JSON each get 400", async () => {
  const w = await world();
  const stale = await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit", 1)));
  expect(stale.status).toBe(400);
  const otherGroup = await call(
    w.env,
    "u1",
    "POST",
    CHANGES,
    changeBody(U1A, await sealed(U1A, "note_edit"), { blob_key: "groups/group_bbbbbbbbbbbb/media/blob_cccccccccccccccc" }),
  );
  expect(otherGroup.status).toBe(400);
  const notJson = await call(w.env, "u1", "POST", CHANGES, "{not json");
  expect(notJson.status).toBe(400);
  expect(await errorOf(notJson)).toEqual({ code: "bad_request", message: "invalid request" });
});

test("a non-member and a member whose ends_at is now get 404 on the changes, post and sync routes", async () => {
  const w = await world();
  await addUser(w.env.DB, "u4");
  await insertDevice(w.env.DB, await makeTestDevice(U4A), { userId: "u4" });
  await w.env.DB.prepare("UPDATE memberships SET ends_at = ? WHERE group_id = ? AND user_id = 'u2'").bind(NOW, G).run();
  const locked = await sealed(U2A, "note_edit");
  for (const who of ["u4", "u2"]) {
    const device = who === "u4" ? U4A : U2A;
    expect((await call(w.env, who, "GET", CHANGES)).status).toBe(404);
    expect((await call(w.env, who, "POST", CHANGES, changeBody(device, locked))).status).toBe(404);
    const sync = await appFor(userOf(who)).request(`${SYNC}?device=${device}`, { headers: { Upgrade: "websocket" } }, w.env);
    expect(sync.status).toBe(404);
  }
  expect(w.env.GROUP_ROOM.roomFor(G).fetches).toHaveLength(0);
});

test("GET changes returns 200 with the page, the locked bytes as base64url and key_version 2", async () => {
  const w = await world();
  const locked = await sealed(U1A, "note_edit");
  await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, locked));
  const res = await call(w.env, "u2", "GET", CHANGES);
  expect(res.status).toBe(200);
  const page = await res.json();
  expect(ChangesPageSchema.safeParse(page).success).toBe(true);
  expect(page).toMatchObject({ key_version: 2, last_seq: 1, changes: [{ seq: 1, device_id: U1A, locked_bytes: locked }] });
});

test("GET changes honours after and limit, and refuses after=-1, after=x, limit=0 and limit=501 with 400", async () => {
  const w = await world();
  for (const text of ["one", "two", "three"]) {
    await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit", 2, text)));
  }
  const after = await (await call(w.env, "u1", "GET", `${CHANGES}?after=1`)).json();
  expect((after as { changes: { seq: number }[] }).changes.map((c) => c.seq)).toEqual([2, 3]);
  const limited = await (await call(w.env, "u1", "GET", `${CHANGES}?limit=1`)).json();
  expect((limited as { changes: { seq: number }[] }).changes.map((c) => c.seq)).toEqual([1]);
  for (const query of ["after=-1", "after=x", "limit=0", "limit=501"]) {
    expect((await call(w.env, "u1", "GET", `${CHANGES}?${query}`)).status).toBe(400);
  }
});

test("a viewer's GET changes leaves out changes written before its history_from", async () => {
  const w = await world();
  await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit", 2, "before")));
  w.clock.at = NOW + 1;
  await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit", 2, "after")));
  const page = (await (await call(w.env, "u3", "GET", CHANGES)).json()) as { changes: { seq: number }[] };
  expect(page.changes.map((c) => c.seq)).toEqual([2]);
});

test("GET sync with a WebSocket upgrade is forwarded to the room with the user, device and until headers", async () => {
  const w = await world();
  const res = await appFor(userOf("u1")).request(`${SYNC}?device=${U1A}`, { headers: { Upgrade: "websocket" } }, w.env);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("forwarded to the room");
  const fetches = w.env.GROUP_ROOM.roomFor(G).fetches;
  expect(fetches).toHaveLength(1);
  expect(fetches[0]!.url).toBe("https://group-room/sync");
  expect(fetches[0]!.headers.get("Upgrade")).toBe("websocket");
  expect(fetches[0]!.headers.get("Waypoint-Room-User")).toBe("u1");
  expect(fetches[0]!.headers.get("Waypoint-Room-Device")).toBe(U1A);
  expect(fetches[0]!.headers.get("Waypoint-Room-Until")).toBe("never");
});

test("GET sync for a member with an end date forwards that end date as Waypoint-Room-Until", async () => {
  const w = await world();
  await w.env.DB.prepare("UPDATE memberships SET ends_at = ? WHERE group_id = ? AND user_id = 'u2'").bind(NOW + 5000, G).run();
  const res = await appFor(userOf("u2")).request(`${SYNC}?device=${U2A}`, { headers: { Upgrade: "websocket" } }, w.env);
  expect(res.status).toBe(200);
  expect(w.env.GROUP_ROOM.roomFor(G).fetches[0]!.headers.get("Waypoint-Room-Until")).toBe(String(NOW + 5000));
});

test("GET sync without an upgrade gets 400, and another user's or a waiting device gets 404; nothing is forwarded", async () => {
  const w = await world();
  const plain = await appFor(userOf("u1")).request(`${SYNC}?device=${U1A}`, {}, w.env);
  expect(plain.status).toBe(400);
  for (const deviceId of [U3A, U2WAIT]) {
    const res = await appFor(userOf("u1")).request(`${SYNC}?device=${deviceId}`, { headers: { Upgrade: "websocket" } }, w.env);
    expect(res.status).toBe(404);
  }
  expect(w.env.GROUP_ROOM.roomFor(G).fetches).toHaveLength(0);
});
