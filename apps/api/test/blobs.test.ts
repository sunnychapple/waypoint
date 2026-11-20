import { BlobStoredSchema } from "@waypoint/contracts";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import { type BlobBucket, BYTES_PER_GB, blobRoutes } from "../src/blobs/routes.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { BatchDb } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";

const NOW = 1_763_560_000_000;
const G = "group_aaaaaaaaaaaa";
const G2 = "group_bbbbbbbbbbbb";
const BLOB = "blob_aaaaaaaaaaaaaaaa";
const BLOB2 = "blob_bbbbbbbbbbbbbbbb";
const BLOB3 = "blob_cccccccccccccccc";

export const bucketFits: (bucket: R2Bucket) => BlobBucket = (bucket) => bucket;

type Who = "u1" | "u2" | "u3" | "u4";
const PLANS: Record<Who, SessionUser["plan"]> = { u1: "plus", u2: "plus", u3: "free", u4: "plus" };

function userOf(id: Who): SessionUser {
  return { id, clerk_id: `clerk_${id}`, plan: PLANS[id], billing_account_id: `ba_${id}`, zero_retention: false };
}

function appFor(who: Who): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", userOf(who));
    await next();
  });
  app.route("/", blobRoutes({ now: () => NOW }));
  return app;
}

// An in-memory R2 stand-in: put reads the stream into bytes and keeps them; the size it reports can be changed.
function memoryBucket(options: { putError?: Error; sizeDelta?: number } = {}) {
  const objects = new Map<string, Uint8Array>();
  const state = { puts: 0 };
  const bucket: BlobBucket = {
    async put(key, value) {
      state.puts += 1;
      if (options.putError !== undefined) throw options.putError;
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, bytes);
      return { size: bytes.byteLength + (options.sizeDelta ?? 0) };
    },
    async get(key) {
      const bytes = objects.get(key);
      if (bytes === undefined) return null;
      const body = new Response(bytes).body;
      if (body === null) throw new Error("no body");
      return { body, size: bytes.byteLength };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { bucket, objects, state };
}

// Users u1 (plus, owner of G), u2 (plus, viewer of G), u3 (free, editor of G), u4 (plus, in no group).
// u1 is also owner of G2.
async function world(): Promise<{ db: BatchDb }> {
  const db = createTestDb();
  for (const who of ["u1", "u2", "u3", "u4"] as const) {
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, plan, billing_account_id) VALUES (?, ?, ?, ?, ?)").bind(who, `clerk_${who}`, NOW, PLANS[who], `ba_${who}`).run();
  }
  await db.prepare("INSERT INTO groups (id, kind, name_locked, created_by) VALUES (?, 'shared', 'sealed', 'u1')").bind(G).run();
  await db.prepare("INSERT INTO groups (id, kind, name_locked, created_by) VALUES (?, 'shared', 'sealed', 'u1')").bind(G2).run();
  const members: [string, string, string][] = [
    [G, "u1", "owner"],
    [G, "u2", "viewer"],
    [G, "u3", "editor"],
    [G2, "u1", "owner"],
  ];
  for (const [group, user, role] of members) {
    await db.prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES (?, ?, ?, ?, 0)").bind(group, user, role, NOW).run();
  }
  return { db };
}

function put(app: Hono<AppEnv>, env: object, query: string, body: Uint8Array | null, length: string | null = body === null ? null : String(body.byteLength)) {
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  if (length !== null) headers["Content-Length"] = length;
  return app.request(`/v1/blobs?${query}`, { method: "POST", headers, body }, env);
}

function query(blobId: string, group = G): string {
  return `group=${group}&id=${blobId}`;
}

function bytesOf(n: number, fill = 7): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

