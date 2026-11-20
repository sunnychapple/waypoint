import { SYNC_DAILY_BYTES, SYNC_DAILY_LIMIT_MESSAGE } from "@waypoint/contracts";
import { ApiFailure } from "../errors.ts";
import type { Db } from "../storage.ts";

const DAY_MS = 86_400_000;

// The UTC day a time falls in: whole days since 1 January 1970. Each person's sync budget starts again at 00:00 UTC.
export function utcDay(now: number): number {
  return Math.floor(now / DAY_MS);
}

// Counts `bytes` (locked change bytes or shared-link data) against the person's budget for today: SYNC_DAILY_BYTES
// plus the extra bought for today (sync_extras). One statement checks and counts, so two requests at once cannot both
// pass the limit. Over it: nothing is counted, and 429 says how many seconds remain until 00:00 UTC.
export async function spendSyncBytes(db: Db, userId: string, bytes: number, now: number): Promise<void> {
  const day = utcDay(now);
  const counted = await db
    .prepare(
      `INSERT INTO sync_days (user_id, day, bytes) VALUES (?, ?, ?)
       ON CONFLICT (user_id, day) DO UPDATE SET bytes = sync_days.bytes + excluded.bytes
       WHERE sync_days.bytes + excluded.bytes <= ? +
         (SELECT COALESCE(SUM(e.bytes), 0) FROM sync_extras e WHERE e.user_id = sync_days.user_id AND e.day = sync_days.day)`,
    )
    .bind(userId, day, bytes, SYNC_DAILY_BYTES)
    .run();
  if (counted.meta.changes === 0) {
    throw new ApiFailure("rate_limited", SYNC_DAILY_LIMIT_MESSAGE, Math.ceil(((day + 1) * DAY_MS - now) / 1000));
  }
}
