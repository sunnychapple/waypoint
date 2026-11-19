import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { importBoxKey } from "./keys.ts";

// RFC 9180 base mode, DHKEM(P-256, HKDF-SHA256) 0x0010, HKDF-SHA256 0x0001, AES-256-GCM 0x0002.
// CryptoKit: HPKE.Ciphersuite.P256_SHA256_AES_GCM_256 (iOS 17).
export const HPKE_SUITE = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

export const HPKE_ENC_BYTES = 65;

// ekm is for test vectors only: the ephemeral key's input keying material (RFC 9180 ikmE).
export async function hpkeSeal(
  recipientPublicKey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
  ekm?: Uint8Array,
): Promise<{ enc: Uint8Array; ct: Uint8Array }> {
  const params = { recipientPublicKey: await importBoxKey(recipientPublicKey), info };
  const sealed = await HPKE_SUITE.seal(ekm === undefined ? params : { ...params, ekm }, plaintext, aad);
  return { enc: new Uint8Array(sealed.enc), ct: new Uint8Array(sealed.ct) };
}

export async function hpkeOpen(
  recipientKey: CryptoKey,
  enc: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  ct: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(await HPKE_SUITE.open({ recipientKey, enc, info }, ct, aad));
}
