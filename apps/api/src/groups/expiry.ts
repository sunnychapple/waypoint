import type { BatchDb } from "../storage.ts";
import { endMembershipStatements } from "./members.ts";

// At most this many memberships are ended per hourly run; the rest wait for the next run.
export const MAX_EXPIRED_PER_RUN = 500;

// Ends memberships whose end date has passed (an invite "until a date"): left_at = ends_at and a new key version,
// one batch per membership, as a removal does. Returns how many were ended.
export async function endExpiredMemberships(db: BatchDb, now: number): Promise<number> {
  const { results } = await db
    .prepare("SELECT group_id, user_id, ends_at FROM memberships WHERE left_at IS NULL AND ends_at IS NOT NULL AND ends_at <= ? ORDER BY ends_at LIMIT ?")
    .bind(now, MAX_EXPIRED_PER_RUN)
    .all<{ group_id: string; user_id: string; ends_at: number }>();
  for (const row of results) {
    await db.batch(endMembershipStatements(db, row.group_id, row.user_id, row.ends_at));
  }
  return results.length;
}
