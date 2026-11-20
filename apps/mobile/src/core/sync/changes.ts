import { z } from "zod";
import type { SqlDb, SqlValue } from "../db/sql.ts";

// What one locked change says (M29a). The plaintext is this JSON; it is locked with the group key under
// context("change", group id, device id, kind) (docs/security.md section 11). kind is in clear for the room.
export const SYNC_TABLES = ["spaces", "sessions", "captures", "flags", "cards"] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
type ChildTable = Exclude<SyncTable, "spaces">;

// The columns each table shares. Everything else stays on the device (files, the default space, last-used times,
// the search index). A capture's file is shared as a locked blob on paid plans (blob_id), never as a path.
export const SYNC_COLUMNS: Record<SyncTable, readonly string[]> = {
  spaces: ["id", "name", "created_at"],
  sessions: ["id", "space_id", "kind", "title", "state", "transcript", "started_at", "ended_at", "recorded_ms"],
  captures: ["id", "session_id", "kind", "t", "position", "duration_ms", "found_text", "found_lines", "blob_id"],
  flags: ["id", "session_id", "t", "question", "state"],
  cards: ["id", "session_id", "kind", "front", "back", "capture_id", "t", "made_by", "created_at", "due_at", "fsrs"],
};

// A transcript is sent in 10-minute pieces (by t_start), each its own row for last-writer-wins, so no change nears
// the room's limit. The migration's segment triggers use the same number (600000).
export const SEGMENT_BUCKET_MS = 600_000;
// The largest plaintext that is queued. Locking adds 33 bytes and the room takes up to 1,048,576; a bigger change
// (a huge page text, say) stays on this iPhone instead of blocking the outbox.
export const MAX_CHANGE_BYTES = 1_000_000;
// Received changes kept while they wait for their session, per group (the oldest go first).
export const MAX_PENDING = 2_000;

const Value = z.union([z.string(), z.number(), z.null()]);
const At = z.number().int().min(0).max(4_102_444_800_000);
export const SyncChangeSchema = z.discriminatedUnion("op", [
  z.strictObject({ v: z.literal(1), id: z.string().min(16).max(64), at: At, op: z.literal("upsert"), table: z.enum(SYNC_TABLES), row: z.record(z.string(), Value) }),
  z.strictObject({ v: z.literal(1), id: z.string().min(16).max(64), at: At, op: z.literal("delete"), table: z.enum(SYNC_TABLES), row_id: z.string().min(1).max(64) }),
  z.strictObject({
    v: z.literal(1),
    id: z.string().min(16).max(64),
    at: At,
    op: z.literal("segments"),
    session_id: z.string().min(1).max(64),
    source: z.enum(["device", "cloud"]),
    bucket: z.number().int().min(0).max(1_000_000),
    rows: z.array(z.strictObject({ t_start: z.number().int().min(0), t_end: z.number().int().min(0), text: z.string() })).max(20_000),
  }),
]);
export type SyncChange = z.infer<typeof SyncChangeSchema>;
export type SyncDeps = { now: () => number; newId: () => string; deviceId: string };
export type ApplyResult = "applied" | "older" | "deferred" | "rejected";

// The room's clear kind for a change (PR 28's ChangeKindSchema: [a-z_]{1,32}).
export function changeKind(change: SyncChange): string {
  return change.op === "segments" ? "segments" : change.op === "delete" ? `delete_${change.table}` : change.table;
}

// The row_versions key: a space is the group's one space whatever its id on each iPhone; segments go by piece.
function rowKey(change: SyncChange, groupId: string): string {
  if (change.op === "segments") return `${change.session_id}:${change.source}:${change.bucket}`;
  if (change.op === "delete") return change.row_id;
  return change.table === "spaces" ? groupId : typeof change.row.id === "string" ? change.row.id : "";
}

function rowTable(change: SyncChange): string {
  return change.op === "segments" ? "segments" : change.table;
}

// The group a row belongs to: through its session's space (or the space itself), when that space syncs.
export function groupOf(db: SqlDb, table: SyncTable | "segments", rowId: string): string | null {
  const sql =
    table === "spaces"
      ? "SELECT group_id FROM space_groups WHERE space_id = ?"
      : "SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = ?";
  const id = table === "spaces" || table === "sessions" || table === "segments" ? rowId.split(":")[0] ?? rowId : sessionOf(db, table, rowId);
  if (id === null) return null;
  return db.get<{ group_id: string }>(sql, [id])?.group_id ?? null;
}

function sessionOf(db: SqlDb, table: SyncTable, rowId: string): string | null {
  return db.get<{ session_id: string }>(`SELECT session_id FROM ${table} WHERE id = ?`, [rowId])?.session_id ?? null;
}

