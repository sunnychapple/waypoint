import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"));

const EXPECTED = {
  users: ["id", "clerk_id", "created_at", "plan", "billing_account_id", "zero_retention"],
  entitlements: ["user_id", "product", "source", "media_cap_gb", "granted_at", "ended_at"],
  devices: ["id", "user_id", "name", "platform", "sign_pub", "box_pub", "can_approve", "added_at", "removed_at", "kind", "approved_at", "approved_by", "cert", "account_envelope"],
  recovery: ["user_id", "wrapped_account_key", "verified_at"],
  groups: ["id", "kind", "name_locked", "key_version", "created_by"],
  memberships: ["group_id", "user_id", "role", "starts_at", "ends_at", "history_from", "left_at"],
  key_envelopes: ["group_id", "key_version", "device_id", "wrapped_key"],
  invites: ["token_hash", "group_id", "role", "expires_at", "accepted_by"],
  links: ["id", "group_id", "blob_key", "passcode_hash", "expires_at", "revoked_at", "views"],
  purchases: ["transaction_id", "original_id", "billing_account_id", "product_id", "kind", "status", "purchased_at"],
  jobs: ["id", "user_id", "type", "state", "quoted", "spent", "route", "result_key", "created_at", "expires_at", "device_id"],
  activity: ["id", "user_id", "task", "bytes_sent", "credits", "route", "retention", "at"],
  idempotency: ["user_id", "key", "request_hash", "state", "status", "body", "created_at"],
  push_tokens: ["user_id", "device_id", "token", "environment", "updated_at"],
  device_pairings: ["device_id", "commitment", "approver_id", "approver_nonce", "device_nonce", "expires_at"],
  request_nonces: ["device_id", "nonce", "expires_at"],
  apple_notifications: ["notification_uuid", "notification_type", "received_at"],
};

// "TEXT" is NOT NULL; "TEXT?" is nullable. Nullable columns are the ones the
// spec makes optional (ends, removals, verification, expiry, accepted_by,
// passcode_hash, spent, route, result_key) plus groups.created_by.
const EXPECTED_TYPES = {
  users: { id: "TEXT", clerk_id: "TEXT", created_at: "INTEGER", plan: "TEXT", billing_account_id: "TEXT", zero_retention: "INTEGER" },
  entitlements: { user_id: "TEXT", product: "TEXT", source: "TEXT", media_cap_gb: "INTEGER", granted_at: "INTEGER", ended_at: "INTEGER?" },
  devices: { id: "TEXT", user_id: "TEXT", name: "TEXT", platform: "TEXT", sign_pub: "TEXT", box_pub: "TEXT", can_approve: "INTEGER", added_at: "INTEGER", removed_at: "INTEGER?", kind: "TEXT", approved_at: "INTEGER?", approved_by: "TEXT?", cert: "TEXT?", account_envelope: "TEXT?" },
  recovery: { user_id: "TEXT", wrapped_account_key: "TEXT", verified_at: "INTEGER?" },
  groups: { id: "TEXT", kind: "TEXT", name_locked: "TEXT", key_version: "INTEGER", created_by: "TEXT?" },
  memberships: { group_id: "TEXT", user_id: "TEXT", role: "TEXT", starts_at: "INTEGER", ends_at: "INTEGER?", history_from: "INTEGER", left_at: "INTEGER?" },
  key_envelopes: { group_id: "TEXT", key_version: "INTEGER", device_id: "TEXT", wrapped_key: "TEXT" },
  invites: { token_hash: "TEXT", group_id: "TEXT", role: "TEXT", expires_at: "INTEGER", accepted_by: "TEXT?" },
  links: { id: "TEXT", group_id: "TEXT", blob_key: "TEXT", passcode_hash: "TEXT?", expires_at: "INTEGER?", revoked_at: "INTEGER?", views: "INTEGER" },
  purchases: { transaction_id: "TEXT", original_id: "TEXT", billing_account_id: "TEXT", product_id: "TEXT", kind: "TEXT", status: "TEXT", purchased_at: "INTEGER" },
  jobs: { id: "TEXT", user_id: "TEXT", type: "TEXT", state: "TEXT", quoted: "INTEGER", spent: "INTEGER?", route: "TEXT?", result_key: "TEXT?", created_at: "INTEGER", expires_at: "INTEGER?", device_id: "TEXT?" },
  activity: { id: "TEXT", user_id: "TEXT", task: "TEXT", bytes_sent: "INTEGER", credits: "INTEGER", route: "TEXT", retention: "TEXT", at: "INTEGER" },
  idempotency: { user_id: "TEXT", key: "TEXT", request_hash: "TEXT", state: "TEXT", status: "INTEGER?", body: "TEXT?", created_at: "INTEGER" },
  push_tokens: { user_id: "TEXT", device_id: "TEXT", token: "TEXT", environment: "TEXT", updated_at: "INTEGER" },
  device_pairings: { device_id: "TEXT", commitment: "TEXT", approver_id: "TEXT?", approver_nonce: "TEXT?", device_nonce: "TEXT?", expires_at: "INTEGER" },
  request_nonces: { device_id: "TEXT", nonce: "TEXT", expires_at: "INTEGER" },
  apple_notifications: { notification_uuid: "TEXT", notification_type: "TEXT", received_at: "INTEGER" },
};

