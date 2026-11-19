import {
  bodySha256,
  decodePublicKey,
  DEVICE_HEADER,
  fromBase64Url,
  NONCE_HEADER,
  requestSigningInput,
  SIGNATURE_HEADER,
  SIGNATURE_WINDOW_MS,
  TIMESTAMP_HEADER,
  verifyP256,
} from "@waypoint/crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import type { Db } from "../storage.ts";

// The device (or account key row) that signed the request. Set by requireDeviceSignature.
export type SignedDevice = { id: string; user_id: string; kind: "device" | "account"; approved: boolean };

export type SignatureOptions = {
  // Let a device that is still waiting for approval through (only its own pairing reveal).
  allowPending?: boolean;
  // Let the account key's row sign (only POST /v1/devices/:id/approve, for recovery).
  allowAccount?: boolean;
};

type DeviceRow = { id: string; user_id: string; kind: "device" | "account"; sign_pub: string; approved_at: number | null; removed_at: number | null };

const failure = (): ApiFailure => new ApiFailure("unauthorized", "device signature required");

// Checks the Waypoint-* headers against signPub and records the nonce. Every failure is the same 401.
// Used by requireDeviceSignature and, with deviceId "new", by POST /v1/devices.
export async function checkSignature(c: Context<AppEnv>, db: Db, deviceId: string, signPub: string, now: number): Promise<void> {
  const timestampText = c.req.header(TIMESTAMP_HEADER) ?? "";
  const nonce = c.req.header(NONCE_HEADER) ?? "";
  const signatureText = c.req.header(SIGNATURE_HEADER) ?? "";
  if (!/^\d{1,16}$/.test(timestampText)) throw failure();
  const timestamp = Number(timestampText);
  if (Math.abs(now - timestamp) > SIGNATURE_WINDOW_MS) throw failure();
  const { pathname, search } = new URL(c.req.url);
  let ok = false;
  try {
    const input = requestSigningInput({
      method: c.req.method,
      target: pathname + search,
      deviceId,
      timestamp,
      nonce,
      bodySha256: await bodySha256(new Uint8Array(await c.req.arrayBuffer())),
    });
    ok = await verifyP256(decodePublicKey(signPub), fromBase64Url(signatureText), input);
  } catch {
    ok = false;
  }
  if (!ok) throw failure();
  // Only after a good signature, so nobody can use up another device's nonces.
  await db.prepare("DELETE FROM request_nonces WHERE device_id = ? AND expires_at < ?").bind(deviceId, now).run();
  const inserted = await db
    .prepare("INSERT INTO request_nonces (device_id, nonce, expires_at) VALUES (?, ?, ?) ON CONFLICT (device_id, nonce) DO NOTHING")
    .bind(deviceId, nonce, timestamp + SIGNATURE_WINDOW_MS)
    .run();
  if (inserted.meta.changes !== 1) throw failure();
}

export function requireDeviceSignature(deps: { now: () => number }, options: SignatureOptions = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const deviceId = c.req.header(DEVICE_HEADER) ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) throw failure();
    const row = await c.env.DB.prepare(
      "SELECT id, user_id, kind, sign_pub, approved_at, removed_at FROM devices WHERE id = ?",
    )
      .bind(deviceId)
      .first<DeviceRow>();
    const user = c.get("user");
    if (row === null || row.user_id !== user.id || row.removed_at !== null) throw failure();
    if (row.kind === "account" && options.allowAccount !== true) throw failure();
    if (row.approved_at === null && options.allowPending !== true) throw failure();
    await checkSignature(c, c.env.DB, row.id, row.sign_pub, deps.now());
    c.set("device", { id: row.id, user_id: row.user_id, kind: row.kind, approved: row.approved_at !== null });
    await next();
  };
}
