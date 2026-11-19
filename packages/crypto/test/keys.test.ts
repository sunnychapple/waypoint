import { describe, expect, it } from "vitest";
import { readVectors } from "./helpers/vectors.ts";
import { fromHex, toBase64Url } from "../src/bytes.ts";
import { decodePublicKey, verifyP256 } from "../src/keys.ts";

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
