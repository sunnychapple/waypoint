import { LinkRevokedSchema, LinkViewSchema, SYNC_DAILY_BYTES } from "@waypoint/contracts";
import { context, importContentKey, linkPasscodeHash, lockContent, toBase64Url, utf8 } from "@waypoint/crypto";
import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { type LinkBucket, linkKey, linkRoutes } from "../src/links/routes.ts";
import { SITEVERIFY_URL, verifyTurnstile } from "../src/links/turnstile.ts";
import type { BatchDb } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const G = "group_aaaaaaaaaaaa";
const LINK = `link_${"a".repeat(17)}`;
const LINK2 = `link_${"b".repeat(17)}`;
const UNKNOWN = `link_${"z".repeat(17)}`;
const PEPPER = new Uint8Array(32).fill(9);
const PEPPER_TEXT = toBase64Url(PEPPER);
const CONTENT_KEY = new Uint8Array(32).fill(7);
const NONCE = new Uint8Array(12).fill(1);

export const bucketFits: (bucket: R2Bucket) => LinkBucket = (bucket) => bucket;
export const limiterFits: (limiter: RateLimit) => Limiter = (limiter) => limiter;

type Who = "u1" | "u2" | "u3" | "u4";
const WHO: Who[] = ["u1", "u2", "u3", "u4"];
type FullRow = Record<string, string | number | null>;

function userOf(id: Who): SessionUser {
  return { id, clerk_id: `clerk_${id}`, plan: "free", billing_account_id: `ba_${id}`, zero_retention: false };
}

// Locked link data, as the app makes it: key version 0 unless a test asks for another.
async function lockedFor(id: string, keyVersion = 0): Promise<Uint8Array> {
  const key = await importContentKey(CONTENT_KEY);
  return lockContent(key, keyVersion, context("link", id), utf8("hello link"), NONCE);
}

// An in-memory R2 stand-in. putError makes every put fail.
function memoryBucket(options: { putError?: Error | undefined } = {}) {
  const objects = new Map<string, Uint8Array>();
  const state = { puts: 0, deletes: 0 };
  const bucket: LinkBucket = {
    async put(key, value) {
      state.puts += 1;
      if (options.putError !== undefined) throw options.putError;
      objects.set(key, value);
      return {};
    },
    async get(key) {
      const bytes = objects.get(key);
      if (bytes === undefined) return null;
      const body = new Response(bytes).body;
      if (body === null) throw new Error("no body");
      return { body, size: bytes.byteLength };
    },
    async delete(key) {
      state.deletes += 1;
      objects.delete(key);
    },
  };
  return { bucket, objects, state };
}

// A rate limiter stand-in that records the keys it was asked about. It has the shape of the RateLimit binding.
type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };
function limiter(allow: boolean, keys: string[]): Limiter {
  return {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: allow };
    },
  };
}

// The Turnstile siteverify stand-in: a token of "good" passes, anything else fails.
async function answersGood(_input: string, init: RequestInit): Promise<Response> {
  const sent = JSON.parse(String(init.body)) as { response: string };
  return Response.json({ success: sent.response === "good" });
}

type Rig = {
  db: BatchDb;
  d: Record<Who, TestDevice>;
  mem: ReturnType<typeof memoryBucket>;
  viewKeys: string[];
  passKeys: string[];
  fetch: ReturnType<typeof vi.fn<typeof answersGood>>;
  env: { DB: BatchDb; BUCKET: LinkBucket; LINK_PASSCODE_PEPPER: string; TURNSTILE_SECRET_KEY: string; LINK_VIEWS: Limiter; LINK_PASSCODES: Limiter };
};

type RigOptions = {
  putError?: Error;
  pepper?: string;
  viewsAllow?: boolean;
  passcodesAllow?: boolean;
  turnstile?: (input: string, init: RequestInit) => Promise<Response>;
};

