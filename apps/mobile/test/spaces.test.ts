import { beforeEach, describe, expect, it } from "vitest";
import {
  createSpace,
  ensureDefaultSpace,
  getSavingTo,
  listSpaces,
  setSavingTo,
  SpaceNameError,
} from "../src/core/db/spaces.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { setSetting } from "../src/core/db/settings.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;
let ids: number;
const deps = (now = 1000) => ({ now: () => now, newId: () => `id-${++ids}` });

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  ids = 0;
});

function nameError(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SpaceNameError) return error.message;
    throw error;
  }
  return "no error";
}

describe("spaces", () => {
  it("ensureDefaultSpace creates My notes once and returns the same space after that", () => {
    const first = ensureDefaultSpace(db, deps());
    const second = ensureDefaultSpace(db, deps());
    expect(first.name).toBe("My notes");
    expect(first.isDefault).toBe(true);
    expect(second.id).toBe(first.id);
    expect(listSpaces(db)).toHaveLength(1);
  });

  it("createSpace trims the name", () => {
    expect(createSpace(db, deps(), "  Biology  ").name).toBe("Biology");
  });

  it("createSpace throws empty for a blank name", () => {
    expect(nameError(() => createSpace(db, deps(), "   "))).toBe("empty");
  });

  it("createSpace throws too_long for a name over 60 characters", () => {
    expect(nameError(() => createSpace(db, deps(), "a".repeat(61)))).toBe("too_long");
  });

  it("createSpace throws taken for a name that exists in another case", () => {
    ensureDefaultSpace(db, deps());
    expect(nameError(() => createSpace(db, deps(), "my NOTES"))).toBe("taken");
  });

  it("createSpace throws taken for an accented name that exists in another case", () => {
    createSpace(db, deps(), "Écologie");
    expect(nameError(() => createSpace(db, deps(), "écologie"))).toBe("taken");
  });

  it("listSpaces orders by last_used_at, newest first, then by name", () => {
    createSpace(db, deps(100), "Beta");
    createSpace(db, deps(100), "Alpha");
    createSpace(db, deps(300), "Gamma");
    expect(listSpaces(db).map((s) => s.name)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("sessionCount counts the sessions in each space", () => {
    const space = createSpace(db, deps(), "Chem");
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('a', ?, 'recording', 't', 'saved', 1)", [space.id]);
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('b', ?, 'pages', 't', 'saved', 2)", [space.id]);
    expect(listSpaces(db).find((s) => s.id === space.id)?.sessionCount).toBe(2);
  });

  it("getSavingTo falls back to the default space when nothing is chosen", () => {
    const home = ensureDefaultSpace(db, deps());
    expect(getSavingTo(db).id).toBe(home.id);
  });

  it("getSavingTo falls back to the default space when the chosen id does not exist", () => {
    const home = ensureDefaultSpace(db, deps());
    setSetting(db, "saving_to", "gone");
    expect(getSavingTo(db).id).toBe(home.id);
  });

  it("setSavingTo makes that space the one getSavingTo returns and sets its last_used_at", () => {
    ensureDefaultSpace(db, deps());
    const bio = createSpace(db, deps(), "Biology");
    setSavingTo(db, bio.id, 5000);
    expect(getSavingTo(db).id).toBe(bio.id);
    expect(listSpaces(db).find((s) => s.id === bio.id)?.lastUsedAt).toBe(5000);
  });

  it("setSavingTo throws for a space that does not exist", () => {
    ensureDefaultSpace(db, deps());
    expect(() => setSavingTo(db, "nope", 5000)).toThrow();
  });
});
