import { fromBase64Url, sha256, toHex } from "./bytes.ts";
import { context } from "./context.ts";
import { checkId } from "./ids.ts";

// Headers on a request signed by a device key (docs/security.md, "Request signatures").
export const DEVICE_HEADER = "Waypoint-Device";
export const TIMESTAMP_HEADER = "Waypoint-Timestamp";
export const NONCE_HEADER = "Waypoint-Nonce";
export const SIGNATURE_HEADER = "Waypoint-Signature";

// A signed request is accepted only if its timestamp is within this many ms of the server clock.
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
// The device id used while registering, before the server has given the device an id.
export const NEW_DEVICE = "new";

export type RequestToSign = {
  method: string; // upper case, e.g. "POST"
  target: string; // path and query exactly as sent, e.g. "/v1/devices/abc/approve"
  deviceId: string;
  timestamp: number; // Unix ms
  nonce: string; // base64url of 16 random bytes (22 characters)
  bodySha256: string; // lowercase hex SHA-256 of the body bytes (of zero bytes when there is no body)
};

export async function bodySha256(body: Uint8Array): Promise<string> {
  return toHex(await sha256(body));
}

export function requestSigningInput(request: RequestToSign): Uint8Array {
  if (!/^[A-Z]{3,7}$/.test(request.method)) throw new RangeError("bad method");
  if (!/^\/[\x21-\x7e]{0,2047}$/.test(request.target)) throw new RangeError("bad target");
  if (request.deviceId !== NEW_DEVICE) checkId(request.deviceId);
  if (!Number.isSafeInteger(request.timestamp) || request.timestamp < 0) throw new RangeError("bad timestamp");
  if (request.nonce.length !== 22 || fromBase64Url(request.nonce).length !== 16) throw new RangeError("bad nonce");
  if (!/^[0-9a-f]{64}$/.test(request.bodySha256)) throw new RangeError("bad body hash");
  return context(
    "request",
    request.method,
    request.target,
    request.deviceId,
    String(request.timestamp),
    request.nonce,
    request.bodySha256,
  );
}