// Turns the rows changed on this iPhone (the dirty table, filled by triggers) into outbox entries, one per row,
// parents before children and deletes last. Rows in spaces that do not sync are dropped. Every queued change is
// also written to row_versions as this device's, so its echo, or an older change from another device, cannot
// overwrite it. All changes of one run share one time, later than any change this iPhone has made or applied.
export function collectChanges(db: SqlDb, deps: SyncDeps): number {
  let made = 0;
  db.transaction(() => {
    const dirty = db.all<{ table_name: SyncTable | "segments"; row_id: string; deleted: number; group_id: string | null }>(
      `SELECT table_name, row_id, deleted, group_id FROM dirty WHERE seq IN (SELECT max(seq) FROM dirty GROUP BY table_name, row_id)
       ORDER BY deleted, CASE table_name WHEN 'spaces' THEN 0 WHEN 'sessions' THEN 1 WHEN 'captures' THEN 2 WHEN 'flags' THEN 3 WHEN 'cards' THEN 4 ELSE 5 END, seq`,
    );
    const clock = db.get<{ clock: number }>("SELECT clock FROM sync_mode")?.clock ?? 0;
    const at = Math.max(deps.now(), clock + 1);
    for (const d of dirty) {
      const group = d.deleted === 1 ? d.group_id : groupOf(db, d.table_name, d.row_id);
      const change = group === null ? null : buildChange(db, d, deps.newId(), at);
      if (group === null || change === null) continue;
      const body = JSON.stringify(change);
      if (new TextEncoder().encode(body).length > MAX_CHANGE_BYTES) continue;
      db.run("INSERT INTO outbox (id, group_id, kind, body, blob_capture_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
        change.id,
        group,
        changeKind(change),
        body,
        change.op === "upsert" && change.table === "captures" ? d.row_id : null,
        at,
      ]);
      db.run("INSERT OR REPLACE INTO row_versions (table_name, row_id, at, device_id) VALUES (?, ?, ?, ?)", [rowTable(change), rowKey(change, group), at, deps.deviceId]);
      made += 1;
    }
    if (dirty.length > 0) db.run("UPDATE sync_mode SET clock = max(clock, ?)", [at]);
    db.run("DELETE FROM dirty");
  });
  return made;
}

function buildChange(db: SqlDb, d: { table_name: SyncTable | "segments"; row_id: string; deleted: number }, id: string, at: number): SyncChange | null {
  const base = { v: 1 as const, id, at };
  if (d.table_name === "segments") {
    const [sessionId, source, piece] = d.row_id.split(":");
    const bucket = Number(piece);
    if (sessionId === undefined || (source !== "device" && source !== "cloud") || !Number.isInteger(bucket) || bucket < 0) return null;
    const rows = db.all<{ t_start: number; t_end: number; text: string }>(
      "SELECT t_start, t_end, text FROM segments WHERE session_id = ? AND source = ? AND t_start >= ? AND t_start < ? ORDER BY t_start",
      [sessionId, source, bucket * SEGMENT_BUCKET_MS, (bucket + 1) * SEGMENT_BUCKET_MS],
    );
    return { ...base, op: "segments", session_id: sessionId, source, bucket, rows };
  }
  if (d.deleted === 1) return { ...base, op: "delete", table: d.table_name, row_id: d.row_id };
  const columns = SYNC_COLUMNS[d.table_name];
  const row = db.get<Record<string, SqlValue>>(`SELECT ${columns.join(", ")} FROM ${d.table_name} WHERE id = ?`, [d.row_id]);
  if (row === null) return null;
  const clean: Record<string, string | number | null> = {};
  for (const c of columns) {
    const v = row[c];
    clean[c] = v instanceof Uint8Array || v === undefined ? null : v;
  }
  return { ...base, op: "upsert", table: d.table_name, row: clean };
}

// Last writer wins per row, by (at, device id). Records the change and moves the clock when it is newer.
function newer(db: SqlDb, table: string, rowId: string, at: number, deviceId: string): boolean {
  const seen = db.get<{ at: number; device_id: string }>("SELECT at, device_id FROM row_versions WHERE table_name = ? AND row_id = ?", [table, rowId]);
  if (seen !== null && (seen.at > at || (seen.at === at && seen.device_id >= deviceId))) return false;
  db.run("INSERT OR REPLACE INTO row_versions (table_name, row_id, at, device_id) VALUES (?, ?, ?, ?)", [table, rowId, at, deviceId]);
  db.run("UPDATE sync_mode SET clock = max(clock, ?)", [at]);
  return true;
}

// The space a session, capture, flag or card is in on this iPhone, or null when the row is not here.
function spaceOf(db: SqlDb, table: ChildTable, id: string): string | null {
  const sql = table === "sessions" ? "SELECT space_id FROM sessions WHERE id = ?" : `SELECT s.space_id FROM ${table} x JOIN sessions s ON s.id = x.session_id WHERE x.id = ?`;
  return db.get<{ space_id: string }>(sql, [id])?.space_id ?? null;
}

