import {
  ApproveDeviceRequestSchema,
  PairingNonceRequestSchema,
  type DeviceView,
  type PairingView,
} from "@waypoint/contracts";
import {
  decodePublicKey,
  deviceCertificateInput,
  fromBase64Url,
  pairingCommitment,
  PURPOSE_ACCOUNT_KEY,
  PURPOSE_GROUP_KEY,
  verifyP256,
} from "@waypoint/crypto";
import { Hono, type Context } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { checkEnvelope, isUniqueViolation } from "../keys/envelopes.ts";
import { sendPush } from "../push/messages.ts";
import type { Db } from "../storage.ts";
import { DEVICE_COLUMNS } from "./view.ts";

type Target = { id: string; sign_pub: string; box_pub: string; approved_at: number | null };
type PairingRow = { device_id: string; commitment: string; approver_id: string | null; approver_nonce: string | null; device_nonce: string | null; expires_at: number };

async function readJson<T>(c: Context<AppEnv>, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
  const body: unknown = await c.req.json().catch(() => {
    throw new ApiFailure("bad_request", "invalid request");
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
  return parsed.data;
}

// A device of this user that is waiting for approval, or 404.
async function waitingDevice(db: Db, userId: string, deviceId: string): Promise<Target> {
  const row = await db
    .prepare("SELECT id, sign_pub, box_pub, approved_at FROM devices WHERE id = ? AND user_id = ? AND kind = 'device' AND removed_at IS NULL")
    .bind(deviceId, userId)
    .first<Target>();
  if (row === null) throw new ApiFailure("not_found", "no such device");
  if (row.approved_at !== null) throw new ApiFailure("conflict", "device already approved");
  return row;
}

async function livePairing(db: Db, deviceId: string, now: number): Promise<PairingRow> {
  const row = await db
    .prepare("SELECT device_id, commitment, approver_id, approver_nonce, device_nonce, expires_at FROM device_pairings WHERE device_id = ?")
    .bind(deviceId)
    .first<PairingRow>();
  if (row === null) throw new ApiFailure("not_found", "no pairing for this device");
  if (row.expires_at <= now) throw new ApiFailure("conflict", "pairing expired");
  return row;
}

async function pairingView(db: Db, deviceId: string): Promise<PairingView> {
  const row = await db
    .prepare(
      "SELECT p.device_id, p.commitment, p.expires_at, p.approver_id, a.sign_pub AS approver_sign_pub, p.approver_nonce, p.device_nonce FROM device_pairings p LEFT JOIN devices a ON a.id = p.approver_id WHERE p.device_id = ?",
    )
    .bind(deviceId)
    .first<PairingRow & { approver_sign_pub: string | null }>();
  if (row === null) throw new ApiFailure("not_found", "no pairing for this device");
  return {
    device_id: row.device_id,
    commitment: row.commitment,
    expires_at: row.expires_at,
    approver: row.approver_id === null || row.approver_sign_pub === null ? null : { id: row.approver_id, sign_pub: row.approver_sign_pub },
    approver_nonce: row.approver_nonce,
    device_nonce: row.device_nonce,
  };
}

export function pairingRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .get("/v1/devices/:id/pairing", async (c) => {
      const db = c.env.DB;
      const device = await db
        .prepare("SELECT id FROM devices WHERE id = ? AND user_id = ? AND removed_at IS NULL")
        .bind(c.req.param("id"), c.get("user").id)
        .first<{ id: string }>();
      if (device === null) throw new ApiFailure("not_found", "no such device");
      return c.json(await pairingView(db, device.id));
    })
    .post("/v1/devices/:id/pairing", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const now = deps.now();
      const { nonce } = await readJson(c, PairingNonceRequestSchema);
      const target = await waitingDevice(db, c.get("user").id, c.req.param("id"));
      const approver = c.get("device");
      if (approver.id === target.id) throw new ApiFailure("forbidden", "a device cannot approve itself");
      await livePairing(db, target.id, now);
      const updated = await db
        .prepare("UPDATE device_pairings SET approver_id = ?, approver_nonce = ? WHERE device_id = ? AND approver_nonce IS NULL")
        .bind(approver.id, nonce, target.id)
        .run();
      if (updated.meta.changes !== 1) throw new ApiFailure("conflict", "pairing already started");
      return c.json(await pairingView(db, target.id));
    })
    .post("/v1/devices/:id/pairing/reveal", requireDeviceSignature(deps, { allowPending: true }), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const now = deps.now();
      const { nonce } = await readJson(c, PairingNonceRequestSchema);
      const target = await waitingDevice(db, c.get("user").id, c.req.param("id"));
      if (c.get("device").id !== target.id) throw new ApiFailure("forbidden", "only the new device can reveal");
      const pairing = await livePairing(db, target.id, now);
      if (pairing.approver_nonce === null) throw new ApiFailure("conflict", "no approver yet");
      if (pairing.device_nonce !== null) throw new ApiFailure("conflict", "already revealed");
      if ((await pairingCommitment(target.sign_pub, target.box_pub, nonce)) !== pairing.commitment) {
        // One try only: a wrong reveal ends the pairing; the new device must register again.
        await db.prepare("DELETE FROM device_pairings WHERE device_id = ?").bind(target.id).run();
        throw new ApiFailure("conflict", "nonce does not match the commitment");
      }
      const updated = await db
        .prepare("UPDATE device_pairings SET device_nonce = ? WHERE device_id = ? AND device_nonce IS NULL")
        .bind(nonce, target.id)
        .run();
      if (updated.meta.changes !== 1) throw new ApiFailure("conflict", "already revealed");
      return c.json(await pairingView(db, target.id));
    })
    .post("/v1/devices/:id/approve", requireDeviceSignature(deps, { allowAccount: true }), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const signer = c.get("device");
      const req = await readJson(c, ApproveDeviceRequestSchema);
      const target = await waitingDevice(db, user.id, c.req.param("id"));
      if (signer.kind === "device") {
        const pairing = await livePairing(db, target.id, now);
        if (pairing.approver_id !== signer.id || pairing.approver_nonce === null || pairing.device_nonce === null) {
          throw new ApiFailure("conflict", "pairing not finished");
        }
      }
      const account = await db
        .prepare("SELECT sign_pub FROM devices WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL")
        .bind(user.id)
        .first<{ sign_pub: string }>();
      if (account === null) throw new ApiFailure("conflict", "no account key yet");
      let certOk = false;
      try {
        certOk = await verifyP256(
          decodePublicKey(account.sign_pub),
          fromBase64Url(req.cert),
          deviceCertificateInput(user.id, target.id, target.sign_pub, target.box_pub),
        );
      } catch {
        certOk = false;
      }
      if (!certOk) throw new ApiFailure("bad_request", "invalid certificate");
      checkEnvelope(req.account_envelope, PURPOSE_ACCOUNT_KEY, signer.id);
      const seen = new Set<string>();
      for (const envelope of req.envelopes) {
        const pair = `${envelope.group_id}/${envelope.key_version}`;
        if (seen.has(pair)) throw new ApiFailure("bad_request", "invalid request");
        seen.add(pair);
        checkEnvelope(envelope.wrapped_key, PURPOSE_GROUP_KEY, signer.id);
        // Only groups the user is in, and only versions whose key already exists (first sets go through S2).
        const ok = await db
          .prepare(
            "SELECT 1 AS ok FROM groups g JOIN memberships m ON m.group_id = g.id AND m.user_id = ? AND m.left_at IS NULL WHERE g.id = ? AND ? <= g.key_version AND EXISTS (SELECT 1 FROM key_envelopes e WHERE e.group_id = g.id AND e.key_version = ?)",
          )
          .bind(user.id, envelope.group_id, envelope.key_version, envelope.key_version)
          .first<{ ok: number }>();
        if (ok === null) throw new ApiFailure("conflict", "unknown group or key version");
      }
      const statements = [
        db
          .prepare(
            "UPDATE devices SET approved_at = ?, approved_by = ?, can_approve = 1, cert = ?, account_envelope = ? WHERE id = ? AND approved_at IS NULL AND removed_at IS NULL",
          )
          .bind(now, signer.id, req.cert, req.account_envelope, target.id),
        // Only if the update above was this request's: another approval, or a removal, that landed first leaves no
        // envelopes behind.
        ...req.envelopes.map((e) =>
          db
            .prepare(
              "INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM devices WHERE id = ? AND approved_by = ? AND account_envelope = ? AND removed_at IS NULL)",
            )
            .bind(e.group_id, e.key_version, target.id, e.wrapped_key, target.id, signer.id, req.account_envelope),
        ),
        db.prepare("DELETE FROM device_pairings WHERE device_id = ?").bind(target.id),
      ];
      let results: { meta: { changes: number } }[];
      try {
        results = await db.batch(statements);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "device already has a key for this version");
        throw error;
      }
      if (results[0]?.meta.changes !== 1) throw new ApiFailure("conflict", "device already approved");
      // Tell the new device it was approved, so it fetches its keys (S1F).
      await sendPush(c.env.PUSH_QUEUE, { user_id: user.id, kind: "device_approved", ref: target.id, device_id: target.id });
      const device = await db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = ?`).bind(target.id).first<DeviceView>();
      return c.json({ device });
    });
}
