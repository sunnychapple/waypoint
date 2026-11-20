import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import type { BatchDb, DbStatement } from "../storage.ts";
import { activeMembership } from "./membership.ts";

// docs/cards/security.md: PR 27 bumps a group's key version with this, in the same batch that ends a membership. The
// changes() guard (review fix list) bumps only when the membership update just before it changed a row.
export const BUMP_GROUP_SQL = "UPDATE groups SET key_version = key_version + 1 WHERE id = ? AND changes() > 0";

// The statements that end userId's membership at `at`: the row gets left_at, the group a new key version, and open
// invites the user made are withdrawn. Run them in one db.batch. With `selected`, the row is ended only if it is still
// the one that was selected: same start, and its end date has passed by `endsBy`.
export function endMembershipStatements(
  db: BatchDb,
  groupId: string,
  userId: string,
  at: number,
  selected?: { startsAt: number; endsBy: number },
): DbStatement[] {
  const exact = selected === undefined ? "" : " AND starts_at = ? AND ends_at <= ?";
  const exactValues = selected === undefined ? [] : [selected.startsAt, selected.endsBy];
  return [
    db
      .prepare(`UPDATE memberships SET left_at = ? WHERE group_id = ? AND user_id = ? AND left_at IS NULL${exact}`)
      .bind(at, groupId, userId, ...exactValues),
    db.prepare(BUMP_GROUP_SQL).bind(groupId),
    db.prepare("DELETE FROM invites WHERE group_id = ? AND created_by = ? AND accepted_by IS NULL").bind(groupId, userId),
  ];
}

export function memberRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>().delete("/v1/groups/:id/members/:user", requireDeviceSignature(deps), idempotent(deps), async (c) => {
    const db: BatchDb = c.env.DB;
    const now = deps.now();
    const caller = c.get("user");
    const groupId = c.req.param("id");
    const targetId = c.req.param("user");
    const mine = await activeMembership(db, groupId, caller.id, now);
    if (mine === null) throw new ApiFailure("not_found", "no such group");
    if (targetId !== caller.id && mine.role !== "owner") throw new ApiFailure("forbidden", "only an owner can remove members");
    const target = targetId === caller.id ? mine : await activeMembership(db, groupId, targetId, now);
    if (target === null) throw new ApiFailure("not_found", "no such member");
    if (target.role === "owner") {
      const owners = await db
        .prepare("SELECT count(*) AS n FROM memberships WHERE group_id = ? AND role = 'owner' AND left_at IS NULL AND (ends_at IS NULL OR ends_at > ?)")
        .bind(groupId, now)
        .first<{ n: number }>();
      if ((owners?.n ?? 0) <= 1) throw new ApiFailure("conflict", "a group needs an owner");
    }
    try {
      await db.batch(endMembershipStatements(db, groupId, targetId, now));
    // Close the member's open sockets. The membership has already ended, so a failure here changes nothing.
    try {
      await c.env.GROUP_ROOM.get(c.env.GROUP_ROOM.idFromName(groupId)).disconnect(targetId);
    } catch {
      // ignored
    }
    } catch (err) {
      // The trigger memberships_keep_an_owner refuses ending the last owner when two owners leave at once.
      if (err instanceof Error && err.message.includes("last owner")) throw new ApiFailure("conflict", "a group needs an owner");
      throw err;
    }
    const group = await db.prepare("SELECT key_version FROM groups WHERE id = ?").bind(groupId).first<{ key_version: number }>();
    if (group === null) throw new ApiFailure("not_found", "no such group");
    return c.json({ group_id: groupId, user_id: targetId, key_version: group.key_version });
  });
}
