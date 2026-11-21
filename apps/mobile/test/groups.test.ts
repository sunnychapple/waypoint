import type { GroupView } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import {
  getGroup,
  heldVersions,
  listGroups,
  markLeft,
  noteKeyVersion,
  parseMembers,
  rememberSigner,
  splitSpaces,
  spaceGroups,
  trustedSigners,
  upsertGroup,
} from "../src/core/groups/groups.ts";
import { createMemoryDb } from "./helpers/db.ts";

const view = (over: Partial<GroupView> = {}): GroupView => ({
  id: "grp_1",
  kind: "shared",
  name_locked: "x",
  key_version: 1,
  created_by: "usr_me",
  role: "owner",
  members: [{ user_id: "usr_me", role: "owner", starts_at: 10, ends_at: null, history_from: 0 }],
  ...over,
});

function fresh() {
  const db = createMemoryDb();
  migrate(db);
  return db;
}

describe("upsertGroup", () => {
  it("inserts a group with its members, and an empty name while the key has not arrived", () => {
    const db = fresh();
    upsertGroup(db, view(), null, 5, "usr_me");
    const group = getGroup(db, "grp_1");
    expect(group?.name).toBe("");
    expect(group?.role).toBe("owner");
    expect(group?.keyVersion).toBe(1);
    expect(group?.members.map((m) => m.user_id)).toEqual(["usr_me"]);
  });

  it("keeps the stored name when the name is not known now, and replaces it when it is", () => {
    const db = fresh();
    upsertGroup(db, view(), "Trip", 5, "usr_me");
    upsertGroup(db, view({ key_version: 2 }), null, 6, "usr_me");
    expect(getGroup(db, "grp_1")).toMatchObject({ name: "Trip", keyVersion: 2 });
    upsertGroup(db, view({ key_version: 2 }), "Trip 2", 7, "usr_me");
    expect(getGroup(db, "grp_1")?.name).toBe("Trip 2");
  });

  it("brings a group back when it is listed again", () => {
    const db = fresh();
    upsertGroup(db, view(), "Trip", 5, "usr_me");
    markLeft(db, "grp_1", 6);
    expect(listGroups(db)).toEqual([]);
    upsertGroup(db, view(), "Trip", 7, "usr_me");
    expect(listGroups(db).map((g) => g.id)).toEqual(["grp_1"]);
  });
});

describe("listGroups, getGroup and markLeft", () => {
  it("lists only groups still joined, but getGroup still finds a group that was left", () => {
    const db = fresh();
    upsertGroup(db, view(), "Trip", 5, "usr_me");
    upsertGroup(db, view({ id: "grp_2", name_locked: "y" }), "Home", 5, "usr_me");
    markLeft(db, "grp_2", 9);
    expect(listGroups(db).map((g) => g.id)).toEqual(["grp_1"]);
    expect(getGroup(db, "grp_2")?.leftAt).toBe(9);
  });

  it("getGroup gives null for an unknown group, and markLeft on an unknown group changes nothing", () => {
    const db = fresh();
    expect(getGroup(db, "nope")).toBeNull();
    markLeft(db, "nope", 3);
    expect(listGroups(db)).toEqual([]);
  });
});

describe("noteKeyVersion and heldVersions", () => {
  it("keeps the first time a version was learned, and lists versions in order", () => {
    const db = fresh();
    upsertGroup(db, view(), "Trip", 5, "usr_me");
    noteKeyVersion(db, "grp_1", 2, 20);
    noteKeyVersion(db, "grp_1", 1, 10);
    noteKeyVersion(db, "grp_1", 2, 99);
    expect(heldVersions(db, "grp_1")).toEqual([
      { keyVersion: 1, learnedAt: 10 },
      { keyVersion: 2, learnedAt: 20 },
    ]);
  });

  it("refuses a version for a group that is not stored", () => {
    const db = fresh();
    expect(() => noteKeyVersion(db, "missing", 1, 1)).toThrow();
  });
});

describe("parseMembers", () => {
  it("reads a stored list of members", () => {
    const text = JSON.stringify([{ user_id: "usr_a", role: "editor", starts_at: 1, ends_at: 2, history_from: 0 }]);
    expect(parseMembers(text)).toEqual([{ user_id: "usr_a", role: "editor", starts_at: 1, ends_at: 2, history_from: 0 }]);
  });

  it("gives an empty list for text that is not JSON, or not a list", () => {
    expect(parseMembers("not json")).toEqual([]);
    expect(parseMembers('{"user_id":"usr_a"}')).toEqual([]);
  });

  it("drops entries that are not well-formed members", () => {
    const text = JSON.stringify([{ user_id: "usr_a", role: "boss", starts_at: 1, ends_at: null, history_from: 0 }, null, 4]);
    expect(parseMembers(text)).toEqual([]);
  });
});

describe("rememberSigner and trustedSigners", () => {
  const signer = { id: "dev_b", userId: "usr_b", signPub: "S".repeat(87), boxPub: "B".repeat(87), cert: "C".repeat(86) };

  it("keeps one row per device, updated when it is remembered again", () => {
    const db = fresh();
    rememberSigner(db, signer);
    rememberSigner(db, { ...signer, boxPub: "D".repeat(87) });
    expect(trustedSigners(db)).toEqual([{ ...signer, boxPub: "D".repeat(87) }]);
  });

  it("gives nothing before any signer is remembered", () => {
    expect(trustedSigners(fresh())).toEqual([]);
  });
});

describe("spaceGroups (M30b)", () => {
  it("maps each synced space to its group's kind and role, and leaves out groups that were left", () => {
    const db = fresh();
    db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('sp_a', 'A', 0, 0, 0), ('sp_b', 'B', 0, 0, 0), ('sp_c', 'C', 0, 0, 0)");
    upsertGroup(db, view({ id: "grp_shared_view_1", role: "viewer" }), "Book club", 1, "usr_me");
    upsertGroup(db, view({ id: "grp_personal_0001", kind: "personal" }), "Mine", 1, "usr_me");
    upsertGroup(db, view({ id: "grp_left_00000001" }), "Old", 1, "usr_me");
    db.run("INSERT INTO space_groups (space_id, group_id) VALUES ('sp_a', 'grp_shared_view_1'), ('sp_b', 'grp_personal_0001'), ('sp_c', 'grp_left_00000001')");
    markLeft(db, "grp_left_00000001", 2);
    expect([...spaceGroups(db)]).toEqual([
      ["sp_a", { groupId: "grp_shared_view_1", kind: "shared", role: "viewer" }],
      ["sp_b", { groupId: "grp_personal_0001", kind: "personal", role: "owner" }],
    ]);
  });
});

describe("splitSpaces", () => {
  it("puts a shared space only under shared, and keeps private and personal spaces under private", () => {
    const space = (id: string, name: string) => ({ id, name, isDefault: false, lastUsedAt: 0, sessionCount: 0 });
    const spaces = [space("sp_a", "A"), space("sp_b", "B"), space("sp_c", "C"), space("sp_d", "D")];
    const groups = new Map([
      ["sp_b", { groupId: "grp_1", kind: "shared" as const, role: "owner" as const }],
      ["sp_c", { groupId: "grp_2", kind: "personal" as const, role: "owner" as const }],
    ]);
    const { private: priv, shared } = splitSpaces(spaces, groups);
    expect(priv.map((s) => s.id)).toEqual(["sp_a", "sp_c", "sp_d"]);
    expect(shared.map((s) => s.id)).toEqual(["sp_b"]);
  });

  it("returns empty lists when there are no spaces", () => {
    expect(splitSpaces([], new Map())).toEqual({ private: [], shared: [] });
  });
});
