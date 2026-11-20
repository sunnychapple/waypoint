import { RemoveDeviceRequestSchema } from "@waypoint/contracts";
import { decodePublicKey, deviceCertificateInput, fromBase64Url, importBoxKey, importVerifyKey, PURPOSE_ACCOUNT_KEY, verifyP256 } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { checkEnvelope, isUniqueViolation } from "../keys/envelopes.ts";
import type { BatchDb, DbStatement } from "../storage.ts";

type Row = { id: string; sign_pub: string; box_pub: string; approved_at: number | null };

// Every group the user is in gets a new key version (docs/security.md, sections 10 and 12).
export const BUMP_USER_GROUPS_SQL =
  "UPDATE groups SET key_version = key_version + 1 WHERE id IN (SELECT group_id FROM memberships WHERE user_id = ? AND left_at IS NULL)";

// The batch applies only if nothing changed since the reads above: the target is still live, and the user's other
// live, approved devices are exactly the ones the caller covered (docs/security.md, section 12). Every statement of
// the batch carries it, because a D1 batch cannot stop half way. Nothing in the batch changes what it reads except
// marking the target removed, which runs last, so that statement's change count says whether the batch applied.
export const UNCHANGED_SQL = `EXISTS (SELECT 1 FROM devices WHERE id = ? AND removed_at IS NULL)
    AND (SELECT count(*) FROM devices WHERE user_id = ? AND kind = 'device' AND removed_at IS NULL AND approved_at IS NOT NULL AND id != ?) = ?
    AND (SELECT count(*) FROM devices WHERE user_id = ? AND kind = 'device' AND removed_at IS NULL AND approved_at IS NOT NULL
         AND id IN (SELECT value FROM json_each(?))) = ?`;

export function removeDeviceRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>().delete("/v1/devices/:id", requireDeviceSignature(deps), idempotent(deps), async (c) => {
    const db: BatchDb = c.env.DB;
    const now = deps.now();
    const user = c.get("user");
    const caller = c.get("device");
    const text = await c.req.text();
    let body: unknown = {};
    try {
      body = text === "" ? {} : JSON.parse(text);
    } catch {
      throw new ApiFailure("bad_request", "invalid request");
    }
    const parsed = RemoveDeviceRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
    const req = parsed.data;

    const target = await db
      .prepare("SELECT id, sign_pub, box_pub, approved_at FROM devices WHERE id = ? AND user_id = ? AND kind = 'device' AND removed_at IS NULL")
      .bind(c.req.param("id"), user.id)
      .first<Row>();
    if (target === null) throw new ApiFailure("not_found", "no such device");

    const markRemoved = db.prepare("UPDATE devices SET removed_at = ? WHERE id = ?").bind(now, target.id);
    const dropPairing = db.prepare("DELETE FROM device_pairings WHERE device_id = ?").bind(target.id);
    // A removed device gets no more pushes (S1F).
    const dropPushToken = db.prepare("DELETE FROM push_tokens WHERE user_id = ? AND device_id = ?").bind(user.id, target.id);

    if (target.approved_at === null) {
      if ("account" in req) throw new ApiFailure("bad_request", "invalid request");
      await db.batch([markRemoved, dropPairing, dropPushToken]);
      return c.json({ removed: target.id, account_id: null });
    }

    const remaining = (
      await db
        .prepare(
          "SELECT id, sign_pub, box_pub, approved_at FROM devices WHERE user_id = ? AND kind = 'device' AND removed_at IS NULL AND approved_at IS NOT NULL AND id != ? ORDER BY id",
        )
        .bind(user.id, target.id)
        .all<Row>()
    ).results;
    const unchanged = [target.id, user.id, target.id, remaining.length, user.id, JSON.stringify(remaining.map((d) => d.id)), remaining.length];
    const guarded = (sql: string, ...values: unknown[]) => db.prepare(`${sql} AND ${UNCHANGED_SQL}`).bind(...values, ...unchanged);
    const bump = guarded(BUMP_USER_GROUPS_SQL, user.id);
    const dropPushTokenIfUnchanged = guarded("DELETE FROM push_tokens WHERE user_id = ? AND device_id = ?", user.id, target.id);
    // Always the last statement of the batch.
    const markRemovedIfUnchanged = guarded("UPDATE devices SET removed_at = ? WHERE id = ?", now, target.id);
    const applyIfUnchanged = async (statements: DbStatement[]): Promise<void> => {
      const results = await db.batch(statements);
      if (results.at(-1)?.meta.changes !== 1) throw new ApiFailure("conflict", "devices changed, try again");
    };

    if (remaining.length === 0) {
      // The last device removing itself: nobody would hold a new account key, so nothing is rotated.
      if ("account" in req) throw new ApiFailure("bad_request", "invalid request");
      await applyIfUnchanged([bump, dropPushTokenIfUnchanged, markRemovedIfUnchanged]);
      return c.json({ removed: target.id, account_id: null });
    }

    if (!("account" in req)) throw new ApiFailure("bad_request", "new account key required");
    const sent = new Map(req.devices.map((d) => [d.id, d]));
    if (sent.size !== req.devices.length || sent.size !== remaining.length || remaining.some((d) => !sent.has(d.id))) {
      throw new ApiFailure("conflict", "certificates must cover every remaining device");
    }
    let newSignPub: Uint8Array;
    try {
      newSignPub = decodePublicKey(req.account.sign_pub);
      await importVerifyKey(newSignPub);
      await importBoxKey(decodePublicKey(req.account.box_pub));
    } catch {
      throw new ApiFailure("bad_request", "invalid request");
    }
    const updates = [];
    for (const device of remaining) {
      const entry = sent.get(device.id);
      if (entry === undefined) throw new ApiFailure("conflict", "certificates must cover every remaining device");
      let certOk = false;
      try {
        certOk = await verifyP256(newSignPub, fromBase64Url(entry.cert), deviceCertificateInput(user.id, device.id, device.sign_pub, device.box_pub));
      } catch {
        certOk = false;
      }
      if (!certOk) throw new ApiFailure("bad_request", "invalid certificate");
      checkEnvelope(entry.account_envelope, PURPOSE_ACCOUNT_KEY, caller.id);
      updates.push(guarded("UPDATE devices SET cert = ?, account_envelope = ? WHERE id = ?", entry.cert, entry.account_envelope, device.id));
    }
    const statements = [
      guarded("UPDATE devices SET removed_at = ? WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL", now, user.id),
      db
        .prepare(
          `INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, kind, approved_at, approved_by)
             SELECT ?, ?, 'Account key', 'account', ?, ?, 1, ?, 'account', ?, ? WHERE ${UNCHANGED_SQL}`,
        )
        .bind(req.account.id, user.id, req.account.sign_pub, req.account.box_pub, now, now, caller.id, ...unchanged),
      ...updates,
      bump,
      guarded("DELETE FROM recovery WHERE user_id = ?", user.id),
      dropPushTokenIfUnchanged,
      markRemovedIfUnchanged,
    ];
    try {
      await applyIfUnchanged(statements);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiFailure("conflict", "account key id taken");
      throw error;
    }
    return c.json({ removed: target.id, account_id: req.account.id });
  });
}
