import { concat } from "./bytes.ts";
import { context } from "./context.ts";
import { checkId } from "./ids.ts";

// The 12-word recovery key (docs/security.md, "Recovery key"): 16 bytes of entropy shown as BIP-39 English words.
// The words are turned into entropy on the device; this package starts from the 16 bytes.
//   blob = u8 version (1) | nonce (12) | AES-256-GCM(account key, 64 bytes) with its 16-byte tag  = 93 bytes
export const RECOVERY_ENTROPY_BYTES = 16;
export const RECOVERY_VERSION = 1;
export const RECOVERY_BLOB_BYTES = 1 + 12 + 64 + 16;

export async function recoveryWrapKey(entropy: Uint8Array, userId: string): Promise<CryptoKey> {
  if (entropy.length !== RECOVERY_ENTROPY_BYTES) throw new RangeError("bad recovery entropy");
  const ikm = await crypto.subtle.importKey("raw", entropy, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: context("recovery-key", checkId(userId)) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function recoveryAad(userId: string, accountDeviceId: string): Uint8Array {
  return concat(new Uint8Array([RECOVERY_VERSION]), context("recovery", checkId(userId), checkId(accountDeviceId)));
}

// What the server checks before storing a blob. It cannot check more: it never has the words.
export function isRecoveryBlob(bytes: Uint8Array): boolean {
  return bytes.length === RECOVERY_BLOB_BYTES && bytes[0] === RECOVERY_VERSION;
}

export async function wrapAccountKey(input: {
  wrapKey: CryptoKey;
  userId: string;
  accountDeviceId: string;
  accountKey: Uint8Array;
  nonce: Uint8Array;
}): Promise<Uint8Array> {
  if (input.accountKey.length !== 64 || input.nonce.length !== 12) throw new RangeError("bad input");
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: input.nonce, additionalData: recoveryAad(input.userId, input.accountDeviceId) },
    input.wrapKey,
    input.accountKey,
  );
  return concat(new Uint8Array([RECOVERY_VERSION]), input.nonce, new Uint8Array(ct));
}

export async function unwrapAccountKey(blob: Uint8Array, wrapKey: CryptoKey, userId: string, accountDeviceId: string): Promise<Uint8Array> {
  if (!isRecoveryBlob(blob)) throw new RangeError("bad recovery blob");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.slice(1, 13), additionalData: recoveryAad(userId, accountDeviceId) },
    wrapKey,
    blob.slice(13),
  );
  return new Uint8Array(pt);
}
