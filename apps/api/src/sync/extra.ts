import { IDEMPOTENCY_KEY_HEADER, SYNC_EXTRA_BYTES, SYNC_EXTRA_CREDITS, SyncExtraRequestSchema, type SyncExtraResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure, InsufficientCredits } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { sendUsage } from "../usage.ts";
import { readTaskBody } from "../tasks/instant.ts";
import { utcDay } from "./budget.ts";

// The hold lives one minute; the D1 write between the hold and the settle takes milliseconds.
const HOLD_MS = 60_000;
const NOT_COMPLETED = "purchase not completed, nothing was charged: try again with a new Idempotency-Key";

// POST /v1/sync/extra (open question 55): more sync for the rest of today (UTC), paid in credits. The wallet runs it
// like a task: hold the price, add the bytes, settle. If the bytes cannot be added, the hold is released and nothing is
// charged. Signed (it spends credits) and idempotent; the wallet ids come from the user id and the Idempotency-Key, and
// the bytes are one sync_extras row under that key, so a request that runs again (a settle that failed, a lost reply
// while the hold is still open) never adds them twice.
export function syncExtraRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>().post("/v1/sync/extra", requireDeviceSignature(deps), idempotent(deps), async (c) => {
    const user = c.get("user");
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER) ?? "";
    const request = await readTaskBody(c, SyncExtraRequestSchema);
    if (request.credits !== SYNC_EXTRA_CREDITS) throw new ApiFailure("conflict", "price changed");
    const now = deps.now();
    const holdId = `sync_extra:${user.id}:${key}`;
    const settleId = `sync_extra_settle:${user.id}:${key}`;
    const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
    const held = await wallet.apply({
      type: "hold",
      id: holdId,
      hold_id: holdId,
      user_id: user.id,
      task: "sync_extra",
      credits: SYNC_EXTRA_CREDITS,
      expires_at: now + HOLD_MS,
    });
    const settle = () => wallet.apply({ type: "settle", id: settleId, hold_id: holdId, actual: SYNC_EXTRA_CREDITS });
    // The charge did not happen, so the gigabyte must not stay: remove this key's row (best effort; the next run of the
    // same key removes it again) and answer 500, which is never stored. The same key cannot be paid again: the app
    // sends a new Idempotency-Key.
    const notCompleted = async (): Promise<never> => {
      await c.env.DB.prepare("DELETE FROM sync_extras WHERE user_id = ? AND key = ?").bind(user.id, key).run().catch(() => undefined);
      throw new ApiFailure("internal", NOT_COMPLETED);
    };
    if (!held.ok) {
      if ("shortfall" in held) throw new InsufficientCredits(held.shortfall);
      if (held.reason !== "hold_in_progress" && held.reason !== "hold_closed") throw new ApiFailure("internal", "something went wrong");
      const added = await c.env.DB.prepare("SELECT 1 AS found FROM sync_extras WHERE user_id = ? AND key = ?").bind(user.id, key).first<{ found: number }>();
      if (added === null) {
        // The first run is still going.
        if (held.reason === "hold_in_progress") throw new ApiFailure("conflict", "request in progress", 1);
        // The hold is closed and no bytes were added. A settle with the same id answers ok only if it was settled before.
        if ((await settle()).ok) throw new ApiFailure("conflict", "request already finished");
        throw new ApiFailure("internal", NOT_COMPLETED);
      }
      // This request ran before and added its bytes, but its settle failed (the hold is still open, or its alarm
      // released it, or it was settled and the reply was lost). Settling again is safe: the same settle id charges once.
    } else {
      try {
        await c.env.DB.prepare("INSERT INTO sync_extras (user_id, key, day, bytes) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO NOTHING")
          .bind(user.id, key, utcDay(now), SYNC_EXTRA_BYTES)
          .run();
      } catch (error) {
        // The write may or may not have landed: remove the row first, and release only when that worked, so the credits
        // never come back while the bytes stay. If the delete fails the hold stays open until its alarm.
        const removed = await c.env.DB.prepare("DELETE FROM sync_extras WHERE user_id = ? AND key = ?").bind(user.id, key).run().then(() => true, () => false);
        if (removed) await wallet.apply({ type: "release", id: `sync_extra_release:${user.id}:${key}`, hold_id: holdId }).catch(() => undefined);
        throw error;
      }
    }
    // A settle that answers not ok means the hold is gone without a charge (its alarm released it): no free gigabyte.
    if (!(await settle()).ok) return notCompleted();
    // One event so the purchase shows in Cloud activity. Its id is the hold id: a retry that settles again is written once.
    await sendUsage(c.env.USAGE_QUEUE, {
      v: 1,
      id: holdId,
      at: now,
      user_id: user.id,
      task: "sync_extra",
      outcome: "ok",
      credits: SYNC_EXTRA_CREDITS,
      tier: "light",
      model: "none",
      retention: user.zero_retention ? "zero" : "standard",
      router: "skipped",
      bytes_sent: 0,
      tokens_in: null,
      tokens_out: null,
    });
    // The reply is the total bought on the day of this key's own row, which is the day of the purchase, even for a retry
    // after midnight. It is only information: if the read fails, the charge and the bytes still stand.
    const total = await c.env.DB.prepare(
      "SELECT SUM(bytes) AS bytes FROM sync_extras WHERE user_id = ? AND day = (SELECT day FROM sync_extras WHERE user_id = ? AND key = ?)",
    )
      .bind(user.id, user.id, key)
      .first<{ bytes: number | null }>()
      .catch(() => null);
    const reply: SyncExtraResponse = { credits: SYNC_EXTRA_CREDITS, extra_bytes: total?.bytes ?? SYNC_EXTRA_BYTES };
    return c.json(reply);
  });
}
