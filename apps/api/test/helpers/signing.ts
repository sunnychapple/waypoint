import {
  bodySha256,
  DEVICE_HEADER,
  HPKE_SUITE,
  NONCE_HEADER,
  requestSigningInput,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  toBase64Url,
  utf8,
} from "@waypoint/crypto";
import type { Db } from "../../src/storage.ts";

// A device with software keys, standing in for the iPhone's Secure Enclave keys.
export type TestDevice = {
  id: string;
  signPub: string;
  boxPub: string;
  boxPrivate: CryptoKey;
  sign(message: Uint8Array): Promise<Uint8Array>;
};

export async function makeTestDevice(id: string): Promise<TestDevice> {
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  if (!("privateKey" in signing)) throw new Error("expected a key pair");
  const box = await HPKE_SUITE.kem.generateKeyPair();
  const signPub = new Uint8Array((await crypto.subtle.exportKey("raw", signing.publicKey)) as ArrayBuffer);
  const boxPub = new Uint8Array(await HPKE_SUITE.kem.serializePublicKey(box.publicKey));
  return {
    id,
    signPub: toBase64Url(signPub),
    boxPub: toBase64Url(boxPub),
    boxPrivate: box.privateKey,
    sign: async (message) =>
      new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signing.privateKey, message)),
  };
}

let nonceCounter = 0;
export function freshNonce(): string {
  nonceCounter += 1;
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(12, nonceCounter);
  return toBase64Url(bytes);
}

// Builds a signed request. `as` overrides the Waypoint-Device header (for example "new" when registering).
export async function signedInit(
  device: TestDevice,
  request: { method: string; path: string; body?: unknown; now: number; nonce?: string; as?: string; idempotencyKey?: string },
): Promise<RequestInit> {
  const bodyText = request.body === undefined ? "" : JSON.stringify(request.body);
  const nonce = request.nonce ?? freshNonce();
  const deviceId = request.as ?? device.id;
  const input = requestSigningInput({
    method: request.method,
    target: request.path,
    deviceId,
    timestamp: request.now,
    nonce,
    bodySha256: await bodySha256(utf8(bodyText)),
  });
  const headers: Record<string, string> = {
    [DEVICE_HEADER]: deviceId,
    [TIMESTAMP_HEADER]: String(request.now),
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: toBase64Url(await device.sign(input)),
    "Idempotency-Key": request.idempotencyKey ?? `idem-${nonce}`,
  };
  if (bodyText !== "") headers["Content-Type"] = "application/json";
  return bodyText === "" ? { method: request.method, headers } : { method: request.method, headers, body: bodyText };
}

// Inserts a device row directly. approvedAt null makes it pending.
export async function insertDevice(
  db: Db,
  device: TestDevice,
  row: { userId: string; kind?: "device" | "account"; approvedAt?: number | null; removedAt?: number | null; cert?: string | null },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, removed_at, kind, approved_at, cert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      device.id,
      row.userId,
      row.kind === "account" ? "Account key" : "Test phone",
      row.kind === "account" ? "account" : "ios",
      device.signPub,
      device.boxPub,
      row.approvedAt === null ? 0 : 1,
      1,
      row.removedAt ?? null,
      row.kind ?? "device",
      row.approvedAt === undefined ? 1 : row.approvedAt,
      row.cert ?? null,
    )
    .run();
}
