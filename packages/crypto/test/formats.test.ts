import { describe, expect, it } from "vitest";
import {
  concat, fromBase64Url, groupKeyInfo, HPKE_SUITE, isRecoveryBlob, makeEnvelope, MAX_RESULT_BYTES, openResult, pairingCode,
  pairingCommitment, parseEnvelope, requestSigningInput, sealResult, toBase64Url,
} from "../src/index.ts";
import { readVectors } from "./helpers/vectors.ts";

const v = readVectors<{ request: Parameters<typeof requestSigningInput>[0]; pairing: Record<string, string>; group_key_envelope: { envelope: string } }>("waypoint-v1.json");

describe("requestSigningInput rejects bad parts", () => {
  const good = { method: v.request.method, target: v.request.target, deviceId: v.request.deviceId, timestamp: v.request.timestamp, nonce: v.request.nonce, bodySha256: v.request.bodySha256 };
  it("accepts the vector and the 'new' device id", () => {
    expect(() => requestSigningInput(good)).not.toThrow();
    expect(() => requestSigningInput({ ...good, deviceId: "new" })).not.toThrow();
  });
  const cases: [string, Partial<typeof good>][] = [
    ["lowercase method", { method: "post" }],
    ["target without slash", { target: "v1/x" }],
    ["target with a space", { target: "/v1/x y" }],
    ["target with a newline", { target: "/v1/x\n" }],
    ["device id with a slash", { deviceId: "a/b" }],
    ["negative timestamp", { timestamp: -1 }],
    ["fractional timestamp", { timestamp: 1.5 }],
    ["15-byte nonce", { nonce: toBase64Url(new Uint8Array(15)) }],
    ["uppercase body hash", { bodySha256: "A".repeat(64) }],
    ["short body hash", { bodySha256: "a".repeat(63) }],
  ];
  for (const [name, change] of cases) {
    it(name, () => {
      expect(() => requestSigningInput({ ...good, ...change })).toThrow(RangeError);
    });
  }
});

describe("pairing", () => {
  it("rejects nonces that are not 32 bytes and keys that are not P-256 points", async () => {
    const p = v.pairing;
    await expect(pairingCommitment(p.new_sign_pub!, p.new_box_pub!, toBase64Url(new Uint8Array(31)))).rejects.toThrow(RangeError);
    await expect(pairingCommitment("AAAA", p.new_box_pub!, p.new_nonce!)).rejects.toThrow(RangeError);
    await expect(pairingCode({ newSignPub: p.new_sign_pub!, newBoxPub: p.new_box_pub!, approverSignPub: p.approver_sign_pub!, approverNonce: "AAAA", newNonce: p.new_nonce! })).rejects.toThrow(RangeError);
  });

  it("codes are always 6 digits", async () => {
    const p = v.pairing;
    for (let i = 0; i < 50; i++) {
      const nonce = new Uint8Array(32);
      nonce[0] = i;
      const code = await pairingCode({ newSignPub: p.new_sign_pub!, newBoxPub: p.new_box_pub!, approverSignPub: p.approver_sign_pub!, approverNonce: toBase64Url(nonce), newNonce: p.new_nonce! });
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("parseEnvelope rejects bad shapes", () => {
  const good = fromBase64Url(v.group_key_envelope.envelope);
  const with_ = (at: number, value: number): Uint8Array => {
    const copy = good.slice();
    copy[at] = value;
    return copy;
  };
  it("accepts the vector", () => {
    expect(parseEnvelope(good).signerId).toBe("dev_phone");
  });
  const cases: [string, Uint8Array][] = [
    ["empty", new Uint8Array(0)],
    ["version 2", with_(0, 2)],
    ["purpose 3", with_(1, 3)],
    ["purpose 2 with a group key's length", with_(1, 2)],
    ["compressed enc", with_(2, 2)],
    ["ct length 49", with_(68, 49)],
    ["one byte short", good.slice(0, good.length - 1)],
    ["one byte long", concat(good, new Uint8Array([0]))],
    ["signer length 0", with_(2 + 65 + 2 + 48, 0)],
    ["signer id with a space", with_(2 + 65 + 2 + 48 + 1, 0x20)],
  ];
  for (const [name, bytes] of cases) {
    it(name, () => {
      expect(() => parseEnvelope(bytes)).toThrow(RangeError);
    });
  }
  it("makeEnvelope refuses a key of the wrong length and a 63-byte signature", async () => {
    const pair = await HPKE_SUITE.kem.generateKeyPair();
    const pub = new Uint8Array(await HPKE_SUITE.kem.serializePublicKey(pair.publicKey));
    const base = { purpose: 1 as const, info: groupKeyInfo("g", 1, "d"), recipientBoxPub: pub, signerId: "s" };
    await expect(makeEnvelope({ ...base, key: new Uint8Array(31), sign: async () => new Uint8Array(64) })).rejects.toThrow(RangeError);
    await expect(makeEnvelope({ ...base, key: new Uint8Array(32), sign: async () => new Uint8Array(63) })).rejects.toThrow(RangeError);
  });
  it("groupKeyInfo rejects key version 0", () => {
    expect(() => groupKeyInfo("g", 0, "d")).toThrow(RangeError);
  });
});

describe("sealed results", () => {
  it("a random seal opens only for the same job and device", async () => {
    const pair = await HPKE_SUITE.kem.generateKeyPair();
    const pub = new Uint8Array(await HPKE_SUITE.kem.serializePublicKey(pair.publicKey));
    const sealed = await sealResult({ jobId: "job_1", deviceId: "dev_1", deviceBoxPub: pub, plaintext: new Uint8Array([1, 2, 3]) });
    expect(sealed.length).toBe(2 + 65 + 3 + 16);
    expect(Array.from(await openResult(sealed, "job_1", "dev_1", pair.privateKey))).toEqual([1, 2, 3]);
    await expect(openResult(sealed, "job_1", "dev_2", pair.privateKey)).rejects.toThrow();
    await expect(openResult(sealed.slice(0, 70), "job_1", "dev_1", pair.privateKey)).rejects.toThrow(RangeError);
  });
  it("refuses results over 4 MiB and bad ids", async () => {
    const pair = await HPKE_SUITE.kem.generateKeyPair();
    const pub = new Uint8Array(await HPKE_SUITE.kem.serializePublicKey(pair.publicKey));
    await expect(sealResult({ jobId: "job_1", deviceId: "dev_1", deviceBoxPub: pub, plaintext: new Uint8Array(MAX_RESULT_BYTES + 1) })).rejects.toThrow(RangeError);
    await expect(sealResult({ jobId: "job 1", deviceId: "dev_1", deviceBoxPub: pub, plaintext: new Uint8Array(1) })).rejects.toThrow(RangeError);
  });
});

describe("isRecoveryBlob", () => {
  it("is true only for 93 bytes starting with 1", () => {
    const blob = new Uint8Array(93);
    blob[0] = 1;
    expect(isRecoveryBlob(blob)).toBe(true);
    expect(isRecoveryBlob(blob.slice(0, 92))).toBe(false);
    expect(isRecoveryBlob(concat(blob, new Uint8Array(1)))).toBe(false);
    blob[0] = 2;
    expect(isRecoveryBlob(blob)).toBe(false);
  });
});