// A row that is not here but has a version was deleted.
function wasDeleted(db: SqlDb, table: ChildTable, id: string): boolean {
  return db.get("SELECT 1 AS ok FROM row_versions WHERE table_name = ? AND row_id = ?", [table, id]) !== null;
}

// Applies one unlocked change from the group's log to this iPhone's tables, without marking anything dirty. Never
// throws for a bad change:
// - "applied": written; "older": not newer than what this iPhone has (an echo, a replay, a late change, or its
//   session was deleted);
// - "deferred": its session (or a card's photo) has not arrived; kept in sync_pending and applied when it does;
// - "rejected": unusable (unknown group, a row outside the group's space, a value the tables refuse).
// Everything lands in the space this iPhone maps to the group; nothing outside it is read or changed.
export function applyChange(db: SqlDb, groupId: string, change: SyncChange, deviceId: string): ApplyResult {
  const space = db.get<{ space_id: string }>("SELECT space_id FROM space_groups WHERE group_id = ?", [groupId])?.space_id;
  if (space === undefined) return "rejected";
  let result: ApplyResult = "rejected";
  db.transaction(() => {
    db.run("UPDATE sync_mode SET applying = 1");
    result = applyOne(db, groupId, space, change, deviceId);
    db.run("UPDATE sync_mode SET applying = 0");
  });
  return result;
}

// M29b's pull, for one page of unlocked changes: this iPhone's own edits are collected first, in the same
// synchronous run, so a received change is compared with them and cannot overwrite one that was not yet collected.
export function applyPulled(db: SqlDb, groupId: string, pulled: readonly { change: SyncChange; deviceId: string }[], deps: SyncDeps): Record<ApplyResult, number> {
  collectChanges(db, deps);
  const counts: Record<ApplyResult, number> = { applied: 0, older: 0, deferred: 0, rejected: 0 };
  for (const p of pulled) counts[applyChange(db, groupId, p.change, p.deviceId)] += 1;
  return counts;
}

// One change inside a savepoint: a constraint error (a bad enum, a missing value) undoes only this change.
function applyOne(db: SqlDb, groupId: string, space: string, change: SyncChange, deviceId: string): ApplyResult {
  db.exec("SAVEPOINT apply_change");
  try {
    const result = write(db, groupId, space, change, deviceId);
    db.exec("RELEASE apply_change");
    return result;
  } catch (error) {
    db.exec("ROLLBACK TO apply_change");
    db.exec("RELEASE apply_change");
    if (error instanceof Error && /constraint failed/i.test(error.message)) return "rejected";
    throw error;
  }
}

function write(db: SqlDb, groupId: string, space: string, change: SyncChange, deviceId: string): ApplyResult {
  const table = rowTable(change);
  const key = rowKey(change, groupId);
  if (key === "") return "rejected";
  if (change.op === "delete") {
    if (change.table === "spaces") return "rejected";
    const here = spaceOf(db, change.table, key);
    if (here !== null && here !== space) return "rejected";
    if (!newer(db, table, key, change.at, deviceId)) return "older";
    db.run(`DELETE FROM ${change.table} WHERE id = ?`, [key]);
    if (change.table === "sessions") db.run("DELETE FROM sync_pending WHERE group_id = ? AND wait_for = ?", [groupId, key]);
    return "applied";
  }
  if (change.op === "upsert" && change.table === "spaces") {
    if (typeof change.row.name !== "string") return "rejected";
    if (!newer(db, table, key, change.at, deviceId)) return "older";
    db.run("UPDATE spaces SET name = ? WHERE id = ?", [change.row.name.slice(0, 60) || "Shared space", space]);
    return "applied";
  }
  if (change.op === "upsert" && change.table === "sessions") {
    const here = spaceOf(db, "sessions", key);
    if (here !== null && here !== space) return "rejected";
    if (!newer(db, table, key, change.at, deviceId)) return "older";
    upsertRow(db, "sessions", { ...change.row, space_id: space });
    retryPending(db, groupId, space, key);
    return "applied";
  }
  // Segments, captures, flags and cards need their session, in this group's space.
  const sessionId = change.op === "segments" ? change.session_id : change.row.session_id;
  if (typeof sessionId !== "string") return "rejected";
  const parent = spaceOf(db, "sessions", sessionId);
  if (parent === null) return wasDeleted(db, "sessions", sessionId) ? "older" : defer(db, groupId, change, deviceId, table, key, sessionId);
  if (parent !== space) return "rejected";
  if (change.op === "segments") {
    if (!newer(db, table, key, change.at, deviceId)) return "older";
    const from = change.bucket * SEGMENT_BUCKET_MS;
    const to = from + SEGMENT_BUCKET_MS;
    db.run("DELETE FROM segments WHERE session_id = ? AND source = ? AND t_start >= ? AND t_start < ?", [sessionId, change.source, from, to]);
    for (const r of change.rows) {
      if (r.t_start < from || r.t_start >= to) continue;
      db.run("INSERT OR IGNORE INTO segments (session_id, t_start, t_end, text, source) VALUES (?, ?, ?, ?, ?)", [sessionId, r.t_start, Math.max(r.t_start, r.t_end), r.text, change.source]);
    }
    return "applied";
  }
  if (change.table === "spaces" || change.table === "sessions") return "rejected";
  const here = spaceOf(db, change.table, key);
  if (here !== null && here !== space) return "rejected";
  const row = { ...change.row };
  if (change.table === "cards" && typeof row.capture_id === "string") {
    const photo = spaceOf(db, "captures", row.capture_id);
    if (photo === null && !wasDeleted(db, "captures", row.capture_id)) return defer(db, groupId, change, deviceId, table, key, row.capture_id);
    if (photo === null) row.capture_id = null;
    else if (photo !== space) return "rejected";
  }
  if (!newer(db, table, key, change.at, deviceId)) return "older";
  upsertRow(db, change.table, row);
  if (change.table === "captures") retryPending(db, groupId, space, key);
  return "applied";
}

