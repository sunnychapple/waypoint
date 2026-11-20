import { fromBase64Url } from "./bytes.ts";
import { context } from "./context.ts";
import { checkId } from "./ids.ts";
import { decodePublicKey, verifyP256 } from "./keys.ts";

// What the account key signs to vouch for one device (docs/security.md, "Device certificates").
export function deviceCertificateInput(userId: string, deviceId: string, signPub: string, boxPub: string): Uint8Array {
  decodePublicKey(signPub);
  decodePublicKey(boxPub);
  return context("device-cert", checkId(userId), checkId(deviceId), signPub, boxPub);
}

// What the account key signs to vouch for its own row: its id and both public keys, so nobody but the holder of the
// account signing key can pair that key with another encryption key (docs/security.md section 6, "Account certificate").
export function accountCertificateInput(userId: string, accountId: string, signPub: string, boxPub: string): Uint8Array {
  decodePublicKey(signPub);
  decodePublicKey(boxPub);
  return context("account-cert", checkId(userId), checkId(accountId), signPub, boxPub);
}

// True only if `cert` is the account signing key's (signPub) signature over accountCertificateInput. Any malformed
// input is false.
export async function verifyAccountCertificate(cert: string, userId: string, accountId: string, signPub: string, boxPub: string): Promise<boolean> {
  try {
    return await verifyP256(decodePublicKey(signPub), fromBase64Url(cert), accountCertificateInput(userId, accountId, signPub, boxPub));
  } catch {
    return false;
  }
}
