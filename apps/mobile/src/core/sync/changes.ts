import { z } from "zod";
import type { SqlDb, SqlValue } from "../db/sql.ts";

// What one locked change says (M29a). The plaintext is this JSON; it is locked with the group key under
// context("change", group id, device id, kind) (docs/security.md section 11). kind is in clear for the room.
export const SYNC_TABLES = ["spaces", "sessions", "captures", "flags", "cards"] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

// The columns each table shares. Everything else stays on the device (files, the default space, last-used times,
// the search index). A capture's file is shared as a locked blob on paid plans (blob_id), never as a path.
export const SYNC_COLUMNS: Record<SyncTable, readonly string[]> = {
  spaces: ["id", "name", "created_at"],
  sessions: ["id", "space_id", "kind", "title", "state", "transcript", "started_at", "ended_at", "recorded_ms"],
  captures: ["id", "session_id", "kind", "t", "position", "duration_ms", "found_text", "found_lines", "blob_id"],
  flags: ["id", "session_id", "t", "question", "state"],
  cards: ["id", "session_id", "kind", "front", "back", "capture_id", "t", "made_by", "created_at", "due_at", "fsrs"],
};

const Value = z.union([z.string(), z.number(), z.null()]);
export const SyncChangeSchema = z.discriminatedUnion("op", [
  z.strictObject({ v: z.literal(1), id: z.string().min(16).max(64), at: z.number().int(), op: z.literal("upsert"), table: z.enum(SYNC_TABLES), row: z.record(z.string(), Value) }),
  z.strictObject({ v: z.literal(1), id: z.string().min(16).max(64), at: z.number().int(), op: z.literal("delete"), table: z.enum(SYNC_TABLES), row_id: z.string().min(1).max(64) }),
  z.strictObject({
    v: z.literal(1),
    id: z.string().min(16).max(64),
    at: z.number().int(),
    op: z.literal("segments"),
    session_id: z.string().min(1).max(64),
    source: z.enum(["device", "cloud"]),
    rows: z.array(z.strictObject({ t_start: z.number().int().min(0), t_end: z.number().int().min(0), text: z.string() })).max(20_000),
  }),
]);
export type SyncChange = z.infer<typeof SyncChangeSchema>;

// The room's clear kind for a change (PR 28's ChangeKindSchema: [a-z_]{1,32}).
export function changeKind(change: SyncChange): string {
  return change.op === "segments" ? "segments" : change.op === "delete" ? `delete_${change.table}` : change.table;
}

// The group a row belongs to: through its session's space (or the space itself), when that space syncs.
export function groupOf(db: SqlDb, table: SyncTable | "segments", rowId: string): string | null {
  const sql =
    table === "spaces"
      ? "SELECT group_id FROM space_groups WHERE space_id = ?"
      : table === "sessions"
        ? "SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = ?"
        : "SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = ?";
  const id = table === "spaces" || table === "sessions" || table === "segments" ? rowId.split(":")[0] ?? rowId : sessionOf(db, table, rowId);
  if (id === null) return null;
  return db.get<{ group_id: string }>(sql, [id])?.group_id ?? null;
}

function sessionOf(db: SqlDb, table: SyncTable, rowId: string): string | null {
  return db.get<{ session_id: string }>(`SELECT session_id FROM ${table} WHERE id = ?`, [rowId])?.session_id ?? null;
}

// Turns the rows changed on this iPhone (the dirty table, filled by triggers) into outbox entries, one per row.
// Rows in spaces that do not sync are dropped.
export function collectChanges(db: SqlDb, deps: { now: () => number; newId: () => string }): number {
  let made = 0;
  db.transaction(() => {
    const dirty = db.all<{ table_name: SyncTable | "segments"; row_id: string; deleted: number; group_id: string | null }>(
      "SELECT table_name, row_id, deleted, group_id FROM dirty WHERE seq IN (SELECT max(seq) FROM dirty GROUP BY table_name, row_id) ORDER BY seq",
    );
    for (const d of dirty) {
      const group = d.deleted === 1 ? d.group_id : groupOf(db, d.table_name, d.row_id);
      const change = group === null ? null : buildChange(db, d, deps);
      if (group !== null && change !== null) {
        db.run("INSERT INTO outbox (id, group_id, kind, body, blob_capture_id, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
          change.id,
          group,
          changeKind(change),
          JSON.stringify(change),
          change.op === "upsert" && change.table === "captures" ? (change.row.id as string) : null,
          change.at,
        ]);
        made += 1;
      }
    }
    db.run("DELETE FROM dirty");
  });
  return made;
}