async function rowCount(db: BatchDb, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("POST /v1/blobs", () => {
  test("u1 uploads 100 bytes: 201 with the file's id, group and size, the bytes at groups/<group>/media/<id>, and a stored row", async () => {
    const { db } = await world();
    const { bucket, objects } = memoryBucket();
    const data = bytesOf(100);
    const res = await put(appFor("u1"), { DB: db, BUCKET: bucket }, query(BLOB), data);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(BlobStoredSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ id: BLOB, group_id: G, bytes: 100 });
    expect(objects.get(`groups/${G}/media/${BLOB}`)).toEqual(data);
    const row = await db.prepare("SELECT user_id, bytes, stored_at FROM blobs WHERE id = ?").bind(BLOB).first<{ user_id: string; bytes: number; stored_at: number }>();
    expect(row).toEqual({ user_id: "u1", bytes: 100, stored_at: NOW });
  });

  test("the same upload again: 200 with the same body, and the bucket was written once", async () => {
    const { db } = await world();
    const { bucket, state } = memoryBucket();
    const env = { DB: db, BUCKET: bucket };
    const first = await put(appFor("u1"), env, query(BLOB), bytesOf(100));
    const again = await put(appFor("u1"), env, query(BLOB), bytesOf(100));
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id: BLOB, group_id: G, bytes: 100 });
    expect(state.puts).toBe(1);
  });

  test("a row for the same id still uploading (same group, user and size) is uploaded again: 201 and stored_at is set", async () => {
    const { db } = await world();
    await db.prepare("INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at) VALUES (?, ?, 'u1', 100, ?, NULL)").bind(BLOB, G, NOW).run();
    const { bucket, state } = memoryBucket();
    const res = await put(appFor("u1"), { DB: db, BUCKET: bucket }, query(BLOB), bytesOf(100));
    expect(res.status).toBe(201);
    expect(state.puts).toBe(1);
    const row = await db.prepare("SELECT stored_at FROM blobs WHERE id = ?").bind(BLOB).first<{ stored_at: number }>();
    expect(row?.stored_at).toBe(NOW);
  });

  test("the same id with another size, another group or by another user is 409 blob id taken", async () => {
    const { db } = await world();
    const { bucket } = memoryBucket();
    const env = { DB: db, BUCKET: bucket };
    expect((await put(appFor("u1"), env, query(BLOB), bytesOf(100))).status).toBe(201);
    const otherSize = await put(appFor("u1"), env, query(BLOB), bytesOf(101));
    expect(otherSize.status).toBe(409);
    expect(await otherSize.json()).toMatchObject({ code: "conflict", message: "blob id taken" });
    const otherGroup = await put(appFor("u1"), env, query(BLOB, G2), bytesOf(100));
    expect(otherGroup.status).toBe(409);
    expect(await otherGroup.json()).toMatchObject({ code: "conflict", message: "blob id taken" });
    // u4 (plus) becomes an editor of G for this check only, so the id check (not the plan or role check) decides.
    await db.prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES (?, 'u4', 'editor', ?, 0)").bind(G, NOW).run();
    const otherUser = await put(appFor("u4"), env, query(BLOB), bytesOf(100));
    expect(otherUser.status).toBe(409);
    expect(await otherUser.json()).toMatchObject({ code: "conflict", message: "blob id taken" });
  });

  test("u3 on the free plan is 403 plan_required and nothing is stored", async () => {
    const { db } = await world();
    const { bucket, state } = memoryBucket();
    const res = await put(appFor("u3"), { DB: db, BUCKET: bucket }, query(BLOB), bytesOf(100));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "plan_required", message: "media sync needs a paid plan" });
    expect(state.puts).toBe(0);
    expect(await rowCount(db, "SELECT COUNT(*) AS n FROM blobs")).toBe(0);
  });

  test("u2 (viewer) is 403 and u4 (not a member) is 404", async () => {
    const { db } = await world();
    const { bucket, state } = memoryBucket();
    const env = { DB: db, BUCKET: bucket };
    expect((await put(appFor("u2"), env, query(BLOB), bytesOf(100))).status).toBe(403);
    expect((await put(appFor("u4"), env, query(BLOB), bytesOf(100))).status).toBe(404);
    expect(state.puts).toBe(0);
    expect(await rowCount(db, "SELECT COUNT(*) AS n FROM blobs")).toBe(0);
  });

  test("no Content-Length, a size of 32 bytes, a size of 95,000,001 bytes, a bad group id or a bad blob id is 400 and nothing is stored", async () => {
    const { db } = await world();
    const { bucket, state } = memoryBucket();
    const env = { DB: db, BUCKET: bucket };
    const app = appFor("u1");
    const cases = [
      await put(app, env, query(BLOB), null, null),
      await put(app, env, query(BLOB), bytesOf(32)),
      await put(app, env, query(BLOB), bytesOf(1), "95000001"),
      await put(app, env, query(BLOB, "bad"), bytesOf(100)),
      await put(app, env, query("short"), bytesOf(100)),
    ];
    for (const res of cases) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "bad_request" });
    }
    expect(state.puts).toBe(0);
    expect(await rowCount(db, "SELECT COUNT(*) AS n FROM blobs")).toBe(0);
  });

  test("with 3 GB minus 150 bytes already counted, 151 bytes is 409 media storage is full and adds no row; 150 bytes is 201", async () => {
    const { db } = await world();
    await db.prepare("INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at) VALUES (?, ?, 'u1', ?, ?, ?)").bind(BLOB3, G, 3 * BYTES_PER_GB - 150, NOW, NOW).run();
    const { bucket } = memoryBucket();
    const env = { DB: db, BUCKET: bucket };
    const full = await put(appFor("u1"), env, query(BLOB), bytesOf(151));
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ code: "conflict", message: "media storage is full" });
    expect(await rowCount(db, "SELECT COUNT(*) AS n FROM blobs WHERE id = ?", BLOB)).toBe(0);
    const exact = await put(appFor("u1"), env, query(BLOB), bytesOf(150));
    expect(exact.status).toBe(201);
  });

  test("an open entitlement with media_cap_gb 5 raises the cap so 151 bytes is 201; an ended one does not", async () => {
    const withOpen = await world();
    await withOpen.db.prepare("INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at) VALUES (?, ?, 'u1', ?, ?, ?)").bind(BLOB3, G, 3 * BYTES_PER_GB - 150, NOW, NOW).run();
    await withOpen.db.prepare("INSERT INTO entitlements (user_id, product, source, media_cap_gb, granted_at, ended_at) VALUES ('u1', 'waypoint', 'purchase', 5, ?, NULL)").bind(NOW).run();
    const raised = await put(appFor("u1"), { DB: withOpen.db, BUCKET: memoryBucket().bucket }, query(BLOB), bytesOf(151));
    expect(raised.status).toBe(201);

    const withEnded = await world();
    await withEnded.db.prepare("INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at) VALUES (?, ?, 'u1', ?, ?, ?)").bind(BLOB3, G, 3 * BYTES_PER_GB - 150, NOW, NOW).run();
    await withEnded.db.prepare("INSERT INTO entitlements (user_id, product, source, media_cap_gb, granted_at, ended_at) VALUES ('u1', 'waypoint', 'purchase', 5, ?, ?)").bind(NOW, NOW - 1).run();
    const notRaised = await put(appFor("u1"), { DB: withEnded.db, BUCKET: memoryBucket().bucket }, query(BLOB), bytesOf(151));
    expect(notRaised.status).toBe(409);
  });

  test("a still-uploading row of u1 counts toward the cap: 151 bytes is 409 when it holds 3 GB minus 150 bytes", async () => {
    const { db } = await world();
    await db.prepare("INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at) VALUES (?, ?, 'u1', ?, ?, NULL)").bind(BLOB3, G, 3 * BYTES_PER_GB - 150, NOW).run();
    const res = await put(appFor("u1"), { DB: db, BUCKET: memoryBucket().bucket }, query(BLOB), bytesOf(151));
    expect(res.status).toBe(409);
    expect(await rowCount(db, "SELECT COUNT(*) AS n FROM blobs WHERE id = ?", BLOB)).toBe(0);
  });

  test("a bucket whose put throws is 500 internal, and the reserved row is gone", async () => {
    const { db } = await world();
    const { bucket } = memoryBucket({ putError: new Error("R2 down") });
    const res = await put(appFor("u1"), { DB: db, BUCKET: bucket }, query(BLOB), bytesOf(100));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "internal" });
    expect(await rowCount(db, "SELECT COUNT(*) AS n FROM blobs WHERE id = ?", BLOB)).toBe(0);
  });

  test("the reservation deleted while the upload ran (a failed retry of the same id): 409 upload interrupted, and the object is deleted", async () => {
    const { db } = await world();
    const { bucket, objects } = memoryBucket();
    const racing: BlobBucket = {
      ...bucket,
      async put(key, value, options) {
        const stored = await bucket.put(key, value, options);
        await db.prepare("DELETE FROM blobs WHERE id = ? AND stored_at IS NULL").bind(BLOB).run();
        return stored;
      },
    };
    const res = await put(appFor("u1"), { DB: db, BUCKET: racing }, query(BLOB), bytesOf(100));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "upload interrupted, try again", retry_after: null });
    expect(objects.size).toBe(0);
    expect(await rowCount(db, "SELECT COUNT(*) AS n FROM blobs WHERE id = ?", BLOB)).toBe(0);
  });

  test("a bucket that reports another size is 400 upload incomplete; the object and the row are gone", async () => {
    const { db } = await world();
    const { bucket, objects } = memoryBucket({ sizeDelta: 1 });
    const res = await put(appFor("u1"), { DB: db, BUCKET: bucket }, query(BLOB), bytesOf(100));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad_request", message: "upload incomplete" });
    expect(objects.size).toBe(0);
    expect(await rowCount(db, "SELECT COUNT(*) AS n FROM blobs WHERE id = ?", BLOB)).toBe(0);
  });
});

