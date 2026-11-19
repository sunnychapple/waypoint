// test/helpers/d1.ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Db, DbStatement } from "../../src/storage.ts";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../db/d1/migrations");

function toInput(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError(`unsupported bind value: ${typeof value}`);
}

// An in-memory D1 stand-in on node:sqlite, with the directory schema applied.
export function createTestDb(): Db {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  const statement = (query: string, values: SQLInputValue[]): DbStatement => ({
    bind: (...next) => statement(query, next.map(toInput)),
    first: async <T,>() => (db.prepare(query).get(...values) ?? null) as T | null,
    all: async <T,>() => ({ results: db.prepare(query).all(...values) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(query).run(...values).changes) } }),
  });
  return { prepare: (query) => statement(query, []) };
}
