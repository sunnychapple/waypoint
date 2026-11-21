import { beforeEach, describe, expect, it } from "vitest";
import {
  createSpace,
  deleteSpace,
  ensureDefaultSpace,
  freeSpaceName,
  getSavingTo,
  getSpace,
  listSpaces,
  renameSpace,
  setSavingTo,
  SpaceNameError,
} from "../src/core/db/spaces.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { getSetting, setSetting } from "../src/core/db/settings.ts";
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

  it("freeSpaceName gives the base when nothing has it, then numbers it", () => {
    expect(freeSpaceName(db, "Shared space", null)).toBe("Shared space");
    createSpace(db, deps(), "Shared space");
    expect(freeSpaceName(db, "Shared space", null)).toBe("Shared space 2");
    createSpace(db, deps(), "Shared space 2");
    expect(freeSpaceName(db, "Shared space", null)).toBe("Shared space 3");
  });

  it("freeSpaceName ignores the space being renamed", () => {
    const space = createSpace(db, deps(), "Shared space");
    expect(freeSpaceName(db, "Shared space", space.id)).toBe("Shared space");
  });

  it("renameSpace changes the name and keeps the same space", () => {
    const space = createSpace(db, deps(), "Shared space");
    renameSpace(db, space.id, "  Family  ");
    expect(listSpaces(db).map((s) => s.name)).toEqual(["Family"]);
  });

  it("renameSpace throws taken for another space's name, but accepts its own", () => {
    ensureDefaultSpace(db, deps());
    const space = createSpace(db, deps(), "Biology");
    expect(nameError(() => renameSpace(db, space.id, "MY notes"))).toBe("taken");
    expect(nameError(() => renameSpace(db, space.id, "Biology"))).toBe("no error");
  });

  it("renameSpace throws empty for a blank name and keeps the old one", () => {
    const space = createSpace(db, deps(), "Biology");
    expect(nameError(() => renameSpace(db, space.id, "  "))).toBe("empty");
    expect(listSpaces(db).map((s) => s.name)).toEqual(["Biology"]);
  });

  it("renameSpace accepts a new case of its own name", () => {
    const space = createSpace(db, deps(), "biology");
    renameSpace(db, space.id, "Biology");
    expect(getSpace(db, space.id)?.name).toBe("Biology");
  });

  it("renameSpace throws too_long for a name over 60 characters", () => {
    const space = createSpace(db, deps(), "Biology");
    expect(nameError(() => renameSpace(db, space.id, "a".repeat(61)))).toBe("too_long");
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

  it("deleteSpace removes an empty private space", () => {
    ensureDefaultSpace(db, deps());
    const bio = createSpace(db, deps(), "Biology");
    deleteSpace(db, bio.id);
    expect(listSpaces(db).map((s) => s.name)).toEqual(["My notes"]);
  });

  it("deleteSpace throws for a space with sessions", () => {
    ensureDefaultSpace(db, deps());
    const bio = createSpace(db, deps(), "Biology");
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('a', ?, 'pages', 't', 'saved', 1)", [bio.id]);
    expect(() => deleteSpace(db, bio.id)).toThrow("sessions");
    expect(getSpace(db, bio.id)).not.toBeNull();
  });

  it("deleteSpace throws for the default space", () => {
    const home = ensureDefaultSpace(db, deps());
    expect(() => deleteSpace(db, home.id)).toThrow("default");
    expect(getSpace(db, home.id)).not.toBeNull();
  });

  it("deleteSpace throws for a space that syncs or is shared, even when empty", () => {
    ensureDefaultSpace(db, deps());
    const bio = createSpace(db, deps(), "Biology");
    db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES ('g1', 'personal', 'owner', 1, 0)");
    db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, 'g1')", [bio.id]);
    expect(() => deleteSpace(db, bio.id)).toThrow("synced or shared");
    expect(getSpace(db, bio.id)).not.toBeNull();
  });

  it("deleteSpace throws for a space that does not exist", () => {
    ensureDefaultSpace(db, deps());
    expect(() => deleteSpace(db, "nope")).toThrow("no such space");
  });

  it("deleteSpace moves Saving to back to the default space when it was the chosen one", () => {
    const home = ensureDefaultSpace(db, deps());
    const bio = createSpace(db, deps(), "Biology");
    setSavingTo(db, bio.id, 5000);
    deleteSpace(db, bio.id);
    expect(getSavingTo(db).id).toBe(home.id);
    expect(getSetting(db, "saving_to")).toBe(home.id);
  });

  it("deleteSpace leaves Saving to alone when another space was chosen", () => {
    ensureDefaultSpace(db, deps());
    const bio = createSpace(db, deps(), "Biology");
    const chem = createSpace(db, deps(), "Chem");
    setSavingTo(db, chem.id, 5000);
    deleteSpace(db, bio.id);
    expect(getSavingTo(db).id).toBe(chem.id);
  });
});
