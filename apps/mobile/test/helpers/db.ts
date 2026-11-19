import { DatabaseSync } from "node:sqlite";
import type { SqlDb, SqlValue } from "../../src/core/db/sql.ts";

export function createMemoryDb(): SqlDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params: SqlValue[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    all: <T,>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    get: <T,>(sql: string, params: SqlValue[] = []) => (db.prepare(sql).get(...params) ?? null) as T | null,
    transaction: (task) => {
      db.exec("BEGIN");
      try {
        task();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
