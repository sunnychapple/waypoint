import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { deleteSetting, getSetting, setSetting } from "../src/core/db/settings.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
});

describe("settings", () => {
  it("getSetting returns null for a missing key", () => {
    expect(getSetting(db, "theme")).toBeNull();
  });

  it("setSetting stores a value that getSetting returns", () => {
    setSetting(db, "theme", "dark");
    expect(getSetting(db, "theme")).toBe("dark");
  });

  it("setSetting overwrites an existing value", () => {
    setSetting(db, "theme", "dark");
    setSetting(db, "theme", "light");
    expect(getSetting(db, "theme")).toBe("light");
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM settings")?.n).toBe(1);
  });

  it("deleteSetting removes the key", () => {
    setSetting(db, "theme", "dark");
    deleteSetting(db, "theme");
    expect(getSetting(db, "theme")).toBeNull();
  });
});
