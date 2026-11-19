import { describe, expect, test } from "vitest";
import { createTestDb } from "./helpers/d1.ts";
import { createTestStore } from "./helpers/sql.ts";
import type { BatchDb, Db, SqlStore } from "../src/storage.ts";

export const d1Fits: (db: D1Database) => Db = (db) => db;
export const d1BatchFits: (db: D1Database) => BatchDb = (db) => db;
export const doStorageFits: (storage: DurableObjectStorage) => SqlStore = (storage) => storage;

describe("createTestDb", () => {
  test("has the users table, with plan defaulting to free", async () => {
    const db = createTestDb();
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind("u1", "clerk-1", 1, "billing-1")
      .run();
    const row = await db.prepare("SELECT plan FROM users WHERE id = ?").bind("u1").first<{ plan: string }>();
    expect(row).toEqual({ plan: "free" });
  });

  test("first() gives null when no row matches", async () => {
    const db = createTestDb();
    expect(await db.prepare("SELECT id FROM users WHERE id = ?").bind("nobody").first()).toBeNull();
  });

  test("all() gives the rows under results", async () => {
    const db = createTestDb();
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind("u1", "clerk-1", 1, "billing-1")
      .run();
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind("u2", "clerk-2", 2, "billing-2")
      .run();
    const result = await db.prepare("SELECT id FROM users ORDER BY id").all<{ id: string }>();
    expect(result.results.map((row) => row.id)).toEqual(["u1", "u2"]);
  });

  test("foreign keys are on, so a device for a missing user is rejected", async () => {
    const db = createTestDb();
    await expect(
      db
        .prepare(
          "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("d1", "missing-user", "phone", "ios", "sign", "box", 1)
        .run(),
    ).rejects.toThrow();
  });
});

describe("createTestStore", () => {
  test("returns a BLOB as an ArrayBuffer", () => {
    const store = createTestStore();
    store.sql.exec("CREATE TABLE blobs (b BLOB)");
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    store.sql.exec("INSERT INTO blobs (b) VALUES (?)", bytes);
    const [row] = store.sql.exec("SELECT b FROM blobs").toArray();
    expect(row?.b).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(row?.b as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("a transactionSync that throws leaves no rows behind", () => {
    const store = createTestStore();
    store.sql.exec("CREATE TABLE items (id TEXT)");
    expect(() =>
      store.transactionSync(() => {
        store.sql.exec("INSERT INTO items (id) VALUES (?)", "a");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.sql.exec("SELECT id FROM items").toArray()).toEqual([]);
  });
});

describe("createTestDb batch", () => {
  const insertUser = (db: Db, id: string) =>
    db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind(id, `clerk-${id}`, 1, `billing-${id}`);

  test("a batch of two inserts commits both", async () => {
    const db = createTestDb();
    await db.batch([insertUser(db, "u1"), insertUser(db, "u2")]);
    const result = await db.prepare("SELECT id FROM users ORDER BY id").all<{ id: string }>();
    expect(result.results.map((row) => row.id)).toEqual(["u1", "u2"]);
  });

  test("a batch whose second statement violates a primary key rejects and leaves neither row", async () => {
    const db = createTestDb();
    await insertUser(db, "u1").run();
    await expect(db.batch([insertUser(db, "u2"), insertUser(db, "u1")])).rejects.toThrow();
    const result = await db.prepare("SELECT id FROM users ORDER BY id").all<{ id: string }>();
    expect(result.results.map((row) => row.id)).toEqual(["u1"]);
  });

  test("a statement from another createTestDb() makes batch throw TypeError", async () => {
    const db = createTestDb();
    const other = createTestDb();
    await expect(db.batch([insertUser(other, "u1")])).rejects.toThrow(TypeError);
  });
});
