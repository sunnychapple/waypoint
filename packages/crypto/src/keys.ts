import { fromBase64Url } from "./bytes.ts";

// Public keys travel as base64url of the 65-byte SEC1 uncompressed point (0x04 || X || Y): CryptoKit's
// x963Representation and WebCrypto's "raw" format for P-256.
export const P256_PUBLIC_KEY_BYTES = 65;
export const P256_SIGNATURE_BYTES = 64;

export function decodePublicKey(text: string): Uint8Array {
  const bytes = fromBase64Url(text);
  if (bytes.length !== P256_PUBLIC_KEY_BYTES || bytes[0] !== 0x04) throw new RangeError("not a P-256 public key");
  return bytes;
}

// Import fails (throws) if the point is not on the curve.
export async function importVerifyKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

export async function importBoxKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

// ECDSA P-256 with SHA-256; the signature is r || s, 32 bytes each (CryptoKit's rawRepresentation).
export async function verifyP256(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  if (signature.length !== P256_SIGNATURE_BYTES) return false;
  let key: CryptoKey;
  try {
    key = await importVerifyKey(publicKey);
  } catch {
    return false;
  }
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, message);
}
