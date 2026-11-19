import { describe, expect, it } from "vitest";
import { readVectors } from "./helpers/vectors.ts";
import { fromHex, toHex } from "../src/bytes.ts";
import { HPKE_SUITE, hpkeOpen, hpkeSeal } from "../src/hpke.ts";

type Rfc9180Vector = {
  info: string; ikmR: string; ikmE: string; skRm: string; pkRm: string; enc: string;
  encryptions: { aad: string; ct: string; pt: string }[];
};
const vector = readVectors<Rfc9180Vector>("rfc9180-p256-sha256-aes256gcm-base.json");
const first = vector.encryptions[0]!;

describe("hpke against RFC 9180 (DHKEM P-256, HKDF-SHA256, AES-256-GCM, base mode)", () => {
  it("seal with the vector's ephemeral key gives the vector's enc and ciphertext", async () => {
    const sealed = await hpkeSeal(fromHex(vector.pkRm), fromHex(vector.info), fromHex(first.aad), fromHex(first.pt), fromHex(vector.ikmE));
    expect(toHex(sealed.enc)).toBe(vector.enc);
    expect(toHex(sealed.ct)).toBe(first.ct);
  });

  it("the recipient key derived from ikmR opens the vector's ciphertext", async () => {
    const pair = await HPKE_SUITE.kem.deriveKeyPair(fromHex(vector.ikmR));
    expect(toHex(new Uint8Array(await HPKE_SUITE.kem.serializePublicKey(pair.publicKey)))).toBe(vector.pkRm);
    expect(toHex(new Uint8Array(await HPKE_SUITE.kem.serializePrivateKey(pair.privateKey)))).toBe(vector.skRm);
    const pt = await hpkeOpen(pair.privateKey, fromHex(vector.enc), fromHex(vector.info), fromHex(first.aad), fromHex(first.ct));
    expect(toHex(pt)).toBe(first.pt);
  });

  it("a random seal opens, and fails with another info, aad or a changed byte", async () => {
    const pair = await HPKE_SUITE.kem.generateKeyPair();
    const pub = new Uint8Array(await HPKE_SUITE.kem.serializePublicKey(pair.publicKey));
    const info = new Uint8Array([1, 2]);
    const aad = new Uint8Array([3]);
    const { enc, ct } = await hpkeSeal(pub, info, aad, new Uint8Array([9, 9, 9]));
    expect(Array.from(await hpkeOpen(pair.privateKey, enc, info, aad, ct))).toEqual([9, 9, 9]);
    await expect(hpkeOpen(pair.privateKey, enc, new Uint8Array([1, 3]), aad, ct)).rejects.toThrow();
    await expect(hpkeOpen(pair.privateKey, enc, info, new Uint8Array([4]), ct)).rejects.toThrow();
    const bad = ct.slice();
    bad[0] = (bad[0] ?? 0) ^ 1;
    await expect(hpkeOpen(pair.privateKey, enc, info, aad, bad)).rejects.toThrow();
  });
});