function buildChange(db: SqlDb, d: { table_name: SyncTable | "segments"; row_id: string; deleted: number }, deps: { now: () => number; newId: () => string }): SyncChange | null {
  const base = { v: 1 as const, id: deps.newId(), at: deps.now() };
  if (d.table_name === "segments") {
    const [sessionId, source] = d.row_id.split(":");
    if (sessionId === undefined || (source !== "device" && source !== "cloud")) return null;
    const rows = db.all<{ t_start: number; t_end: number; text: string }>("SELECT t_start, t_end, text FROM segments WHERE session_id = ? AND source = ? ORDER BY t_start", [sessionId, source]);
    return { ...base, op: "segments", session_id: sessionId, source, rows };
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

// Last writer wins per row, by (at, device id). Returns true when the change is newer than what is stored.
function newer(db: SqlDb, table: string, rowId: string, at: number, deviceId: string): boolean {
  const seen = db.get<{ at: number; device_id: string }>("SELECT at, device_id FROM row_versions WHERE table_name = ? AND row_id = ?", [table, rowId]);
  if (seen !== null && (seen.at > at || (seen.at === at && seen.device_id >= deviceId))) return false;
  db.run("INSERT OR REPLACE INTO row_versions (table_name, row_id, at, device_id) VALUES (?, ?, ?, ?)", [table, rowId, at, deviceId]);
  return true;
}

// Applies one unlocked change from the group's log to this iPhone's tables, without marking anything dirty. A
// session always goes into the space this iPhone maps to the group. Returns false when it was older or not usable.
export function applyChange(db: SqlDb, groupId: string, change: SyncChange, deviceId: string): boolean {
  const space = db.get<{ space_id: string }>("SELECT space_id FROM space_groups WHERE group_id = ?", [groupId])?.space_id;
  if (space === undefined) return false;
  let applied = false;
  db.transaction(() => {
    db.run("UPDATE sync_mode SET applying = 1");
    try {
      const key = change.op === "segments" ? `${change.session_id}:${change.source}` : change.op === "delete" ? change.row_id : String(change.row.id ?? "");
      const table = change.op === "segments" ? "segments" : change.table;
      if (key === "" || !newer(db, table, key, change.at, deviceId)) return;
      if (change.op === "delete") {
        if (change.table !== "spaces") db.run(`DELETE FROM ${change.table} WHERE id = ?`, [change.row_id]);
      } else if (change.op === "segments") {
        if (db.get("SELECT 1 AS ok FROM sessions WHERE id = ? AND space_id = ?", [change.session_id, space]) === null) return;
        db.run("DELETE FROM segments WHERE session_id = ? AND source = ?", [change.session_id, change.source]);
        for (const r of change.rows) {
          db.run("INSERT OR IGNORE INTO segments (session_id, t_start, t_end, text, source) VALUES (?, ?, ?, ?, ?)", [change.session_id, r.t_start, Math.max(r.t_start, r.t_end), r.text, change.source]);
        }
      } else if (change.table === "spaces") {
        if (typeof change.row.name === "string") db.run("UPDATE spaces SET name = ? WHERE id = ?", [change.row.name.slice(0, 60) || "Shared space", space]);
      } else {
        const row: Record<string, string | number | null> = {};
        for (const c of SYNC_COLUMNS[change.table]) row[c] = change.row[c] ?? null;
        if (change.table === "sessions") row.space_id = space;
        const columns = Object.keys(row);
        const extra = change.table === "captures" ? ", file" : "";
        const values = columns.map((c) => row[c] ?? null);
        if (change.table === "captures") values.push("");
        const updates = columns.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
        db.run(
          `INSERT INTO ${change.table} (${columns.join(", ")}${extra}) VALUES (${values.map(() => "?").join(", ")}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
          values,
        );
      }
      applied = true;
    } finally {
      db.run("UPDATE sync_mode SET applying = 0");
    }
  });
  return applied;
}

export type Outgoing = { id: string; groupId: string; kind: string; body: string; blobCaptureId: string | null };

export function nextOutgoing(db: SqlDb, limit = 50): Outgoing[] {
  return db.all<Outgoing>(
    "SELECT id, group_id AS groupId, kind, body, blob_capture_id AS blobCaptureId FROM outbox ORDER BY created_at, id LIMIT ?",
    [limit],
  );
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
