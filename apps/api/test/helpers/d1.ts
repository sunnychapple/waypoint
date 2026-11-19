// test/helpers/d1.ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Db, DbStatement } from "../../src/storage.ts";

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../db/d1/migrations/0001_directory.sql",
);

function toInput(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError(`unsupported bind value: ${typeof value}`);
}

// An in-memory D1 stand-in on node:sqlite, with the directory schema applied.
export function createTestDb(): Db {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(MIGRATION, "utf8"));
  const statement = (query: string, values: SQLInputValue[]): DbStatement => ({
    bind: (...next) => statement(query, next.map(toInput)),
    first: async <T,>() => (db.prepare(query).get(...values) ?? null) as T | null,
    all: async <T,>() => ({ results: db.prepare(query).all(...values) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(query).run(...values).changes) } }),
  });
  return { prepare: (query) => statement(query, []) };
}