// Indexes the card requires, as [table, indexed columns in order].
const REQUIRED_INDEXES = [
  ["devices", ["user_id"]],
  ["memberships", ["user_id"]],
  ["purchases", ["original_id"]],
  ["purchases", ["billing_account_id"]],
  ["jobs", ["user_id", "created_at"]],
  ["activity", ["user_id", "at"]],
  ["links", ["group_id"]],
  ["key_envelopes", ["device_id"]],
  ["invites", ["group_id"]],
  ["request_nonces", ["expires_at"]],
];

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrations) db.exec(sql);
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
    "INSERT INTO groups (id, kind, name_locked, created_by) VALUES (?, 'shared', 'sealed', 'u1')",
  ).run(id);
}

function seedGroupAndDevice(db) {
  seedGroup(db);
  db.prepare(
    "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, added_at) VALUES ('d1', 'u1', 'phone', 'ios', 's', 'b', 1)",
  ).run();
}

function count(db, sql, ...args) {
  return db.prepare(sql).get(...args).n;
}

test("creates exactly the expected tables", () => {
  const db = freshDb();
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  assert.deepEqual(rows.map((r) => r.name), Object.keys(EXPECTED).sort());
});

test("each table has exactly the columns in architecture section 5", () => {
  const db = freshDb();
  for (const [table, columns] of Object.entries(EXPECTED)) {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    assert.deepEqual(actual, columns, `columns of ${table}`);
  }
});

test("each column has the card's type and NOT NULL setting", () => {
  const db = freshDb();
  for (const [table, expected] of Object.entries(EXPECTED_TYPES)) {
    const actual = {};
    for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) {
      actual[c.name] = c.type + (c.notnull ? "" : "?");
    }
    assert.deepEqual(actual, expected, `types of ${table}`);
  }
});

test("no column is named text, content, body, transcript or note", () => {
  const db = freshDb();
  const banned = new Set(["text", "content", "body", "transcript", "note"]);
  for (const table of Object.keys(EXPECTED)) {
    for (const col of db.prepare(`PRAGMA table_info(${table})`).all()) {
      // idempotency.body holds a stored reply (PR 11), not note content; the marker test in idempotency-store.test.ts checks it.
      if (table === "idempotency" && col.name === "body") continue;
      assert.equal(banned.has(col.name), false, `${table}.${col.name}`);
    }
  }
});

test("idempotency has no column named text, content, transcript or note", () => {
  const db = freshDb();
  const columns = db.prepare("PRAGMA table_info(idempotency)").all().map((c) => c.name);
  for (const name of ["text", "content", "transcript", "note"]) {
    assert.equal(columns.includes(name), false, `idempotency.${name}`);
  }
});

