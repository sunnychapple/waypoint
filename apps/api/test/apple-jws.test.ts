import { beforeAll, describe, expect, test } from "vitest";
import { APPLE_ROOT_CA_G3_SHA256, AppleJwsError, verifyAppleJws } from "../src/apple/jws.ts";
import { ecdsaDerToRaw, isSignedBy, parseCertificate, X509Error, type Certificate } from "../src/apple/x509.ts";
import {
  CHAIN_FROM,
  CHAIN_TO,
  ecKey,
  INTERMEDIATE_MARKER,
  LEAF_MARKER,
  makeChain,
  signJws,
  toBase64Url,
  type TestChain,
} from "./helpers/apple.ts";

const payload = { transactionId: "2000000000000001", signedDate: Date.UTC(2026, 10, 19) };

async function expectInvalid(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(AppleJwsError);
  await expect(promise).rejects.toHaveProperty("message", "invalid signed data");
}

let chain: TestChain;
let leaf: Certificate;
let intermediate: Certificate;
let root: Certificate;

beforeAll(async () => {
  chain = await makeChain();
  leaf = parseCertificate(chain.leaf);
  intermediate = parseCertificate(chain.intermediate);
  root = parseCertificate(chain.root);
});

describe("parseCertificate, isSignedBy, ecdsaDerToRaw", () => {
  test("the test leaf reads back its curve, CA flag, marker and validity", () => {
    expect(leaf.curve).toBe("P-256");
    expect(leaf.isCA).toBe(false);
    expect(leaf.extensions.has(LEAF_MARKER)).toBe(true);
    expect(leaf.notBefore).toBe(CHAIN_FROM);
    expect(leaf.notAfter).toBe(CHAIN_TO);
  });

  test("the test root is a P-384 CA and the test intermediate is a CA with its marker", () => {
    expect(root.curve).toBe("P-384");
    expect(root.isCA).toBe(true);
    expect(intermediate.isCA).toBe(true);
    expect(intermediate.extensions.has(INTERMEDIATE_MARKER)).toBe(true);
  });

  test("a GeneralizedTime notAfter reads back the exact value", async () => {
    const notAfter = Date.UTC(2060, 5, 1, 12, 30, 15);
    const far = await makeChain({ leaf: { notAfter } });
    expect(parseCertificate(far.leaf).notAfter).toBe(notAfter);
  });

  test("a certificate with one extra byte at the end throws X509Error", () => {
    expect(() => parseCertificate(new Uint8Array([...chain.leaf, 0]))).toThrow(X509Error);
  });

  test("a certificate with its last byte cut off throws X509Error", () => {
    expect(() => parseCertificate(chain.leaf.slice(0, -1))).toThrow(X509Error);
  });

  test("short or empty input throws X509Error", () => {
    expect(() => parseCertificate(new Uint8Array([1, 2, 3]))).toThrow(X509Error);
    expect(() => parseCertificate(new Uint8Array(0))).toThrow(X509Error);
  });

  test("ecdsaDerToRaw pads each integer to the size, and throws when one is too long", () => {
    const sig = Uint8Array.from([0x30, 0x08, 0x02, 0x02, 0x00, 0x80, 0x02, 0x02, 0x01, 0x02]);
    expect(Array.from(ecdsaDerToRaw(sig, 4))).toEqual([0, 0, 0, 0x80, 0, 0, 1, 2]);
    expect(() => ecdsaDerToRaw(sig, 1)).toThrow(X509Error);
  });

  test("isSignedBy is true for intermediate under root and root under itself, false for leaf under root", async () => {
    expect(await isSignedBy(intermediate, root)).toBe(true);
    expect(await isSignedBy(root, root)).toBe(true);
    expect(await isSignedBy(leaf, root)).toBe(false);
  });
});

