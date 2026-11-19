import { RegisterDeviceRequestSchema, type DeviceView } from "@waypoint/contracts";
import { decodePublicKey, deviceCertificateInput, fromBase64Url, importBoxKey, importVerifyKey, NEW_DEVICE, verifyP256 } from "@waypoint/crypto";
import { Hono } from "hono";
import { checkSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { DEVICE_COLUMNS } from "./view.ts";

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const MAX_WAITING_DEVICES = 3;

export function devicesRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .post("/v1/devices", idempotent(deps), async (c) => {
      const user = c.get("user");
      const db = c.env.DB;
      const now = deps.now();
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = RegisterDeviceRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      // "new" is the signature's stand-in id for an unregistered device (crypto NEW_DEVICE); no row may take it.
      if (req.id === NEW_DEVICE || req.account?.id === NEW_DEVICE) throw new ApiFailure("bad_request", "invalid request");
      // Both keys must be points on P-256; importing checks that.
      try {
        await importVerifyKey(decodePublicKey(req.sign_pub));
        await importBoxKey(decodePublicKey(req.box_pub));
        if (req.account !== undefined) {
          await importVerifyKey(decodePublicKey(req.account.sign_pub));
          await importBoxKey(decodePublicKey(req.account.box_pub));
        }
      } catch {
        throw new ApiFailure("bad_request", "invalid request");
      }
      await checkSignature(c, db, NEW_DEVICE, req.sign_pub, now);
      const account = await db
        .prepare("SELECT id FROM devices WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL")
        .bind(user.id)
        .first<{ id: string }>();
      const insertDevice =
        "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, kind, approved_at, approved_by, cert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      const statements = [];
      if (req.account !== undefined) {
        if (account !== null) throw new ApiFailure("conflict", "account key already set");
        let certOk = false;
        try {
          certOk = await verifyP256(
            decodePublicKey(req.account.sign_pub),
            fromBase64Url(req.account.cert),
            deviceCertificateInput(user.id, req.id, req.sign_pub, req.box_pub),
          );
        } catch {
          certOk = false;
        }
        if (!certOk || req.account.id === req.id) throw new ApiFailure("bad_request", "invalid certificate");
        statements.push(
          db.prepare(insertDevice).bind(req.account.id, user.id, "Account key", "account", req.account.sign_pub, req.account.box_pub, 1, now, "account", now, null, null),
          db.prepare(insertDevice).bind(req.id, user.id, req.name, req.platform, req.sign_pub, req.box_pub, 1, now, "device", now, req.account.id, req.account.cert),
        );
      } else {
        if (account === null) throw new ApiFailure("conflict", "no account key yet");
        const waiting = await db
          .prepare(
            "SELECT count(*) AS n FROM devices d JOIN device_pairings p ON p.device_id = d.id WHERE d.user_id = ? AND d.approved_at IS NULL AND d.removed_at IS NULL AND p.expires_at > ?",
          )
          .bind(user.id, now)
          .first<{ n: number }>();
        if ((waiting?.n ?? 0) >= MAX_WAITING_DEVICES) throw new ApiFailure("rate_limited", "too many devices waiting", 600);
        statements.push(
          db.prepare(insertDevice).bind(req.id, user.id, req.name, req.platform, req.sign_pub, req.box_pub, 0, now, "device", null, null, null),
          db.prepare("INSERT INTO device_pairings (device_id, commitment, expires_at) VALUES (?, ?, ?)").bind(req.id, req.commitment ?? "", now + PAIRING_TTL_MS),
        );
      }
      try {
        await db.batch(statements);
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) throw new ApiFailure("conflict", "device id taken");
        throw error;
      }
      const device = await db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = ?`).bind(req.id).first<DeviceView>();
      return c.json({ device }, 201);
    })
    .get("/v1/devices", async (c) => {
      const rows = await c.env.DB.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = ? AND removed_at IS NULL ORDER BY added_at, id`)
        .bind(c.get("user").id)
        .all<DeviceView>();
      return c.json({ user_id: c.get("user").id, devices: rows.results });
    });
}
