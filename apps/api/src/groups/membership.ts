import type { GroupView } from "@waypoint/contracts";
import type { Db } from "../storage.ts";

export type Role = "owner" | "editor" | "viewer";

// A membership counts from the moment it is accepted until it is ended (left_at) or its end date passes.
// The hourly cron (PR 27 Part B) sets left_at for passed end dates and bumps the key version; until it runs,
// this check already refuses the member.
export type Membership = { kind: "personal" | "shared"; key_version: number; role: Role; history_from: number; ends_at: number | null };

export async function activeMembership(db: Db, groupId: string, userId: string, now: number): Promise<Membership | null> {
  return db
    .prepare(
      `SELECT g.kind, g.key_version, m.role, m.history_from, m.ends_at
       FROM groups g JOIN memberships m ON m.group_id = g.id
       WHERE g.id = ? AND m.user_id = ? AND m.left_at IS NULL AND (m.ends_at IS NULL OR m.ends_at > ?)`,
    )
    .bind(groupId, userId, now)
    .first<Membership>();
}

type GroupRow = { id: string; kind: "personal" | "shared"; name_locked: string; key_version: number; created_by: string | null; role: Role };
type MemberRow = { group_id: string; user_id: string; role: Role; starts_at: number; ends_at: number | null; history_from: number };

const ACTIVE = "m.left_at IS NULL AND (m.ends_at IS NULL OR m.ends_at > ?)";

// The groups userId is an active member of, each with its active members, in id order. With groupId, only that group.
export async function groupViews(db: Db, userId: string, now: number, groupId: string | null = null): Promise<GroupView[]> {
  const only = groupId === null ? "" : " AND g.id = ?";
  const values: unknown[] = groupId === null ? [userId, now] : [userId, now, groupId];
  const groups = (
    await db
      .prepare(
        `SELECT g.id, g.kind, g.name_locked, g.key_version, g.created_by, m.role
         FROM groups g JOIN memberships m ON m.group_id = g.id
         WHERE m.user_id = ? AND ${ACTIVE}${only} ORDER BY g.id`,
      )
      .bind(...values)
      .all<GroupRow>()
  ).results;
  if (groups.length === 0) return [];
  const members = (
    await db
      .prepare(
        `SELECT m.group_id, m.user_id, m.role, m.starts_at, m.ends_at, m.history_from
         FROM memberships m
         WHERE ${ACTIVE} AND m.group_id IN (SELECT m2.group_id FROM memberships m2 WHERE m2.user_id = ? AND m2.left_at IS NULL)
         ORDER BY m.group_id, m.starts_at, m.user_id`,
      )
      .bind(now, userId)
      .all<MemberRow>()
  ).results;
  return groups.map((g) => ({
    ...g,
    members: members
      .filter((m) => m.group_id === g.id)
      .map(({ user_id, role, starts_at, ends_at, history_from }) => ({ user_id, role, starts_at, ends_at, history_from })),
  }));
}
