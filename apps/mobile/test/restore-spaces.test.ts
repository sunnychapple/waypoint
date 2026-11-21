import type { GroupView } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { markLeft, upsertGroup } from "../src/core/groups/groups.ts";
import { restoreGroupSpaces } from "../src/core/groups/restore.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { createSpace, listSpaces } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { applyChange, SyncChangeSchema } from "../src/core/sync/changes.ts";
import { createMemoryDb } from "./helpers/db.ts";

const ME = "usr_me";

const view = (id: string, over: Partial<GroupView> = {}): GroupView => ({
  id,
  kind: "personal",
  name_locked: "x",
  key_version: 1,
  created_by: ME,
  role: "owner",
  members: [{ user_id: ME, role: "owner", starts_at: 10, ends_at: null, history_from: 0 }],
  ...over,
});

let n = 0;
const deps = { now: () => 1_000, newId: () => `spc_${String(++n).padStart(16, "0")}` };

function fresh(): SqlDb {
  const db = createMemoryDb();
  migrate(db);
  return db;
}

// A group this iPhone knows by name (the key arrived), held or not.
function addGroup(db: SqlDb, id: string, name: string): void {
  upsertGroup(db, view(id), name, 5, ME);
}

const spaceNamed = (db: SqlDb, name: string) => listSpaces(db).find((s) => s.name === name);
const mappedSpace = (db: SqlDb, groupId: string): string | undefined =>
  db.get<{ space_id: string }>("SELECT space_id FROM space_groups WHERE group_id = ?", [groupId])?.space_id;
const dirtyCount = (db: SqlDb): number => db.get<{ n: number }>("SELECT count(*) AS n FROM dirty")?.n ?? 0;

describe("restoreGroupSpaces", () => {
  it("restores a group into a new space named after it", () => {
    const db = fresh();
    addGroup(db, "grp_bio", "Biology");
    expect(restoreGroupSpaces(db, deps, () => true)).toEqual(["grp_bio"]);
    const space = spaceNamed(db, "Biology");
    expect(space).toBeDefined();
    expect(mappedSpace(db, "grp_bio")).toBe(space?.id);
  });

  it("reuses an empty same-named space, folding case", () => {
    const db = fresh();
    createSpace(db, deps, "biology");
    const before = listSpaces(db).length;
    addGroup(db, "grp_bio", "Biology");
    expect(restoreGroupSpaces(db, deps, () => true)).toEqual(["grp_bio"]);
    expect(listSpaces(db).length).toBe(before);
    expect(mappedSpace(db, "grp_bio")).toBe(spaceNamed(db, "biology")?.id);
  });

  it("does not reuse a same-named space that has sessions", () => {
    const db = fresh();
    const busy = createSpace(db, deps, "Biology");
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('sess_1', ?, 'recording', 't', 'saved', 1)", [busy.id]);
    addGroup(db, "grp_bio", "Biology");
    restoreGroupSpaces(db, deps, () => true);
    expect(mappedSpace(db, "grp_bio")).not.toBe(busy.id);
    expect(spaceNamed(db, "Biology 2")?.id).toBe(mappedSpace(db, "grp_bio"));
  });

  it("skips a group with no key, no name, already mapped, or left", () => {
    const db = fresh();
    addGroup(db, "grp_nokey", "No key");
    addGroup(db, "grp_noname", "");
    addGroup(db, "grp_mapped", "Mapped");
    addGroup(db, "grp_left", "Left");
    const mapped = createSpace(db, deps, "Mapped");
    db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, 'grp_mapped')", [mapped.id]);
    markLeft(db, "grp_left", 6);
    const restored = restoreGroupSpaces(db, deps, (id) => id !== "grp_nokey");
    expect(restored).toEqual([]);
    expect(spaceNamed(db, "No key")).toBeUndefined();
    expect(spaceNamed(db, "Left")).toBeUndefined();
    expect(mappedSpace(db, "grp_mapped")).toBe(mapped.id);
  });

  it("writes nothing to dirty", () => {
    const db = fresh();
    addGroup(db, "grp_bio", "Biology");
    restoreGroupSpaces(db, deps, () => true);
    expect(dirtyCount(db)).toBe(0);
  });

  it("does nothing on a second run", () => {
    const db = fresh();
    addGroup(db, "grp_bio", "Biology");
    restoreGroupSpaces(db, deps, () => true);
    const spaces = listSpaces(db).length;
    expect(restoreGroupSpaces(db, deps, () => true)).toEqual([]);
    expect(listSpaces(db).length).toBe(spaces);
  });

  it("skips a name the space table refuses, and still restores the others", () => {
    const db = fresh();
    addGroup(db, "grp_long", "x".repeat(61));
    addGroup(db, "grp_bio", "Biology");
    expect(restoreGroupSpaces(db, deps, () => true)).toEqual(["grp_bio"]);
    expect(mappedSpace(db, "grp_long")).toBeUndefined();
  });

  it("lands a synced session of the group in the restored space", () => {
    const db = fresh();
    addGroup(db, "grp_bio", "Biology");
    restoreGroupSpaces(db, deps, () => true);
    const change = SyncChangeSchema.parse({
      v: 1,
      id: "chg_0000000000000001",
      at: 100,
      op: "upsert",
      table: "sessions",
      row: { id: "sess_remote_1", space_id: "not_here", kind: "recording", title: "Cells", state: "saved", transcript: "none", started_at: 100, ended_at: null, recorded_ms: 0 },
    });
    expect(applyChange(db, "grp_bio", change, "dev_other")).toBe("applied");
    expect(db.get<{ space_id: string }>("SELECT space_id FROM sessions WHERE id = 'sess_remote_1'")?.space_id).toBe(mappedSpace(db, "grp_bio"));
  });
});
