import { concat } from "./bytes.ts";

// Locked content: changes, snapshots, media, group names and shared-link data (docs/security.md, "Content").
//   u8 version (1) | u32 key version (big-endian; 0 for link data) | nonce (12) | AES-256-GCM ciphertext and tag
// AAD = the 17 header bytes, then the object's context (for example context("change", group, device, kind)).
export const CONTENT_VERSION = 1;
const HEADER_BYTES = 17;

function header(keyVersion: number, nonce: Uint8Array): Uint8Array {
  if (!Number.isInteger(keyVersion) || keyVersion < 0 || keyVersion > 0xffffffff) throw new RangeError("bad key version");
  if (nonce.length !== 12) throw new RangeError("bad nonce");
  const out = new Uint8Array(HEADER_BYTES);
  out[0] = CONTENT_VERSION;
  new DataView(out.buffer).setUint32(1, keyVersion, false);
  out.set(nonce, 5);
  return out;
}

export async function importContentKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new RangeError("bad content key");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function lockContent(key: CryptoKey, keyVersion: number, objectContext: Uint8Array, plaintext: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
  const head = header(keyVersion, nonce);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: concat(head, objectContext) }, key, plaintext);
  return concat(head, new Uint8Array(ct));
}

export function contentKeyVersion(locked: Uint8Array): number {
  if (locked.length < HEADER_BYTES + 16 || locked[0] !== CONTENT_VERSION) throw new RangeError("bad locked content");
  return new DataView(locked.buffer, locked.byteOffset).getUint32(1, false);
}

export async function unlockContent(key: CryptoKey, objectContext: Uint8Array, locked: Uint8Array): Promise<Uint8Array> {
  contentKeyVersion(locked);
  const head = locked.slice(0, HEADER_BYTES);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: head.slice(5), additionalData: concat(head, objectContext) },
    key,
    locked.slice(HEADER_BYTES),
  );
  return new Uint8Array(pt);
}
