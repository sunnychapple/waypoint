import { describe, expect, it } from "vitest";
import { readVectors } from "./helpers/vectors.ts";
import { fromHex, toBase64Url } from "../src/bytes.ts";
import { decodePublicKey, importBoxKey, importVerifyKey, verifyP256 } from "../src/keys.ts";

type WycheproofFile = {
  testGroups: { publicKey: { uncompressed: string }; sha: string; tests: { tcId: number; msg: string; sig: string; result: "valid" | "invalid" | "acceptable" }[] }[];
};
const wycheproof = readVectors<WycheproofFile>("wycheproof-ecdsa-secp256r1-sha256-p1363.json");

describe("verifyP256 against Wycheproof ecdsa_secp256r1_sha256_p1363", () => {
  it("accepts every valid signature and rejects every invalid one", async () => {
    let checked = 0;
    for (const group of wycheproof.testGroups) {
      expect(group.sha).toBe("SHA-256");
      const pub = fromHex(group.publicKey.uncompressed);
      for (const test of group.tests) {
        const ok = await verifyP256(pub, fromHex(test.sig), fromHex(test.msg));
        if (test.result === "valid") expect(ok, `tcId ${test.tcId}`).toBe(true);
        if (test.result === "invalid") expect(ok, `tcId ${test.tcId}`).toBe(false);
        checked++;
      }
    }
    expect(checked).toBe(262);
  });
});

describe("decodePublicKey", () => {
  it("takes 65 bytes starting with 0x04 and rejects other shapes", () => {
    const good = new Uint8Array(65);
    good[0] = 4;
    expect(decodePublicKey(toBase64Url(good))).toEqual(good);
    expect(() => decodePublicKey(toBase64Url(good.slice(0, 64)))).toThrow(RangeError);
    const compressed = good.slice(0, 33);
    compressed[0] = 2;
    expect(() => decodePublicKey(toBase64Url(compressed))).toThrow(RangeError);
    expect(() => decodePublicKey(toBase64Url(good) + "=")).toThrow(RangeError);
  });

  it("verifyP256 returns false for a point that is not on the curve", async () => {
    const offCurve = new Uint8Array(65);
    offCurve[0] = 4;
    offCurve[64] = 1;
    expect(await verifyP256(offCurve, new Uint8Array(64), new Uint8Array(1))).toBe(false);
  });
});

// The first Wycheproof key and its first valid signature, with the key in its three encodings: uncompressed (0x04),
// compressed (0x02/0x03) and hybrid (0x06/0x07).
function wycheproofKey() {
  const group = wycheproof.testGroups[0];
  const valid = group?.tests.find((t) => t.result === "valid");
  if (group === undefined || valid === undefined) throw new Error("vector file has no valid case");
  const uncompressed = fromHex(group.publicKey.uncompressed);
  const odd = (uncompressed[64] ?? 0) & 1;
  const compressed = new Uint8Array(33);
  compressed[0] = 2 + odd;
  compressed.set(uncompressed.subarray(1, 33), 1);
  const hybrid = uncompressed.slice();
  hybrid[0] = 6 + odd;
  return { uncompressed, compressed, hybrid, sig: fromHex(valid.sig), msg: fromHex(valid.msg) };
}

describe("public key shape", () => {
  it("decodePublicKey rejects 65 bytes that start with 0x02", () => {
    const wrongPrefix = new Uint8Array(65);
    wrongPrefix[0] = 2;
    expect(() => decodePublicKey(toBase64Url(wrongPrefix))).toThrow(RangeError);
  });

  it("importVerifyKey and importBoxKey take the uncompressed form and refuse the compressed and hybrid forms of the same key", async () => {
    const key = wycheproofKey();
    await expect(importVerifyKey(key.uncompressed)).resolves.toBeDefined();
    await expect(importBoxKey(key.uncompressed)).resolves.toBeDefined();
    for (const raw of [key.compressed, key.hybrid]) {
      await expect(importVerifyKey(raw)).rejects.toThrow(RangeError);
      await expect(importBoxKey(raw)).rejects.toThrow(RangeError);
    }
  });

  it("verifyP256 accepts a valid signature under the uncompressed key and returns false under its hybrid form", async () => {
    const key = wycheproofKey();
    expect(await verifyP256(key.uncompressed, key.sig, key.msg)).toBe(true);
    expect(await verifyP256(key.hybrid, key.sig, key.msg)).toBe(false);
  });
});