describe("GET /v1/blobs/:id", () => {
  test("a viewer (u2) gets 200 with the bytes, application/octet-stream, Content-Length 100 and Cache-Control private, no-store", async () => {
    const { db } = await world();
    const { bucket } = memoryBucket();
    const env = { DB: db, BUCKET: bucket };
    const data = bytesOf(100, 9);
    expect((await put(appFor("u1"), env, query(BLOB), data)).status).toBe(201);
    const res = await appFor("u2").request(`/v1/blobs/${BLOB}`, { method: "GET" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Length")).toBe("100");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(data);
  });

  test("u4 (not a member), a row still uploading, a row whose object is missing, and an unknown id are all 404", async () => {
    const { db } = await world();
    const { bucket, objects } = memoryBucket();
    const env = { DB: db, BUCKET: bucket };
    expect((await put(appFor("u1"), env, query(BLOB), bytesOf(100))).status).toBe(201);
    const denied = await appFor("u4").request(`/v1/blobs/${BLOB}`, { method: "GET" }, env);
    expect(denied.status).toBe(404);

    await db.prepare("INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at) VALUES (?, ?, 'u1', 100, ?, NULL)").bind(BLOB2, G, NOW).run();
    const uploading = await appFor("u2").request(`/v1/blobs/${BLOB2}`, { method: "GET" }, env);
    expect(uploading.status).toBe(404);

    await db.prepare("INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at) VALUES (?, ?, 'u1', 100, ?, ?)").bind(BLOB3, G, NOW, NOW).run();
    const missing = await appFor("u2").request(`/v1/blobs/${BLOB3}`, { method: "GET" }, env);
    expect(missing.status).toBe(404);
    expect(objects.has(`groups/${G}/media/${BLOB3}`)).toBe(false);

    const unknown = await appFor("u2").request("/v1/blobs/blob_zzzzzzzzzzzzzzzz", { method: "GET" }, env);
    expect(unknown.status).toBe(404);
  });

  test("a member whose history_from is after the file's created_at is 404", async () => {
    const { db } = await world();
    const { bucket } = memoryBucket();
    const env = { DB: db, BUCKET: bucket };
    expect((await put(appFor("u1"), env, query(BLOB), bytesOf(100))).status).toBe(201);
    await db.prepare("UPDATE memberships SET history_from = ? WHERE group_id = ? AND user_id = 'u2'").bind(NOW + 1, G).run();
    const res = await appFor("u2").request(`/v1/blobs/${BLOB}`, { method: "GET" }, env);
    expect(res.status).toBe(404);
  });
});
