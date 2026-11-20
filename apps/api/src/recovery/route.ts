import { PutRecoveryRequestSchema } from "@waypoint/contracts";
import { fromBase64Url, isRecoveryBlob } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";

type AccountRow = { id: string; sign_pub: string; box_pub: string };

export function recoveryRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .put("/v1/recovery", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const user = c.get("user");
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = PutRecoveryRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      let blobOk = false;
      try {
        blobOk = isRecoveryBlob(fromBase64Url(req.wrapped_account_key));
      } catch {
        blobOk = false;
      }
      if (!blobOk) throw new ApiFailure("bad_request", "invalid request");
      const account = await db
        .prepare("SELECT id FROM devices WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL")
        .bind(user.id)
        .first<{ id: string }>();
      if (account === null || account.id !== req.account_device_id) throw new ApiFailure("conflict", "not the current account key");
      const verifiedAt = req.verified ? deps.now() : null;
      // Stored only if that account row is still the active one when the write runs. A device removal that replaced
      // the account key in between deleted the old blob; this one would wrap a key nobody holds any more.
      const stored = await db
        .prepare(
          `INSERT INTO recovery (user_id, wrapped_account_key, verified_at)
           SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM devices WHERE id = ? AND user_id = ? AND kind = 'account' AND removed_at IS NULL)
           ON CONFLICT (user_id) DO UPDATE SET wrapped_account_key = excluded.wrapped_account_key, verified_at = excluded.verified_at`,
        )
        .bind(user.id, req.wrapped_account_key, verifiedAt, account.id, user.id)
        .run();
      if (stored.meta.changes !== 1) throw new ApiFailure("conflict", "not the current account key");
      return c.json({ account_device_id: account.id, verified_at: verifiedAt });
    })
    .get("/v1/recovery", async (c) => {
      const db = c.env.DB;
      const user = c.get("user");
      const row = await db
        .prepare(
          "SELECT d.id, d.sign_pub, d.box_pub, r.wrapped_account_key, r.verified_at FROM recovery r JOIN devices d ON d.user_id = r.user_id AND d.kind = 'account' AND d.removed_at IS NULL WHERE r.user_id = ?",
        )
        .bind(user.id)
        .first<AccountRow & { wrapped_account_key: string; verified_at: number | null }>();
      if (row === null) throw new ApiFailure("not_found", "no recovery key");
      return c.json({ account_device_id: row.id, sign_pub: row.sign_pub, box_pub: row.box_pub, wrapped_account_key: row.wrapped_account_key, verified_at: row.verified_at });
    });
}
