import { describe, expect, test } from "vitest";
import { cleanup, MAX_LIST_PAGES, type CleanupBucket } from "../src/cleanup.ts";
import { createTestDb } from "./helpers/d1.ts";

// Compile-time check: an R2Bucket is accepted as CleanupBucket.
export const r2Fits: (bucket: R2Bucket) => CleanupBucket = (bucket) => bucket;

const NOW = Date.UTC(2026, 10, 19, 12);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Stored = { key: string; uploaded: Date };

// An in-memory bucket: keys stay sorted, list pages by key (the cursor is the last key of the page),
// and deletes are real. Records every prefix it is asked to list and the cursor each list call was given.
function fakeBucket(objects: Stored[]) {
  const listedPrefixes: string[] = [];
  const pages: number[] = [];
  const cursors: (string | undefined)[] = [];
  const sorted = [...objects].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const bucket: CleanupBucket = {
    async list(options) {
      listedPrefixes.push(options.prefix);
      cursors.push(options.cursor);
      const matching = sorted.filter((o) => o.key.startsWith(options.prefix) && (options.cursor === undefined || o.key > options.cursor));
      const page = matching.slice(0, options.limit);
      pages.push(page.length);
      const truncated = matching.length > page.length;
      const last = page[page.length - 1];
      return truncated && last !== undefined ? { objects: page, truncated, cursor: last.key } : { objects: page, truncated };
    },
    async delete(keys) {
      for (const key of keys) {
        const at = sorted.findIndex((o) => o.key === key);
        if (at >= 0) sorted.splice(at, 1);
      }
    },
  };
  return { bucket, listedPrefixes, pages, cursors, remaining: () => sorted.map((o) => o.key) };
}

function padded(prefix: string, i: number): string {
  return `${prefix}${String(i).padStart(6, "0")}`;
}

