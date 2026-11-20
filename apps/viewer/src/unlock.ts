// Opening a shared link in the browser with WebCrypto only (docs/security.md sections 4, 11 and 15). The same
// formats as packages/crypto, written again here so the page loads no other code; test/unlock.test.ts checks them
// against packages/crypto's published vectors and its lockContent.

// The link key from the URL fragment "#k=<base64url of 32 bytes>". The fragment never reaches the server.
export function keyFromFragment(hash: string): Uint8Array<ArrayBuffer> | null {
  const match = /^#k=([A-Za-z0-9_-]{43})$/.exec(hash);
  if (match === null) return null;
  const key = fromBase64Url(match[1] ?? "");
  return key !== null && key.length === 32 ? key : null;
}

// The link id from the path /l/<id> (PR 30's LinkIdSchema).
export function linkIdFromPath(path: string): string | null {
  return /^\/l\/([A-Za-z0-9_-]{22,64})$/.exec(path)?.[1] ?? null;
}

// Strict base64url without padding; null when the text is not the canonical encoding.
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  let back = "";
  for (const b of bytes) back += String.fromCharCode(b);
  return btoa(back).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === text ? bytes : null;
}

// context(label, f1, ...) = "waypoint/v1/" ‖ label ‖ 0x00 ‖ u16(len f1) ‖ f1 ‖ ... (docs/security.md section 4).
export function context(label: string, ...fields: string[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts = [enc.encode(`waypoint/v1/${label}`), new Uint8Array([0])];
  for (const field of fields) {
    const bytes = enc.encode(field);
    if (bytes.length > 0xffff) throw new RangeError("field too long");
    parts.push(new Uint8Array([bytes.length >> 8, bytes.length & 0xff]), bytes);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Imported so the key cannot be read back (extractable false). Call before any other script loads.
export function importLinkKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

// Locked content: u8 1 | u32 key version | nonce (12) | ciphertext ‖ tag; AAD = the 17 header bytes ‖ the context.
// null for anything that does not open (wrong key, another link's data, damage, a key version that is not 0).
export async function unlock(key: CryptoKey, objectContext: Uint8Array<ArrayBuffer>, locked: Uint8Array<ArrayBuffer>, keyVersion = 0): Promise<Uint8Array<ArrayBuffer> | null> {
  if (locked.length < 33 || locked[0] !== 1) return null;
  if (new DataView(locked.buffer, locked.byteOffset).getUint32(1, false) !== keyVersion) return null;
  const head = locked.slice(0, 17);
  const aad = new Uint8Array(17 + objectContext.length);
  aad.set(head, 0);
  aad.set(objectContext, 17);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: head.slice(5), additionalData: aad }, key, locked.slice(17)));
  } catch {
    return null;
  }
}