function upsertRow(db: SqlDb, table: ChildTable, source: Record<string, string | number | null>): void {
  const columns = [...SYNC_COLUMNS[table]];
  const values: SqlValue[] = columns.map((c) => source[c] ?? null);
  if (table === "captures") {
    columns.push("file");
    values.push("");
  }
  const updates = SYNC_COLUMNS[table]
    .filter((c) => c !== "id")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  db.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT (id) DO UPDATE SET ${updates}`, values);
}

// Keeps the newest waiting version of a row; nothing is marked seen, so it is compared again when it is applied.
function defer(db: SqlDb, groupId: string, change: SyncChange, deviceId: string, table: string, key: string, waitFor: string): ApplyResult {
  db.run(
    `INSERT INTO sync_pending (group_id, table_name, row_id, wait_for, at, device_id, body) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (group_id, table_name, row_id) DO UPDATE SET wait_for = excluded.wait_for, at = excluded.at, device_id = excluded.device_id, body = excluded.body
     WHERE excluded.at > sync_pending.at OR (excluded.at = sync_pending.at AND excluded.device_id > sync_pending.device_id)`,
    [groupId, table, key, waitFor, change.at, deviceId, JSON.stringify(change)],
  );
  db.run("DELETE FROM sync_pending WHERE rowid IN (SELECT rowid FROM sync_pending WHERE group_id = ? ORDER BY at DESC LIMIT -1 OFFSET ?)", [groupId, MAX_PENDING]);
  return "deferred";
}

// Applies what waited for this session or photo (a card may then wait again, for its photo).
function retryPending(db: SqlDb, groupId: string, space: string, waitFor: string): void {
  const waiting = db.all<{ body: string; device_id: string }>("SELECT body, device_id FROM sync_pending WHERE group_id = ? AND wait_for = ? ORDER BY at", [groupId, waitFor]);
  db.run("DELETE FROM sync_pending WHERE group_id = ? AND wait_for = ?", [groupId, waitFor]);
  for (const p of waiting) {
    const parsed = SyncChangeSchema.safeParse(JSON.parse(p.body));
    if (parsed.success) applyOne(db, groupId, space, parsed.data, p.device_id);
  }
}

export type Outgoing = { id: string; groupId: string; kind: string; body: string; blobCaptureId: string | null };

// In the order collectChanges queued them.
export function nextOutgoing(db: SqlDb, limit = 50): Outgoing[] {
  return db.all<Outgoing>("SELECT id, group_id AS groupId, kind, body, blob_capture_id AS blobCaptureId FROM outbox ORDER BY seq LIMIT ?", [limit]);
}

export function sent(db: SqlDb, id: string): void {
  db.run("DELETE FROM outbox WHERE id = ?", [id]);
}

export function lastSeq(db: SqlDb, groupId: string): number {
  return db.get<{ last_seq: number }>("SELECT last_seq FROM sync_state WHERE group_id = ?", [groupId])?.last_seq ?? 0;
}

export function setLastSeq(db: SqlDb, groupId: string, seq: number, now: number): void {
  db.run(
    "INSERT INTO sync_state (group_id, last_seq, pulled_at) VALUES (?, ?, ?) ON CONFLICT (group_id) DO UPDATE SET last_seq = max(last_seq, excluded.last_seq), pulled_at = excluded.pulled_at",
    [groupId, seq, now],
  );
}
