import type { GroupView } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";
import type { Space } from "../db/spaces.ts";

// The group rows this iPhone keeps (GET /v1/groups). Names are unlocked with the group key; "" until it arrives.
export type Role = GroupView["role"];
export type Member = GroupView["members"][number];
export type StoredGroup = {
  id: string;
  kind: "personal" | "shared";
  name: string;
  role: Role;
  keyVersion: number;
  createdBy: string | null;
  members: Member[];
  leftAt: number | null;
};

type GroupRow = {
  id: string;
  kind: "personal" | "shared";
  name: string;
  role: Role;
  key_version: number;
  created_by: string | null;
  members: string;
  left_at: number | null;
};

const toStored = (row: GroupRow): StoredGroup => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  role: row.role,
  keyVersion: row.key_version,
  createdBy: row.created_by,
  members: parseMembers(row.members),
  leftAt: row.left_at,
});

const SELECT_GROUP = "SELECT id, kind, name, role, key_version, created_by, members, left_at FROM groups";

// Stores a group as GET /v1/groups returned it. `name` is null when the key has not arrived: the stored name is then kept.
// `me` is this person's user id: their own membership gives the history and end date kept on the group row.
export function upsertGroup(db: SqlDb, view: GroupView, name: string | null, now: number, me: string): void {
  const mine = view.members.find((m) => m.user_id === me);
  db.run(
    `INSERT INTO groups (id, kind, name, role, key_version, created_by, history_from, ends_at, members, left_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT (id) DO UPDATE SET
       kind = excluded.kind,
       name = CASE WHEN ? THEN groups.name ELSE excluded.name END,
       role = excluded.role,
       key_version = excluded.key_version,
       created_by = excluded.created_by,
       history_from = excluded.history_from,
       ends_at = excluded.ends_at,
       members = excluded.members,
       left_at = NULL,
       updated_at = excluded.updated_at`,
    [
      view.id,
      view.kind,
      name ?? "",
      view.role,
      view.key_version,
      view.created_by,
      mine?.history_from ?? 0,
      mine?.ends_at ?? null,
      JSON.stringify(view.members),
      now,
      name === null ? 1 : 0,
    ],
  );
}

// Each synced space's group, with its kind and this person's role, by space id (M30b's move picker and menu).
export type SpaceGroup = { groupId: string; kind: "personal" | "shared"; role: Role };
export function spaceGroups(db: SqlDb): Map<string, SpaceGroup> {
  const rows = db.all<{ space_id: string; group_id: string; kind: "personal" | "shared"; role: Role }>(
    "SELECT sg.space_id, sg.group_id, g.kind, g.role FROM space_groups sg JOIN groups g ON g.id = sg.group_id WHERE g.left_at IS NULL",
  );
  return new Map(rows.map((r) => [r.space_id, { groupId: r.group_id, kind: r.kind, role: r.role }]));
}

// Splits the spaces into private ones and shared ones (a space mapped to a shared group), each in the order given.
// A shared space appears only in `shared`, so a list that shows both shows each space once.
export function splitSpaces(spaces: Space[], groups: Map<string, SpaceGroup>): { private: Space[]; shared: Space[] } {
  const isShared = (space: Space) => groups.get(space.id)?.kind === "shared";
  return { private: spaces.filter((space) => !isShared(space)), shared: spaces.filter(isShared) };
}

// Groups this person is still in, by name.
export function listGroups(db: SqlDb): StoredGroup[] {
  return db.all<GroupRow>(`${SELECT_GROUP} WHERE left_at IS NULL ORDER BY name, id`).map(toStored);
}

export function getGroup(db: SqlDb, id: string): StoredGroup | null {
  const row = db.get<GroupRow>(`${SELECT_GROUP} WHERE id = ?`, [id]);
  return row === null ? null : toStored(row);
}

// A group that GET /v1/groups no longer lists: this person left it or was removed. The local copy stays.
export function markLeft(db: SqlDb, id: string, now: number): void {
  db.run("UPDATE groups SET left_at = ?, updated_at = ? WHERE id = ? AND left_at IS NULL", [now, now, id]);
}

// A key version this iPhone holds, with when it learned it (the first time wins).
export function noteKeyVersion(db: SqlDb, groupId: string, version: number, now: number): void {
  db.run("INSERT OR IGNORE INTO key_versions (group_id, key_version, learned_at) VALUES (?, ?, ?)", [groupId, version, now]);
}

export function heldVersions(db: SqlDb, groupId: string): { keyVersion: number; learnedAt: number }[] {
  return db.all<{ keyVersion: number; learnedAt: number }>(
    "SELECT key_version AS keyVersion, learned_at AS learnedAt FROM key_versions WHERE group_id = ? ORDER BY key_version",
    [groupId],
  );
}

// The members as stored (JSON). Anything that is not a list of well-formed members is dropped.
export function parseMembers(text: string): Member[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  return Array.isArray(value) ? value.filter(isMember) : [];
}

function isMember(value: unknown): value is Member {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.user_id === "string" &&
    (m.role === "owner" || m.role === "editor" || m.role === "viewer") &&
    typeof m.starts_at === "number" &&
    (m.ends_at === null || typeof m.ends_at === "number") &&
    typeof m.history_from === "number"
  );
}

// A device whose certificate this iPhone verified once (docs/security.md section 6); used to open envelopes it signed
// after the device has gone from the group's device list.
export type TrustedSigner = { id: string; userId: string; signPub: string; boxPub: string; cert: string };

export function rememberSigner(db: SqlDb, s: TrustedSigner): void {
  db.run(
    `INSERT INTO trusted_signers (device_id, user_id, sign_pub, box_pub, cert) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (device_id) DO UPDATE SET user_id = excluded.user_id, sign_pub = excluded.sign_pub, box_pub = excluded.box_pub, cert = excluded.cert`,
    [s.id, s.userId, s.signPub, s.boxPub, s.cert],
  );
}

export function trustedSigners(db: SqlDb): TrustedSigner[] {
  return db.all<{ device_id: string; user_id: string; sign_pub: string; box_pub: string; cert: string }>(
    "SELECT device_id, user_id, sign_pub, box_pub, cert FROM trusted_signers",
  ).map((r) => ({ id: r.device_id, userId: r.user_id, signPub: r.sign_pub, boxPub: r.box_pub, cert: r.cert }));
}