// Users u1 (owner of G), u2 (editor), u3 (viewer) and u4 (in no group), each with one approved device.
async function makeRig(options: RigOptions = {}): Promise<Rig> {
  const db = createTestDb();
  const d = { u1: await makeTestDevice("dev_u1"), u2: await makeTestDevice("dev_u2"), u3: await makeTestDevice("dev_u3"), u4: await makeTestDevice("dev_u4") };
  for (const who of WHO) {
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)").bind(who, `clerk_${who}`, NOW, `ba_${who}`).run();
    await insertDevice(db, d[who], { userId: who });
  }
  await db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES (?, 'shared', 'sealed', 1, 'u1')").bind(G).run();
  const seats: [string, string][] = [
    ["u1", "owner"],
    ["u2", "editor"],
    ["u3", "viewer"],
  ];
  for (const [user, role] of seats) {
    await db.prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES (?, ?, ?, ?, 0)").bind(G, user, role, NOW).run();
  }
  const mem = memoryBucket({ putError: options.putError });
  const viewKeys: string[] = [];
  const passKeys: string[] = [];
  const fetch = vi.fn(options.turnstile ?? answersGood);
  const env: Rig["env"] = {
    DB: db,
    BUCKET: mem.bucket,
    LINK_PASSCODE_PEPPER: options.pepper ?? PEPPER_TEXT,
    TURNSTILE_SECRET_KEY: "test-secret",
    LINK_VIEWS: limiter(options.viewsAllow ?? true, viewKeys),
    LINK_PASSCODES: limiter(options.passcodesAllow ?? true, passKeys),
  };
  return { db, d, mem, viewKeys, passKeys, fetch, env };
}

function signedApp(who: Who, rig: Rig, at: number): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", userOf(who));
    await next();
  });
  app.route("/", linkRoutes({ now: () => at, fetch: rig.fetch }));
  return app;
}

// The public app: no user middleware, as the viewer calls it.
function publicApp(rig: Rig): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.route("/", linkRoutes({ now: () => NOW, fetch: rig.fetch }));
  return app;
}

// A signed request from `who`'s device. Each call uses a fresh Idempotency-Key unless one is given.
async function signed(rig: Rig, who: Who, method: string, path: string, body?: unknown, key: string = crypto.randomUUID(), at = NOW): Promise<Response> {
  const init = await signedInit(rig.d[who], { method, path, body, now: at, idempotencyKey: key });
  return signedApp(who, rig, at).request(path, init, rig.env);
}

// The same request with no device signature.
async function unsigned(rig: Rig, who: Who, method: string, path: string, body?: unknown): Promise<Response> {
  return signedApp(who, rig, NOW).request(
    path,
    { method, headers: { "Content-Type": "application/json", "Idempotency-Key": "k".repeat(20) }, body: JSON.stringify(body) },
    rig.env,
  );
}

async function publicGet(rig: Rig, id: string, headers: Record<string, string> = {}): Promise<Response> {
  return publicApp(rig).request(`/v1/links/${id}/data`, { headers }, rig.env);
}

