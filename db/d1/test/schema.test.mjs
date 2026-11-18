import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL("../migrations/0001_directory.sql", import.meta.url),
);
const migration = readFileSync(migrationPath, "utf8");

const EXPECTED = {
  users: ["id", "clerk_id", "created_at", "plan", "billing_account_id", "zero_retention"],
  entitlements: ["user_id", "product", "source", "media_cap_gb", "granted_at", "ended_at"],
  devices: ["id", "user_id", "name", "platform", "sign_pub", "box_pub", "can_approve", "added_at", "removed_at"],
  recovery: ["user_id", "wrapped_account_key", "verified_at"],
  groups: ["id", "kind", "name_locked", "key_version", "created_by"],
  memberships: ["group_id", "user_id", "role", "starts_at", "ends_at", "history_from", "left_at"],
  key_envelopes: ["group_id", "key_version", "device_id", "wrapped_key"],
  invites: ["token_hash", "group_id", "role", "expires_at", "accepted_by"],
  links: ["id", "group_id", "blob_key", "passcode_hash", "expires_at", "revoked_at", "views"],
  purchases: ["transaction_id", "original_id", "billing_account_id", "product_id", "kind", "status", "purchased_at"],
  jobs: ["id", "user_id", "type", "state", "quoted", "spent", "route", "result_key", "created_at", "expires_at"],
  activity: ["id", "user_id", "task", "bytes_sent", "credits", "route", "retention", "at"],
};

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(migration);
  return db;
}

function seedUser(db, id = "u1", clerkId = "clerk_1") {
  db.prepare(
    "INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, 1, 'ba_1')",
  ).run(id, clerkId);
}

function seedGroup(db, id = "g1") {
  seedUser(db);
  db.prepare(
    "INSERT INTO groups (id, kind, created_by) VALUES (?, 'shared', 'u1')",
  ).run(id);
}

test("creates exactly the 12 directory tables", () => {
  const db = freshDb();
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  assert.deepEqual(rows.map((r) => r.name), Object.keys(EXPECTED).sort());
  assert.equal(rows.length, 12);
});

test("each table has exactly the columns in architecture section 5", () => {
  const db = freshDb();
  for (const [table, columns] of Object.entries(EXPECTED)) {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    assert.deepEqual(actual, columns, `columns of ${table}`);
  }
});

test("no column is named text, content, body, transcript or note", () => {
  const db = freshDb();
  const banned = new Set(["text", "content", "body", "transcript", "note"]);
  for (const table of Object.keys(EXPECTED)) {
    for (const col of db.prepare(`PRAGMA table_info(${table})`).all()) {
      assert.equal(banned.has(col.name), false, `${table}.${col.name}`);
    }
  }
});

test("foreign key enforcement is on", () => {
  const db = freshDb();
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
});

test("rejects a bad users.plan", () => {
  const db = freshDb();
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO users (id, clerk_id, created_at, plan, billing_account_id) VALUES ('u1', 'c1', 1, 'enterprise', 'ba_1')",
      ).run(),
    /CHECK constraint failed/,
  );
});

test("rejects a bad memberships.role", () => {
  const db = freshDb();
  seedGroup(db);
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g1', 'u1', 'admin', 1, 1)",
      ).run(),
    /CHECK constraint failed/,
  );
});

test("rejects a bad groups.kind", () => {
  const db = freshDb();
  seedUser(db);
  assert.throws(
    () =>
      db.prepare("INSERT INTO groups (id, kind, created_by) VALUES ('g1', 'team', 'u1')").run(),
    /CHECK constraint failed/,
  );
});

test("rejects a bad jobs.state", () => {
  const db = freshDb();
  seedUser(db);
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO jobs (id, user_id, type, state, quoted, created_at) VALUES ('j1', 'u1', 'research', 'paused', 5, 1)",
      ).run(),
    /CHECK constraint failed/,
  );
});

test("rejects a bad activity.retention", () => {
  const db = freshDb();
  seedUser(db);
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO activity (id, user_id, task, credits, route, retention, at) VALUES ('a1', 'u1', 'explain', 1, 'r', 'forever', 1)",
      ).run(),
    /CHECK constraint failed/,
  );
});

test("rejects a duplicate users.clerk_id", () => {
  const db = freshDb();
  seedUser(db, "u1", "clerk_same");
  assert.throws(() => seedUser(db, "u2", "clerk_same"), /UNIQUE constraint failed/);
});

test("rejects a membership for a missing group", () => {
  const db = freshDb();
  seedUser(db);
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('missing', 'u1', 'owner', 1, 1)",
      ).run(),
    /FOREIGN KEY constraint failed/,
  );
});