test("each required index exists on its columns", () => {
  const db = freshDb();
  for (const [table, columns] of REQUIRED_INDEXES) {
    const indexes = db.prepare(`PRAGMA index_list(${table})`).all();
    const found = indexes.some((idx) =>
      db.prepare(`PRAGMA index_info(${idx.name})`).all().map((c) => c.name).join(",") === columns.join(","),
    );
    assert.equal(found, true, `index on ${table}(${columns.join(", ")})`);
  }
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
      db.prepare("INSERT INTO groups (id, kind, name_locked, created_by) VALUES ('g1', 'team', 'sealed', 'u1')").run(),
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

const BAD_CHECKS = [
  ["invites.role", "INSERT INTO invites (token_hash, group_id, role, expires_at) VALUES ('h1', 'g1', 'admin', 1)"],
  ["entitlements.source", "INSERT INTO entitlements (user_id, product, source, granted_at) VALUES ('u1', 'waypoint', 'gift', 1)"],
  ["purchases.kind", "INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba_1', 'p', 'lifetime', 'active', 1)"],
  ["purchases.status", "INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba_1', 'p', 'consumable', 'pending', 1)"],
  ["jobs.type", "INSERT INTO jobs (id, user_id, type, state, quoted, created_at) VALUES ('j1', 'u1', 'summarize', 'queued', 5, 1)"],
  ["users.zero_retention", "INSERT INTO users (id, clerk_id, created_at, billing_account_id, zero_retention) VALUES ('u9', 'c9', 1, 'ba_9', 2)"],
  ["devices.can_approve", "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at) VALUES ('d9', 'u1', 'phone', 'ios', 's', 'b', 2, 1)"],
];

for (const [label, sql] of BAD_CHECKS) {
  test(`rejects a bad ${label}`, () => {
    const db = freshDb();
    seedGroupAndDevice(db);
    assert.throws(() => db.prepare(sql).run(), /CHECK constraint failed/);
  });
}

const MISSING_PARENTS = [
  ["entitlements.user_id", "INSERT INTO entitlements (user_id, product, source, granted_at) VALUES ('missing', 'waypoint', 'purchase', 1)"],
  ["devices.user_id", "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, added_at) VALUES ('d2', 'missing', 'phone', 'ios', 's', 'b', 1)"],
  ["recovery.user_id", "INSERT INTO recovery (user_id, wrapped_account_key) VALUES ('missing', 'k')"],
  ["groups.created_by", "INSERT INTO groups (id, kind, name_locked, created_by) VALUES ('g2', 'personal', 'sealed', 'missing')"],
  ["memberships.group_id", "INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('missing', 'u1', 'owner', 1, 1)"],
  ["memberships.user_id", "INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g1', 'missing', 'viewer', 1, 1)"],
  ["key_envelopes.group_id", "INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) VALUES ('missing', 1, 'd1', 'k')"],
  ["key_envelopes.device_id", "INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) VALUES ('g1', 1, 'missing', 'k')"],
  ["invites.group_id", "INSERT INTO invites (token_hash, group_id, role, expires_at) VALUES ('h1', 'missing', 'viewer', 1)"],
  ["invites.accepted_by", "INSERT INTO invites (token_hash, group_id, role, expires_at, accepted_by) VALUES ('h1', 'g1', 'viewer', 1, 'missing')"],
  ["links.group_id", "INSERT INTO links (id, group_id, blob_key) VALUES ('l1', 'missing', 'b')"],
  ["jobs.user_id", "INSERT INTO jobs (id, user_id, type, state, quoted, created_at) VALUES ('j1', 'missing', 'research', 'queued', 5, 1)"],
  ["activity.user_id", "INSERT INTO activity (id, user_id, task, credits, route, retention, at) VALUES ('a1', 'missing', 'explain', 1, 'r', 'standard', 1)"],
];

for (const [label, sql] of MISSING_PARENTS) {
  test(`rejects a ${label} that points at a missing parent`, () => {
    const db = freshDb();
    seedGroupAndDevice(db);
    assert.throws(() => db.prepare(sql).run(), /FOREIGN KEY constraint failed/);
  });
}

test("deleting a user removes their devices, memberships and jobs, and clears created_by", () => {
  const db = freshDb();
  seedGroupAndDevice(db);
  seedUser(db, "u2", "clerk_2");
  db.exec(`
    INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) VALUES ('g1', 1, 'd1', 'k');
    INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g1', 'u1', 'owner', 1, 1);
    INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g1', 'u2', 'editor', 1, 1);
    INSERT INTO jobs (id, user_id, type, state, quoted, created_at) VALUES ('j1', 'u1', 'research', 'queued', 5, 1);
  `);
  db.prepare("DELETE FROM users WHERE id = 'u1'").run();
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM devices WHERE user_id = 'u1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM key_envelopes WHERE device_id = 'd1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM memberships WHERE user_id = 'u1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM jobs WHERE user_id = 'u1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM memberships WHERE user_id = 'u2'"), 1);
  const group = db.prepare("SELECT created_by FROM groups WHERE id = 'g1'").get();
  assert.equal(group.created_by, null);
});

test("deleting a group removes its memberships, invites and links", () => {
  const db = freshDb();
  seedGroupAndDevice(db);
  db.exec(`
    INSERT INTO memberships (group_id, user_id, role, starts_at, history_from) VALUES ('g1', 'u1', 'owner', 1, 1);
    INSERT INTO invites (token_hash, group_id, role, expires_at) VALUES ('h1', 'g1', 'viewer', 1);
    INSERT INTO links (id, group_id, blob_key) VALUES ('l1', 'g1', 'b');
  `);
  db.prepare("DELETE FROM groups WHERE id = 'g1'").run();
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM memberships WHERE group_id = 'g1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM invites WHERE group_id = 'g1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM links WHERE group_id = 'g1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM users"), 1);
});

test("rejects an idempotency state other than pending or done", () => {
  const db = freshDb();
  seedUser(db);
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO idempotency (user_id, key, request_hash, state, created_at) VALUES ('u1', 'k1', 'h', 'other', 1)",
      ).run(),
    /CHECK constraint failed/,
  );
});

test("rejects an idempotency row for a missing user", () => {
  const db = freshDb();
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO idempotency (user_id, key, request_hash, state, created_at) VALUES ('missing', 'k1', 'h', 'pending', 1)",
      ).run(),
    /FOREIGN KEY constraint failed/,
  );
});