// A link row written straight to D1 (and its object to R2 unless object is false), for the public route tests.
async function seedLink(
  rig: Rig,
  id: string,
  extra: { passcode?: string; createdBy?: Who; expiresAt?: number | null; revokedAt?: number | null; object?: boolean } = {},
): Promise<void> {
  const hash = extra.passcode === undefined ? null : await linkPasscodeHash(PEPPER, id, extra.passcode);
  await rig.db
    .prepare("INSERT INTO links (id, group_id, blob_key, passcode_hash, expires_at, revoked_at, views, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
    .bind(id, G, linkKey(id), hash, extra.expiresAt ?? null, extra.revokedAt ?? null, extra.createdBy ?? "u2", NOW)
    .run();
  if (extra.object !== false) rig.mem.objects.set(linkKey(id), await lockedFor(id));
}

async function rowOf(rig: Rig, id: string): Promise<FullRow | null> {
  return rig.db.prepare("SELECT * FROM links WHERE id = ?").bind(id).first<FullRow>();
}

async function viewsOf(rig: Rig, id: string): Promise<number> {
  const row = await rig.db.prepare("SELECT views FROM links WHERE id = ?").bind(id).first<{ views: number }>();
  return row?.views ?? -1;
}

function createBody(id: string, data: string, passcode: string | null = null, expiresAt: number | null = null) {
  return { id, group_id: G, data, passcode, expires_at: expiresAt };
}

describe("POST /v1/links", () => {
  test("an editor creates a link without a passcode: 201, the bytes in R2, and the row", async () => {
    const rig = await makeRig();
    const data = toBase64Url(await lockedFor(LINK));
    const res = await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: LINK, group_id: G, has_passcode: false, expires_at: null, created_at: NOW });
    expect(LinkViewSchema.safeParse(body).success).toBe(true);
    expect(rig.mem.objects.get(linkKey(LINK))).toEqual(await lockedFor(LINK));
    expect(await rowOf(rig, LINK)).toMatchObject({ blob_key: `links/${LINK}/data`, created_by: "u2", created_at: NOW, views: 0, passcode_hash: null });
  });

  test("a link over the day's sync budget gets 429 'daily sync limit reached' with no row and nothing in R2", async () => {
    const rig = await makeRig();
    await rig.db.prepare("INSERT INTO sync_days (user_id, day, bytes) VALUES ('u2', ?, ?)").bind(Math.floor(NOW / 86_400_000), SYNC_DAILY_BYTES).run();
    const res = await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, toBase64Url(await lockedFor(LINK))));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited", message: "daily sync limit reached" });
    expect(await rowOf(rig, LINK)).toBeNull();
    expect(rig.mem.state.puts).toBe(0);
  });

  test("a link id that is taken gets 409 and its bytes are not counted", async () => {
    const rig = await makeRig();
    const data = toBase64Url(await lockedFor(LINK));
    expect((await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data))).status).toBe(201);
    expect((await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data))).status).toBe(409);
    const row = await rig.db.prepare("SELECT bytes FROM sync_days WHERE user_id = 'u2'").first<{ bytes: number }>();
    expect(row?.bytes).toBe((await lockedFor(LINK)).length);
  });

  test("a passcode is stored only as its peppered hash, and no column holds the passcode", async () => {
    const rig = await makeRig();
    const data = toBase64Url(await lockedFor(LINK));
    const res = await signed(rig, "u1", "POST", "/v1/links", createBody(LINK, data, "1234"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ has_passcode: true });
    const row = await rowOf(rig, LINK);
    expect(row?.passcode_hash).toBe(await linkPasscodeHash(PEPPER, LINK, "1234"));
    expect(Object.values(row ?? {}).includes("1234")).toBe(false);
  });

  test("a viewer gets 403, a non-member 404, and a taken id 409", async () => {
    const rig = await makeRig();
    const data = toBase64Url(await lockedFor(LINK));
    const viewer = await signed(rig, "u3", "POST", "/v1/links", createBody(LINK, data));
    expect(viewer.status).toBe(403);
    const outsider = await signed(rig, "u4", "POST", "/v1/links", createBody(LINK, data));
    expect(outsider.status).toBe(404);
    expect((await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data))).status).toBe(201);
    const taken = await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ code: "conflict", message: "link id taken", retry_after: null });
  });

  test("data over 4 MiB gives 400, not 500, and no row is written", async () => {
    const rig = await makeRig();
    const res = await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, "A".repeat(5_600_000)));
    expect(res.status).toBe(400);
    expect(await rowOf(rig, LINK)).toBeNull();
  });

  test("bad data gives 400: key version 1, 32 bytes, or an expiry at now, and no row is written", async () => {
    const rig = await makeRig();
    const wrongVersion = toBase64Url(await lockedFor(LINK, 1));
    expect((await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, wrongVersion))).status).toBe(400);
    expect((await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, toBase64Url(new Uint8Array(32))))).status).toBe(400);
    const good = toBase64Url(await lockedFor(LINK));
    expect((await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, good, null, NOW))).status).toBe(400);
    expect(await rowOf(rig, LINK)).toBeNull();
  });

  test("a pepper that is not 32 bytes gives 500 when a passcode is set, and no row is written", async () => {
    const rig = await makeRig({ pepper: toBase64Url(new Uint8Array(16).fill(9)) });
    const data = toBase64Url(await lockedFor(LINK));
    const res = await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data, "1234"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "link passcodes unavailable", retry_after: null });
    expect(await rowOf(rig, LINK)).toBeNull();
  });

  test("when R2 fails, the row is removed and the reply is 500", async () => {
    const rig = await makeRig({ putError: new Error("r2 unavailable") });
    const data = toBase64Url(await lockedFor(LINK));
    const res = await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data));
    expect(res.status).toBe(500);
    expect(await rowOf(rig, LINK)).toBeNull();
  });

  test("the same request with the same Idempotency-Key returns the stored reply and writes R2 once", async () => {
    const rig = await makeRig();
    const data = toBase64Url(await lockedFor(LINK));
    const key = "same-key-for-one-link";
    const first = await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data), key);
    const second = await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data), key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(rig.mem.state.puts).toBe(1);
  });

  test("create and delete without a device signature give 401", async () => {
    const rig = await makeRig();
    const data = toBase64Url(await lockedFor(LINK));
    expect((await unsigned(rig, "u2", "POST", "/v1/links", createBody(LINK, data))).status).toBe(401);
    expect((await unsigned(rig, "u2", "DELETE", `/v1/links/${LINK}`)).status).toBe(401);
  });
});

