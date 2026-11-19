// test/helpers/d1.ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { BatchDb, DbStatement } from "../../src/storage.ts";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../db/d1/migrations");

function toInput(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError(`unsupported bind value: ${typeof value}`);
}

// An in-memory D1 stand-in on node:sqlite, with the directory schema applied.
export function createTestDb(): BatchDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  const bound = new WeakMap<DbStatement, { query: string; values: SQLInputValue[] }>();
  const statement = (query: string, values: SQLInputValue[]): DbStatement => {
    const made: DbStatement = {
      bind: (...next) => statement(query, next.map(toInput)),
      first: async <T,>() => (db.prepare(query).get(...values) ?? null) as T | null,
      all: async <T,>() => ({ results: db.prepare(query).all(...values) as T[] }),
      run: async () => ({ meta: { changes: Number(db.prepare(query).run(...values).changes) } }),
    };
    bound.set(made, { query, values });
    return made;
  };
  return {
    prepare: (query) => statement(query, []),
    // Like D1's batch: one transaction, run without yielding; any failure rolls every statement back.
    batch: async (statements) => {
      const items = statements.map((item) => {
        const found = bound.get(item);
        if (found === undefined) throw new TypeError("statement is not from this database");
        return found;
      });
      db.exec("BEGIN");
      try {
        const results = items.map(({ query, values }) => ({ meta: { changes: Number(db.prepare(query).run(...values).changes) } }));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
