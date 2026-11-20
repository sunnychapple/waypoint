import { IDEMPOTENCY_KEY_HEADER, SYNC_EXTRA_BYTES, SYNC_EXTRA_CREDITS, SyncExtraRequestSchema, type SyncExtraResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure, InsufficientCredits } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { readTaskBody } from "../tasks/instant.ts";
import { utcDay } from "./budget.ts";

// The hold lives one minute; the D1 write between the hold and the settle takes milliseconds.
const HOLD_MS = 60_000;

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
    if (!held.ok) {
      if ("shortfall" in held) throw new InsufficientCredits(held.shortfall);
      // This request ran before and added its bytes, but its settle failed while the hold stayed open: settle it now.
      const added = await c.env.DB.prepare("SELECT 1 AS found FROM sync_extras WHERE user_id = ? AND key = ?").bind(user.id, key).first<{ found: number }>();
      if (held.reason !== "hold_in_progress" || added === null) {
        if (held.reason === "hold_closed") throw new ApiFailure("conflict", "request already finished");
        if (held.reason === "hold_in_progress") throw new ApiFailure("conflict", "request in progress", 1);
        throw new ApiFailure("internal", "something went wrong");
      }
    }
    const day = utcDay(now);
    let row: { bytes: number } | null;
    try {
      await c.env.DB.prepare("INSERT INTO sync_extras (user_id, key, day, bytes) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO NOTHING")
        .bind(user.id, key, day, SYNC_EXTRA_BYTES)
        .run();
      row = await c.env.DB.prepare("SELECT SUM(bytes) AS bytes FROM sync_extras WHERE user_id = ? AND day = ?").bind(user.id, day).first<{ bytes: number }>();
    } catch (error) {
      await wallet.apply({ type: "release", id: `sync_extra_release:${user.id}:${key}`, hold_id: holdId }).catch(() => undefined);
      throw error;
    }
    await wallet.apply({ type: "settle", id: `sync_extra_settle:${user.id}:${key}`, hold_id: holdId, actual: SYNC_EXTRA_CREDITS });
    const reply: SyncExtraResponse = { credits: SYNC_EXTRA_CREDITS, extra_bytes: row?.bytes ?? SYNC_EXTRA_BYTES };
    return c.json(reply);
  });
}
