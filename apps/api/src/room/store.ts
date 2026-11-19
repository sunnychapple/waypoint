import type { SqlStore } from "../storage.ts";

export type NewChange = {
  device_id: string;
  key_version: number;
  kind: string;
  locked_bytes: ArrayBuffer;
  blob_key: string | null;
};

export type Change = NewChange & { seq: number; at: number };

const DEVICE_ID = /^[A-Za-z0-9_:-]{1,128}$/;
const KIND = /^[a-z_]{1,32}$/;
const MAX_LOCKED_BYTES = 1_048_576;
const MAX_BLOB_KEY = 512;
const MAX_LIMIT = 500;

export function createRoomStore(store: SqlStore): {
  append(change: NewChange, now: number): { seq: number };
  after(seq: number, limit: number): { changes: Change[]; last_seq: number };
  ack(deviceId: string, seq: number, now: number): void;
} {
  store.sql.exec(
    `CREATE TABLE IF NOT EXISTS changes (
       seq INTEGER PRIMARY KEY,
       device_id TEXT NOT NULL,
       key_version INTEGER NOT NULL,
       kind TEXT NOT NULL,
       locked_bytes BLOB NOT NULL,
       blob_key TEXT,
       at INTEGER NOT NULL
     )`,
  );
  store.sql.exec(
    `CREATE TABLE IF NOT EXISTS cursors (
       device_id TEXT PRIMARY KEY,
       last_seq INTEGER NOT NULL,
       seen_at INTEGER NOT NULL
     )`,
  );

  function lastSeq(): number {
    const [row] = store.sql.exec("SELECT COALESCE(MAX(seq), 0) AS last_seq FROM changes").toArray();
    const value = row?.last_seq;
    if (typeof value !== "number") throw new TypeError("corrupt changes table");
    return value;
  }

  return {
    append(change, now) {
      if (typeof change.device_id !== "string" || !DEVICE_ID.test(change.device_id)) {
        throw new RangeError("device_id is not valid");
      }
      if (!Number.isSafeInteger(change.key_version) || change.key_version < 1) {
        throw new RangeError("key_version must be a safe integer of at least 1");
      }
      if (typeof change.kind !== "string" || !KIND.test(change.kind)) throw new RangeError("kind is not valid");
      if (!(change.locked_bytes instanceof ArrayBuffer)) throw new RangeError("locked_bytes must be an ArrayBuffer");
      if (change.locked_bytes.byteLength < 1 || change.locked_bytes.byteLength > MAX_LOCKED_BYTES) {
        throw new RangeError("locked_bytes must be 1 to 1,048,576 bytes");
      }
      if (change.blob_key !== null && typeof change.blob_key !== "string") {
        throw new RangeError("blob_key must be null or a string");
      }
      if (change.blob_key !== null && (change.blob_key.length < 1 || change.blob_key.length > MAX_BLOB_KEY)) {
        throw new RangeError("blob_key must be null or 1 to 512 characters");
      }

      return store.transactionSync(() => {
        const seq = lastSeq() + 1;
        store.sql.exec(
          "INSERT INTO changes (seq, device_id, key_version, kind, locked_bytes, blob_key, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          seq,
          change.device_id,
          change.key_version,
          change.kind,
          change.locked_bytes,
          change.blob_key,
          now,
        );
        return { seq };
      });
    },

    after(seq, limit) {
      if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError("seq must be a safe integer of at least 0");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new RangeError("limit must be 1 to 500");
      }

      const rows = store.sql
        .exec(
          "SELECT seq, device_id, key_version, kind, locked_bytes, blob_key, at FROM changes WHERE seq > ? ORDER BY seq LIMIT ?",
          seq,
          limit,
        )
        .toArray();
      const changes = rows.map((row): Change => {
        const { seq: rowSeq, device_id, key_version, kind, locked_bytes, blob_key, at } = row;
        if (
          typeof rowSeq !== "number" ||
          typeof device_id !== "string" ||
          typeof key_version !== "number" ||
          typeof kind !== "string" ||
          !(locked_bytes instanceof ArrayBuffer) ||
          (blob_key !== null && typeof blob_key !== "string") ||
          typeof at !== "number"
        ) {
          throw new TypeError("corrupt changes row");
        }
        return { seq: rowSeq, device_id, key_version, kind, locked_bytes, blob_key, at };
      });
      return { changes, last_seq: lastSeq() };
    },

    ack(deviceId, seq, now) {
      if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) throw new RangeError("device_id is not valid");
      if (!Number.isSafeInteger(seq) || seq < 0 || seq > lastSeq()) {
        throw new RangeError("seq must be a safe integer from 0 to the room's last seq");
      }
      store.sql.exec(
        `INSERT INTO cursors (device_id, last_seq, seen_at) VALUES (?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           last_seq = max(cursors.last_seq, excluded.last_seq),
           seen_at = excluded.seen_at`,
        deviceId,
        seq,
        now,
      );
    },
  };
}
