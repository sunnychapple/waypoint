import { PURPOSE_GROUP_KEY } from "@waypoint/crypto";
import { ApiFailure } from "../errors.ts";
import type { BatchDb, Db } from "../storage.ts";
import { checkEnvelope, isUniqueViolation } from "./envelopes.ts";

// The devices that must hold a group's current key: approved, not removed devices and the active account key
// row of every current member (docs/security.md, "Group keys").
export const TARGETS_SQL = `
  SELECT d.id, d.user_id, d.kind, d.sign_pub, d.box_pub, d.cert, m.role
  FROM memberships m
  JOIN devices d ON d.user_id = m.user_id
  WHERE m.group_id = ? AND m.left_at IS NULL AND d.removed_at IS NULL AND d.approved_at IS NOT NULL
  ORDER BY d.user_id, d.kind, d.id`;

export type TargetRow = { id: string; user_id: string; kind: "device" | "account"; sign_pub: string; box_pub: string; cert: string | null; role: string };

export async function currentMember(db: Db, groupId: string, userId: string): Promise<{ key_version: number } | null> {
  return db
    .prepare("SELECT g.key_version FROM groups g JOIN memberships m ON m.group_id = g.id WHERE g.id = ? AND m.user_id = ? AND m.left_at IS NULL")
    .bind(groupId, userId)
    .first<{ key_version: number }>();
}

export async function storeGroupKeys(
  db: BatchDb,
  input: { groupId: string; userId: string; signerId: string; keyVersion: number; envelopes: { device_id: string; wrapped_key: string }[] },
): Promise<{ first: boolean }> {
  const group = await currentMember(db, input.groupId, input.userId);
  if (group === null) throw new ApiFailure("not_found", "no such group");
  if (input.keyVersion > group.key_version) throw new ApiFailure("conflict", "unknown key version");
  const ids = input.envelopes.map((e) => e.device_id);
  if (new Set(ids).size !== ids.length) throw new ApiFailure("bad_request", "invalid request");
  for (const envelope of input.envelopes) checkEnvelope(envelope.wrapped_key, PURPOSE_GROUP_KEY, input.signerId);

  const targets = (await db.prepare(TARGETS_SQL).bind(input.groupId).all<TargetRow>()).results;
  const targetIds = new Set(targets.map((t) => t.id));
  if (ids.some((id) => !targetIds.has(id))) throw new ApiFailure("conflict", "not a device of a current member");

  const existing = await db
    .prepare("SELECT count(*) AS n FROM key_envelopes WHERE group_id = ? AND key_version = ?")
    .bind(input.groupId, input.keyVersion)
    .first<{ n: number }>();
  const first = (existing?.n ?? 0) === 0;
  if (first) {
    // The first envelopes for a version decide the key: they must be for the current version and cover every
    // target, so two devices rotating at once always collide on at least one row and only one key wins.
    if (input.keyVersion !== group.key_version) throw new ApiFailure("conflict", "unknown key version");
    if (ids.length !== targetIds.size) throw new ApiFailure("conflict", "envelopes must cover every device");
  }
  const insert = "INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) VALUES (?, ?, ?, ?)";
  try {
    await db.batch(input.envelopes.map((e) => db.prepare(insert).bind(input.groupId, input.keyVersion, e.device_id, e.wrapped_key)));
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiFailure("conflict", "a device already has a key for this version");
    throw error;
  }
  return { first };
}