describe("DELETE /v1/links/:id", () => {
  test("the maker revokes their link: 200 with revoked_at, the bytes are gone, and a second revoke keeps the first time", async () => {
    const rig = await makeRig();
    await seedLink(rig, LINK, { createdBy: "u2" });
    const first = await signed(rig, "u2", "DELETE", `/v1/links/${LINK}`);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toEqual({ id: LINK, revoked_at: NOW });
    expect(LinkRevokedSchema.safeParse(body).success).toBe(true);
    expect(rig.mem.objects.has(linkKey(LINK))).toBe(false);
    const later = NOW + 5_000;
    const second = await signed(rig, "u2", "DELETE", `/v1/links/${LINK}`, undefined, crypto.randomUUID(), later);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ id: LINK, revoked_at: NOW });
  });

  test("an owner revokes any link in the group; an editor cannot revoke another's; a non-member and an unknown id get 404", async () => {
    const rig = await makeRig();
    await seedLink(rig, LINK, { createdBy: "u2" });
    await seedLink(rig, LINK2, { createdBy: "u1" });
    expect((await signed(rig, "u1", "DELETE", `/v1/links/${LINK}`)).status).toBe(200);
    expect((await signed(rig, "u2", "DELETE", `/v1/links/${LINK2}`)).status).toBe(403);
    expect((await signed(rig, "u4", "DELETE", `/v1/links/${LINK2}`)).status).toBe(404);
    const unknown = await signed(rig, "u1", "DELETE", `/v1/links/${UNKNOWN}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ code: "not_found", message: "no such link", retry_after: null });
  });

  test("its maker can still turn it off after leaving the group; another former member gets 404", async () => {
    const rig = await makeRig();
    await seedLink(rig, LINK, { createdBy: "u2" });
    await seedLink(rig, LINK2, { createdBy: "u1" });
    await rig.db.prepare("UPDATE memberships SET left_at = ? WHERE user_id = 'u2'").bind(NOW - 1).run();
    expect((await signed(rig, "u2", "DELETE", `/v1/links/${LINK2}`)).status).toBe(404);
    const own = await signed(rig, "u2", "DELETE", `/v1/links/${LINK}`);
    expect(own.status).toBe(200);
    expect(rig.mem.objects.has(linkKey(LINK))).toBe(false);
  });
});

describe("GET /v1/links/:id/data", () => {
  test("the public route returns the exact bytes with no-store headers and counts a view, with no Turnstile call", async () => {
    const rig = await makeRig();
    await seedLink(rig, LINK);
    const res = await publicGet(rig, LINK);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(await lockedFor(LINK));
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(await viewsOf(rig, LINK)).toBe(1);
    expect(rig.viewKeys).toContain(LINK);
    expect(rig.fetch).not.toHaveBeenCalled();
  });

  test("revoked, expired, unknown and 21-character ids give 404 with the state, and count no view", async () => {
    const rig = await makeRig();
    await seedLink(rig, LINK, { revokedAt: NOW - 1 });
    await seedLink(rig, LINK2, { expiresAt: NOW });
    const revoked = await publicGet(rig, LINK);
    expect(revoked.status).toBe(404);
    expect(await revoked.json()).toEqual({ code: "not_found", message: "link revoked", retry_after: null });
    const expired = await publicGet(rig, LINK2);
    expect(expired.status).toBe(404);
    expect(await expired.json()).toEqual({ code: "not_found", message: "link expired", retry_after: null });
    const unknown = await publicGet(rig, UNKNOWN);
    expect(await unknown.json()).toEqual({ code: "not_found", message: "no such link", retry_after: null });
    const short = await publicGet(rig, "a".repeat(21));
    expect(short.status).toBe(404);
    expect(await viewsOf(rig, LINK)).toBe(0);
    expect(await viewsOf(rig, LINK2)).toBe(0);
  });

  test("when LINK_VIEWS says no: 429 with retry_after 60 and no database read for the link", async () => {
    const rig = await makeRig({ viewsAllow: false });
    await seedLink(rig, LINK);
    const spy = vi.spyOn(rig.db, "prepare");
    const res = await publicGet(rig, LINK);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ code: "rate_limited", message: "too many requests", retry_after: 60 });
    expect(spy).not.toHaveBeenCalled();
    expect(await viewsOf(rig, LINK)).toBe(0);
  });

  test("a passcode link without the passcode or without the Turnstile header gives 401 passcode required, with no Turnstile call", async () => {
    const rig = await makeRig();
    await seedLink(rig, LINK, { passcode: "1234" });
    const neither = await publicGet(rig, LINK);
    expect(neither.status).toBe(401);
    expect(await neither.json()).toEqual({ code: "unauthorized", message: "passcode required", retry_after: null });
    expect((await publicGet(rig, LINK, { "Waypoint-Link-Passcode": "1234" })).status).toBe(401);
    expect((await publicGet(rig, LINK, { "Waypoint-Turnstile": "good" })).status).toBe(401);
    expect(rig.fetch).not.toHaveBeenCalled();
    expect(await viewsOf(rig, LINK)).toBe(0);
  });

  test("the right passcode and a good Turnstile token give the bytes, after a Turnstile call with the client IP", async () => {
    const rig = await makeRig();
    await seedLink(rig, LINK, { passcode: "1234" });
    const res = await publicGet(rig, LINK, {
      "Waypoint-Link-Passcode": "1234",
      "Waypoint-Turnstile": "good",
      "CF-Connecting-IP": "203.0.113.7",
    });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(await lockedFor(LINK));
    expect(await viewsOf(rig, LINK)).toBe(1);
    expect(rig.passKeys).toEqual([`${LINK}:203.0.113.7`]);
    expect(rig.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = rig.fetch.mock.calls[0] ?? [];
    expect(url).toBe(SITEVERIFY_URL);
    expect(JSON.parse(String(init?.body))).toEqual({ secret: "test-secret", response: "good", remoteip: "203.0.113.7" });
  });

  test("a Turnstile token that fails, a Turnstile call that throws, a reply that is not ok, or an empty reply each give 403 challenge failed", async () => {
    const headers = { "Waypoint-Link-Passcode": "1234", "Waypoint-Turnstile": "bad" };
    const bad = await makeRig();
    await seedLink(bad, LINK, { passcode: "1234" });
    const failed = await publicGet(bad, LINK, headers);
    expect(failed.status).toBe(403);
    expect(await failed.json()).toEqual({ code: "forbidden", message: "challenge failed", retry_after: null });
    const throwing = await makeRig({ turnstile: async () => { throw new Error("offline"); } });
    await seedLink(throwing, LINK, { passcode: "1234" });
    expect((await publicGet(throwing, LINK, headers)).status).toBe(403);
    const broken = await makeRig({ turnstile: async () => new Response("no", { status: 500 }) });
    await seedLink(broken, LINK, { passcode: "1234" });
    expect((await publicGet(broken, LINK, headers)).status).toBe(403);
    const empty = await makeRig({ turnstile: async () => Response.json({}) });
    await seedLink(empty, LINK, { passcode: "1234" });
    expect((await publicGet(empty, LINK, headers)).status).toBe(403);
  });

  test("a wrong passcode, or one with a space, gives 401 wrong passcode and counts no view", async () => {
    const rig = await makeRig();
    await seedLink(rig, LINK, { passcode: "1234" });
    const wrong = await publicGet(rig, LINK, { "Waypoint-Link-Passcode": "9999", "Waypoint-Turnstile": "good" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ code: "unauthorized", message: "wrong passcode", retry_after: null });
    const spaced = await publicGet(rig, LINK, { "Waypoint-Link-Passcode": "12 34", "Waypoint-Turnstile": "good" });
    expect(spaced.status).toBe(401);
    expect(await viewsOf(rig, LINK)).toBe(0);
  });

  test("when LINK_PASSCODES says no: 429 with retry_after 60 and no Turnstile call", async () => {
    const rig = await makeRig({ passcodesAllow: false });
    await seedLink(rig, LINK, { passcode: "1234" });
    const res = await publicGet(rig, LINK, { "Waypoint-Link-Passcode": "1234", "Waypoint-Turnstile": "good" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: "rate_limited", message: "too many attempts", retry_after: 60 });
    expect(rig.fetch).not.toHaveBeenCalled();
  });

  test("a link row whose object is missing from R2 gives 404 no such link", async () => {
    const rig = await makeRig();
    await seedLink(rig, LINK, { object: false });
    const res = await publicGet(rig, LINK);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found", message: "no such link", retry_after: null });
  });
});

describe("verifyTurnstile", () => {
  test("an empty token or one of 2,049 characters is false, without calling fetch", async () => {
    const fetchFn = vi.fn(async () => Response.json({ success: true }));
    expect(await verifyTurnstile(fetchFn, "secret", "", null)).toBe(false);
    expect(await verifyTurnstile(fetchFn, "secret", "t".repeat(2049), null)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