describe("verifyAppleJws", () => {
  test("a good JWS returns the payload that was signed", async () => {
    const jws = await signJws(payload, chain);
    expect(await verifyAppleJws(jws, chain.rootSha256)).toEqual(payload);
  });

  test("APPLE_ROOT_CA_G3_SHA256 is the pinned fingerprint, and a JWS from the test chain is rejected against it", async () => {
    expect(APPLE_ROOT_CA_G3_SHA256).toBe("63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179");
    const jws = await signJws(payload, chain);
    await expectInvalid(verifyAppleJws(jws, APPLE_ROOT_CA_G3_SHA256));
  });

  test("a leaf signed by a key other than the intermediate's is rejected", async () => {
    const bad = await makeChain({ leaf: { signer: (await ecKey("P-384")).privateKey } });
    await expectInvalid(verifyAppleJws(await signJws(payload, bad), bad.rootSha256));
  });

  test("a leaf without the leaf marker is rejected", async () => {
    const bad = await makeChain({ leaf: { markers: [] } });
    await expectInvalid(verifyAppleJws(await signJws(payload, bad), bad.rootSha256));
  });

  test("an intermediate without the intermediate marker is rejected", async () => {
    const bad = await makeChain({ intermediate: { markers: [] } });
    await expectInvalid(verifyAppleJws(await signJws(payload, bad), bad.rootSha256));
  });

  test("an intermediate with ca false is rejected", async () => {
    const bad = await makeChain({ intermediate: { ca: false } });
    await expectInvalid(verifyAppleJws(await signJws(payload, bad), bad.rootSha256));
  });

  test("an x5c whose root is another chain's root is rejected against that other root's fingerprint", async () => {
    const other = await makeChain();
    const jws = await signJws(payload, chain, {
      header: { alg: "ES256", x5c: [chain.x5c[0], chain.x5c[1], other.x5c[2]] },
    });
    await expectInvalid(verifyAppleJws(jws, other.rootSha256));
  });

  test("signedDate 1 ms after CHAIN_TO and 1 ms before CHAIN_FROM are rejected; exactly CHAIN_TO is accepted", async () => {
    await expectInvalid(verifyAppleJws(await signJws({ ...payload, signedDate: CHAIN_TO + 1 }, chain), chain.rootSha256));
    await expectInvalid(verifyAppleJws(await signJws({ ...payload, signedDate: CHAIN_FROM - 1 }, chain), chain.rootSha256));
    expect(await verifyAppleJws(await signJws({ ...payload, signedDate: CHAIN_TO }, chain), chain.rootSha256)).toEqual({
      ...payload,
      signedDate: CHAIN_TO,
    });
  });

  test("a missing signedDate and a string signedDate are rejected", async () => {
    const { signedDate: _omitted, ...withoutDate } = payload;
    await expectInvalid(verifyAppleJws(await signJws(withoutDate, chain), chain.rootSha256));
    await expectInvalid(verifyAppleJws(await signJws({ ...payload, signedDate: String(payload.signedDate) }, chain), chain.rootSha256));
  });

  test("header alg ES384 and alg none are rejected", async () => {
    const es384 = await signJws(payload, chain, { header: { alg: "ES384", x5c: chain.x5c } });
    const none = await signJws(payload, chain, { header: { alg: "none", x5c: chain.x5c } });
    await expectInvalid(verifyAppleJws(es384, chain.rootSha256));
    await expectInvalid(verifyAppleJws(none, chain.rootSha256));
  });

  test("x5c with 2 entries, 4 entries, a number entry, or a non-base64 entry is rejected", async () => {
    const [a = "", b = "", c = ""] = chain.x5c;
    const cases: unknown[][] = [[a, b], [a, b, c, c], [a, b, 7], [a, b, "%%%"]];
    for (const x5c of cases) {
      await expectInvalid(verifyAppleJws(await signJws(payload, chain, { header: { alg: "ES256", x5c } }), chain.rootSha256));
    }
  });

  test("a JWS signed with another P-256 key is rejected", async () => {
    const other = await ecKey("P-256");
    await expectInvalid(verifyAppleJws(await signJws(payload, chain, { key: other.privateKey }), chain.rootSha256));
  });

  test("a JWS whose payload was replaced after signing is rejected", async () => {
    const [header = "", , signature = ""] = (await signJws(payload, chain)).split(".");
    const forged = toBase64Url(new TextEncoder().encode(JSON.stringify({ ...payload, transactionId: "9" })));
    await expectInvalid(verifyAppleJws(`${header}.${forged}.${signature}`, chain.rootSha256));
  });

  test("a string with two parts is rejected", async () => {
    await expectInvalid(verifyAppleJws("a.b", chain.rootSha256));
  });
});