describe("cleanup", () => {
  test("results/ objects older than 7 days are deleted and younger ones kept", async () => {
    const { bucket, remaining } = fakeBucket([
      { key: "results/old", uploaded: new Date(NOW - 8 * DAY) },
      { key: "results/young", uploaded: new Date(NOW - 6 * DAY) },
    ]);
    const counts = await cleanup({ DB: createTestDb(), BUCKET: bucket }, NOW);
    expect(remaining()).toEqual(["results/young"]);
    expect(counts.results).toBe(1);
  });

  test("tmp/audio/ objects older than 24 hours are deleted and younger ones kept", async () => {
    const { bucket, remaining } = fakeBucket([
      { key: "tmp/audio/old", uploaded: new Date(NOW - 25 * HOUR) },
      { key: "tmp/audio/young", uploaded: new Date(NOW - 23 * HOUR) },
    ]);
    const counts = await cleanup({ DB: createTestDb(), BUCKET: bucket }, NOW);
    expect(remaining()).toEqual(["tmp/audio/young"]);
    expect(counts.tmp_audio).toBe(1);
  });

  test("tmp/input/ objects older than 24 hours are deleted and younger ones kept", async () => {
    const { bucket, remaining } = fakeBucket([
      { key: "tmp/input/old", uploaded: new Date(NOW - 25 * HOUR) },
      { key: "tmp/input/young", uploaded: new Date(NOW - 23 * HOUR) },
    ]);
    const counts = await cleanup({ DB: createTestDb(), BUCKET: bucket }, NOW);
    expect(remaining()).toEqual(["tmp/input/young"]);
    expect(counts.tmp_input).toBe(1);
  });

  test("objects under groups/ are never listed or deleted", async () => {
    const { bucket, listedPrefixes, remaining } = fakeBucket([
      { key: "groups/g1/keep", uploaded: new Date(NOW - 365 * DAY) },
      { key: "results/old", uploaded: new Date(NOW - 8 * DAY) },
    ]);
    await cleanup({ DB: createTestDb(), BUCKET: bucket }, NOW);
    expect(listedPrefixes).not.toContain("groups/");
    expect(listedPrefixes.every((prefix) => prefix === "results/" || prefix === "tmp/audio/" || prefix === "tmp/input/")).toBe(true);
    expect(remaining()).toEqual(["groups/g1/keep"]);
  });

  test("2,500 old results/ objects over three pages are all deleted, passing the cursor back", async () => {
    const objects = Array.from({ length: 2500 }, (_, i) => ({ key: padded("results/", i), uploaded: new Date(NOW - 8 * DAY) }));
    const { bucket, pages, cursors, remaining } = fakeBucket(objects);
    const counts = await cleanup({ DB: createTestDb(), BUCKET: bucket }, NOW);
    expect(counts.results).toBe(2500);
    expect(remaining()).toEqual([]);
    expect(pages.slice(0, 3)).toEqual([1000, 1000, 500]);
    expect(cursors.slice(0, 3)).toEqual([undefined, padded("results/", 999), padded("results/", 1999)]);
  });

  test("20,000 new results/ objects then one 30-day-old object: the old one is deleted and the new ones kept", async () => {
    const objects = Array.from({ length: 20000 }, (_, i) => ({ key: padded("results/", i), uploaded: new Date(NOW - HOUR) }));
    objects.push({ key: "results/zzold", uploaded: new Date(NOW - 30 * DAY) });
    const { bucket, remaining } = fakeBucket(objects);
    const counts = await cleanup({ DB: createTestDb(), BUCKET: bucket }, NOW);
    expect(counts.results).toBe(1);
    expect(remaining()).toHaveLength(20000);
    expect(remaining()).not.toContain("results/zzold");
  });

  test("an object uploaded exactly 7 days ago is kept; one 1 ms older is deleted", async () => {
    const { bucket, remaining } = fakeBucket([
      { key: "results/edge", uploaded: new Date(NOW - 7 * DAY) },
      { key: "results/just-past", uploaded: new Date(NOW - 7 * DAY - 1) },
    ]);
    const counts = await cleanup({ DB: createTestDb(), BUCKET: bucket }, NOW);
    expect(remaining()).toEqual(["results/edge"]);
    expect(counts.results).toBe(1);
  });

  test("25 pages of old objects: only 20 pages are listed in one run", async () => {
    const objects = Array.from({ length: 25000 }, (_, i) => ({ key: padded("results/", i), uploaded: new Date(NOW - 8 * DAY) }));
    const { bucket, pages, remaining } = fakeBucket(objects);
    const counts = await cleanup({ DB: createTestDb(), BUCKET: bucket }, NOW);
    expect(MAX_LIST_PAGES).toBe(20);
    expect(pages.filter((size) => size > 0)).toHaveLength(20);
    expect(counts.results).toBe(20000);
    expect(remaining()).toHaveLength(5000);
  });

  test("idempotency rows 25 hours old are deleted and 23 hours old kept", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'u1')").run();
    await db
      .prepare("INSERT INTO idempotency (user_id, key, request_hash, state, created_at) VALUES ('u1', 'old', 'h', 'done', ?)")
      .bind(NOW - 25 * HOUR)
      .run();
    await db
      .prepare("INSERT INTO idempotency (user_id, key, request_hash, state, created_at) VALUES ('u1', 'young', 'h', 'done', ?)")
      .bind(NOW - 23 * HOUR)
      .run();
    await cleanup({ DB: db, BUCKET: fakeBucket([]).bucket }, NOW);
    const rows = await db.prepare("SELECT key FROM idempotency ORDER BY key").all<{ key: string }>();
    expect(rows.results).toEqual([{ key: "young" }]);
  });

  test("request_nonces 1 ms past expiry are deleted, one expiring at now kept; the counts cover each kind", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO request_nonces (device_id, nonce, expires_at) VALUES ('d1', 'past', ?)").bind(NOW - 1).run();
    await db.prepare("INSERT INTO request_nonces (device_id, nonce, expires_at) VALUES ('d1', 'now', ?)").bind(NOW).run();
    const { bucket } = fakeBucket([
      { key: "results/a", uploaded: new Date(NOW - 8 * DAY) },
      { key: "tmp/audio/b", uploaded: new Date(NOW - 25 * HOUR) },
    ]);
    const counts = await cleanup({ DB: db, BUCKET: bucket }, NOW);
    const rows = await db.prepare("SELECT nonce FROM request_nonces").all<{ nonce: string }>();
    expect(rows.results).toEqual([{ nonce: "now" }]);
    expect(counts).toEqual({ results: 1, tmp_audio: 1, tmp_input: 0, idempotency: 0, request_nonces: 1, pending_blobs: 0, waiting_devices: 0 });
  });

  test("a blob reservation still uploading after 25 hours is deleted; one 23 hours old and a stored one 25 hours old are kept", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'u1')").run();
    await db.prepare("INSERT INTO groups (id, kind, name_locked, created_by) VALUES ('g1', 'shared', 'sealed', 'u1')").run();
    const insert = "INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at) VALUES (?, 'g1', 'u1', 100, ?, ?)";
    await db.prepare(insert).bind("old_pending", NOW - 25 * HOUR, null).run();
    await db.prepare(insert).bind("young_pending", NOW - 23 * HOUR, null).run();
    await db.prepare(insert).bind("old_stored", NOW - 25 * HOUR, NOW - 25 * HOUR).run();
    const counts = await cleanup({ DB: db, BUCKET: fakeBucket([]).bucket }, NOW);
    expect(counts.pending_blobs).toBe(1);
    const rows = await db.prepare("SELECT id FROM blobs ORDER BY id").all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "old_stored" }, { id: "young_pending" }]);
  });

  test("a device waiting for more than a day with no live pairing is marked removed; a younger one, one with a live pairing, an approved one and the account row are kept", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'u1')").run();
    const insert =
      "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, kind, approved_at) VALUES (?, 'u1', 'iPhone', ?, 'S', 'B', 0, ?, ?, ?)";
    await db.prepare(insert).bind("old_waiting", "ios", NOW - 25 * HOUR, "device", null).run();
    await db.prepare(insert).bind("old_expired_pairing", "ios", NOW - 25 * HOUR, "device", null).run();
    await db.prepare(insert).bind("old_live_pairing", "ios", NOW - 25 * HOUR, "device", null).run();
    await db.prepare(insert).bind("young_waiting", "ios", NOW - 23 * HOUR, "device", null).run();
    await db.prepare(insert).bind("old_approved", "ios", NOW - 25 * HOUR, "device", NOW - 25 * HOUR).run();
    await db.prepare(insert).bind("acct", "account", NOW - 25 * HOUR, "account", NOW - 25 * HOUR).run();
    await db.prepare("INSERT INTO device_pairings (device_id, commitment, expires_at) VALUES ('old_expired_pairing', 'c', ?)").bind(NOW).run();
    await db.prepare("INSERT INTO device_pairings (device_id, commitment, expires_at) VALUES ('old_live_pairing', 'c', ?)").bind(NOW + 1).run();
    const counts = await cleanup({ DB: db, BUCKET: fakeBucket([]).bucket }, NOW);
    expect(counts.waiting_devices).toBe(2);
    const rows = await db.prepare("SELECT id FROM devices WHERE removed_at = ? ORDER BY id").bind(NOW).all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "old_expired_pairing" }, { id: "old_waiting" }]);
  });
});