test("deleting a user deletes their idempotency rows", () => {
  const db = freshDb();
  seedUser(db);
  seedUser(db, "u2", "clerk_2");
  db.exec(`
    INSERT INTO idempotency (user_id, key, request_hash, state, created_at) VALUES ('u1', 'k1', 'h', 'pending', 1);
    INSERT INTO idempotency (user_id, key, request_hash, state, created_at) VALUES ('u2', 'k1', 'h', 'pending', 1);
  `);
  db.prepare("DELETE FROM users WHERE id = 'u1'").run();
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM idempotency WHERE user_id = 'u1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM idempotency WHERE user_id = 'u2'"), 1);
});

test("has an index on idempotency(created_at)", () => {
  const db = freshDb();
  const indexes = db.prepare("PRAGMA index_list(idempotency)").all();
  const found = indexes.some((idx) =>
    db.prepare(`PRAGMA index_info(${idx.name})`).all().map((c) => c.name).join(",") === "created_at",
  );
  assert.equal(found, true);
});

test("rejects a bad push_tokens.environment", () => {
  const db = freshDb();
  seedUser(db);
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO push_tokens (user_id, device_id, token, environment, updated_at) VALUES ('u1', 'd1', 't1', 'dev', 1)",
      ).run(),
    /CHECK constraint failed/,
  );
});

test("rejects the same push token for two rows", () => {
  const db = freshDb();
  seedUser(db);
  seedUser(db, "u2", "clerk_2");
  db.prepare("INSERT INTO push_tokens (user_id, device_id, token, environment, updated_at) VALUES ('u1', 'd1', 't1', 'sandbox', 1)").run();
  assert.throws(
    () =>
      db.prepare("INSERT INTO push_tokens (user_id, device_id, token, environment, updated_at) VALUES ('u2', 'd2', 't1', 'sandbox', 1)").run(),
    /UNIQUE constraint failed/,
  );
});

test("deleting a user deletes their push token rows", () => {
  const db = freshDb();
  seedUser(db);
  seedUser(db, "u2", "clerk_2");
  db.exec(`
    INSERT INTO push_tokens (user_id, device_id, token, environment, updated_at) VALUES ('u1', 'd1', 't1', 'production', 1);
    INSERT INTO push_tokens (user_id, device_id, token, environment, updated_at) VALUES ('u2', 'd2', 't2', 'production', 1);
  `);
  db.prepare("DELETE FROM users WHERE id = 'u1'").run();
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = 'u1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = 'u2'"), 1);
});

test("rejects a bad devices.kind", () => {
  const db = freshDb();
  seedUser(db);
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, added_at, kind) VALUES ('d1', 'u1', 'phone', 'ios', 's', 'b', 1, 'other')",
      ).run(),
    /CHECK constraint failed/,
  );
});

test("allows one active account row per user, and another once the first is removed", () => {
  const db = freshDb();
  seedUser(db);
  const insertAccount = (id) =>
    db.prepare(
      "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, added_at, kind) VALUES (?, 'u1', 'Account key', 'account', 's', 'b', 1, 'account')",
    ).run(id);
  insertAccount("a1");
  assert.throws(() => insertAccount("a2"), /UNIQUE constraint failed/);
  db.prepare("UPDATE devices SET removed_at = 2 WHERE id = 'a1'").run();
  insertAccount("a2");
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM devices WHERE kind = 'account' AND removed_at IS NULL"), 1);
});

test("deleting a device deletes its device_pairings row", () => {
  const db = freshDb();
  seedGroupAndDevice(db);
  db.prepare(
    "INSERT INTO device_pairings (device_id, commitment, expires_at) VALUES ('d1', 'c', 1)",
  ).run();
  db.prepare("DELETE FROM devices WHERE id = 'd1'").run();
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM device_pairings WHERE device_id = 'd1'"), 0);
});

test("deleting a device sets jobs.device_id to NULL", () => {
  const db = freshDb();
  seedGroupAndDevice(db);
  db.prepare("INSERT INTO jobs (id, user_id, type, state, quoted, created_at, device_id) VALUES ('j1', 'u1', 'research', 'queued', 5, 1, 'd1')").run();
  db.prepare("DELETE FROM devices WHERE id = 'd1'").run();
  const job = db.prepare("SELECT device_id FROM jobs WHERE id = 'j1'").get();
  assert.equal(job.device_id, null);
});

test("rejects the same notification_uuid for two rows", () => {
  const db = freshDb();
  const insert = db.prepare(
    "INSERT INTO apple_notifications (notification_uuid, notification_type, received_at) VALUES (?, ?, ?)",
  );
  insert.run("n1", "REFUND", 1);
  assert.throws(() => insert.run("n1", "REFUND", 2), /UNIQUE constraint failed/);
});
