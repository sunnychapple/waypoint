import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { createMemoryDb } from "./helpers/db.ts";

const version = (db: ReturnType<typeof createMemoryDb>) =>
  db.get<{ user_version: number }>("PRAGMA user_version")?.user_version;

describe("migrate", () => {
  it("a new database ends at version 10, and a second run changes nothing", () => {
    const db = createMemoryDb();
    expect(migrate(db)).toBe(10);
    expect(migrate(db)).toBe(10);
    expect(version(db)).toBe(10);
  });

  it("a user_version above the latest migration throws", () => {
    const db = createMemoryDb();
    db.exec("PRAGMA user_version = 99");
    expect(() => migrate(db)).toThrow("database is newer than this app");
  });

  it("a failing migration leaves the version where it was, keeps none of its tables, and rethrows", () => {
    const db = createMemoryDb();
    const broken = [
      { version: 1, sql: "CREATE TABLE ok_one (id INTEGER);" },
      { version: 2, sql: "CREATE TABLE half_done (id INTEGER); THIS IS NOT SQL;" },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(version(db)).toBe(1);
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).toContain("ok_one");
    expect(tables).not.toContain("half_done");
  });
});
