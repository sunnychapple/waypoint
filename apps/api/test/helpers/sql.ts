// test/helpers/sql.ts
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlStore, SqlValue } from "../../src/storage.ts";

function toInput(value: SqlValue): SQLInputValue {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

function fromOutput(value: unknown): SqlValue {
  if (value instanceof Uint8Array) return value.slice().buffer;
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  throw new TypeError(`unsupported column value: ${typeof value}`);
}

// An in-memory stand-in for Durable Object SQLite storage on node:sqlite.
export function createTestStore(): SqlStore {
  const db = new DatabaseSync(":memory:");
  return {
    sql: {
      exec(query, ...bindings) {
        const rows = db.prepare(query).all(...bindings.map(toInput));
        return {
          toArray: () =>
            rows.map((row) =>
              Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fromOutput(value)])),
            ),
        };
      },
    },
    transactionSync(fn) {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
