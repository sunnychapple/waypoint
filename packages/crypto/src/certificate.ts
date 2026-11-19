import { context } from "./context.ts";
import { checkId } from "./ids.ts";
import { decodePublicKey } from "./keys.ts";

// What the account key signs to vouch for one device (docs/security.md, "Device certificates").
export function deviceCertificateInput(userId: string, deviceId: string, signPub: string, boxPub: string): Uint8Array {
  decodePublicKey(signPub);
  decodePublicKey(boxPub);
  return context("device-cert", checkId(userId), checkId(deviceId), signPub, boxPub);
}
