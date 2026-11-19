# Security cards: S0A to S4

The design is `docs/security.md`; read it first (sections 4 to 15 are what these cards build). These cards replace the old "Blocked until a security owner signs off" rows S1 to S4 in `docs/build-plan.md`; when each card is built relative to the other card sets is "Build order" in `docs/build-plan.md`. The product owner decided on 19 Nov 2026 to build them now, with only well-known algorithms and platform crypto, and to have the design reviewed by an outside security reviewer before real students use it. If a card and `docs/security.md` disagree, stop and ask in the pull request.

## Order and ownership

```
S0A → S0B → S1A → S1B → S1C → S1D ──→ S1F (also needs PR 31)
                   │      │      └→ S2 (needs src/keys/envelopes.ts from S1C)
                   │      └→ S3 (after S1B, so keys.ts is created once)
                   ├→ S4
                   └→ S1E (also needs PR 14, 15 and 17)
```

| What | Owner |
|---|---|
| `packages/crypto` (all formats, HPKE, signatures, test vectors) | S0A, S0B |
| Migration `0005_security.sql` (new `devices` columns, `device_pairings`, `request_nonces`, `jobs.device_id`), `BatchDb`, the test D1's `batch`, `requireDeviceSignature`, `apps/api/test/helpers/signing.ts` | S1A |
| The device signature on the four paid routes merged before S1A (explain, more detail, double-check, Apple purchases) | S1E |
| Push notices for device pairing; deleting a removed device's push token | S1F (outline below, written in full after S1D) |
| `packages/contracts/src/keys.ts`: created by S1B; S1C, S1D, S2 and S3 each append their own block | S1B to S3 |
| `POST /v1/devices`, `GET /v1/devices` | S1B |
| `GET`/`POST /v1/devices/:id/pairing`, `POST /v1/devices/:id/pairing/reveal`, `POST /v1/devices/:id/approve`, `src/keys/envelopes.ts` | S1C |
| `DELETE /v1/devices/:id` (with the account key rotation and the key version bump for the user's groups) | S1D |
| `key_envelopes` rows (except the ones `approve` inserts), `GET /v1/groups/:id/devices`, `GET /v1/groups/:id/keys`, `POST /v1/groups/:id/keys` | S2 |
| `groups`, `memberships`, `invites` rows; `POST /v1/groups`; `DELETE /v1/groups/:id/members/:user`, which increments `groups.key_version` in the same D1 batch that ends the membership (with the SQL below) | PR 27 |
| `PUT /v1/recovery`, `GET /v1/recovery` | S3 |
| `sealJobResult` (sealing to the device, R2 `results/{job}`, `jobs.result_key`) | S4 |
| The R2 binding `BUCKET` (bucket `waypoint`) | PR 33 |
| Writing `jobs.device_id` in `POST /v1/jobs`, `GET /v1/jobs/:id/result` | PR 20 |
| Deleting old `request_nonces` rows in the hourly cron | PR 33 |
| Calling `sealJobResult` from each workflow | PR 22 to 25 |

PR 27 bumps a group's key version with exactly:

```sql
UPDATE groups SET key_version = key_version + 1 WHERE id = ?
```

**Migration number.** S1A adds `db/d1/migrations/0005_security.sql`. The number is fixed by the build order: `0003_push_tokens.sql` (PR 31) and `0004_apple_notifications.sql` (PR 18) merge before it.

## Rules for every security card

On top of `AGENTS.md` and the wave 2 rules (top of "Wave 2" in `docs/build-plan.md`):

- Files only where the card says, plus `package-lock.json` when the card adds a dependency.
- Use the code blocks marked "exactly" character for character. Other code may differ in style but not in behaviour.
- Never log, return in an error, or put in an exception message: keys, signatures, nonces, envelopes, recovery blobs, plaintext or ciphertext. Error replies use `ApiFailure` with the messages the card gives.
- Every byte format comes from `@waypoint/crypto`. Do not re-implement base64url, contexts or envelope parsing in `apps/api`.
- Run `npm install`, `npm run typecheck`, `npm test` and `npm run bundle -w @waypoint/api` from the repo root; paste the last lines of each into the pull request.

Route tests use a fresh app, like PR 11 and 12, with `createTestDb()` as `DB` and the helpers in `apps/api/test/helpers/signing.ts` (S1A):

```ts
const NOW = 1_763_560_000_000;
const app = new Hono<AppEnv>();
app.onError(handleError);
app.use(async (c, next) => {
  c.set("user", user);
  await next();
});
app.route("/", theRouteUnderTest({ now: () => NOW }));
// app.request(path, await signedInit(device, { method, path, body, now: NOW }), { DB: db })
```

Dependency versions checked with `npm view <pkg> time --json` on 19 Nov 2026:

| Package | Version | Published | Notes |
|---|---|---|---|
| `@hpke/core` | 1.9.0 | 2026-03-08 | WebCrypto only; asks for `@hpke/common` `^1.10.0` |
| `@hpke/common` | 1.10.1 | 2026-03-12 | pinned so npm does not pick a newer 1.x |

Both bundle for Workers (checked with `wrangler deploy --dry-run` and run in `wrangler dev`). The bundle contains one `import("crypto")` inside `@hpke/common`; it only runs when `globalThis.crypto` is missing, which never happens on Workers, so `nodejs_compat` is not needed.

---

## S0A · `packages/crypto`: bytes, contexts, keys, HPKE

Branch `pr/s0a-crypto-core`. Files: only under `packages/crypto/`, plus `package-lock.json`. No other files.

Dependencies: `"@hpke/core": "1.9.0"`, `"@hpke/common": "1.10.1"`. Dev dependencies: `"@cloudflare/workers-types": "5.20261118.1"`, `"@types/node": "24.19.2"` (both already in the lockfile). Nothing else.

`packages/crypto/package.json`, exactly:

```json
{
  "name": "@waypoint/crypto",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@hpke/common": "1.10.1",
    "@hpke/core": "1.9.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "5.20261118.1",
    "@types/node": "24.19.2"
  }
}
```

`packages/crypto/tsconfig.json`, exactly (the package template plus the types WebCrypto and the tests need):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types", "node"] },
  "include": ["src", "test"]
}
```

Rules for this package: no `node:` imports in `src/` (it runs in Workers and later in the web viewer); `crypto.subtle`, `btoa`, `atob`, `TextEncoder` only. Tests may use `node:fs`.

`src/bytes.ts`, exactly:

```ts
// Byte helpers shared by every format in this package. No Node APIs: this file runs in Workers and browsers.

const B64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Strict: no padding, no other alphabet, and the text must be the canonical encoding of its bytes.
export function fromBase64Url(text: string): Uint8Array {
  if (!B64URL.test(text) || text.length % 4 === 1) throw new RangeError("not base64url");
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  if (toBase64Url(bytes) !== text) throw new RangeError("not canonical base64url");
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(text: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(text)) throw new RangeError("not lowercase hex");
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function u16(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError("u16 out of range");
  return new Uint8Array([value >> 8, value & 0xff]);
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
```

`src/context.ts`, exactly:

```ts
import { concat, u16, utf8 } from "./bytes.ts";

// Domain separation for every key derivation, signature and AAD in Waypoint (docs/security.md, "Context strings"):
//   "waypoint/v1/" + label, one 0x00 byte, then each field as a 2-byte big-endian length and its UTF-8 bytes.
export function context(label: string, ...fields: string[]): Uint8Array {
  if (!/^[a-z0-9-]{1,32}$/.test(label)) throw new RangeError("bad context label");
  const parts: Uint8Array[] = [utf8(`waypoint/v1/${label}`), new Uint8Array([0])];
  for (const field of fields) {
    const bytes = utf8(field);
    parts.push(u16(bytes.length), bytes);
  }
  return concat(...parts);
}
```

`src/ids.ts`, exactly:

```ts
// Ids that appear inside signed or encrypted context: device, user, group, job, link and blob ids.
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function checkId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new RangeError("bad id");
  return id;
}
```

`src/keys.ts`, exactly:

```ts
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
```

`src/hpke.ts`, exactly:

```ts
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
```

`src/index.ts`, exactly (S0B adds lines):

```ts
export * from "./bytes.ts";
export * from "./context.ts";
export * from "./ids.ts";
export * from "./keys.ts";
export * from "./hpke.ts";
```

### Test vectors

`test/vectors/rfc9180-p256-sha256-aes256gcm-base.json`, exactly. It is the entry of the RFC 9180 test vectors (`https://raw.githubusercontent.com/cfrg/draft-irtf-cfrg-hpke/5f503c564da00b0687b3de75f1dfbdfc4079ad31/test-vectors.json`) with `mode 0`, `kem_id 16`, `kdf_id 1`, `aead_id 2`, cut to the fields below and its first encryption:

```json
{
  "mode": 0,
  "kem_id": 16,
  "kdf_id": 1,
  "aead_id": 2,
  "info": "4f6465206f6e2061204772656369616e2055726e",
  "ikmR": "a0ce15d49e28bd47a18a97e147582d814b08cbe00109fed5ec27d1b4e9f6f5e3",
  "ikmE": "a90d3417c3da9cb6c6ae19b4b5dd6cc9529a4cc24efb7ae0ace1f31887a8cd6c",
  "skRm": "317f915db7bc629c48fe765587897e01e282d3e8445f79f27f65d031a88082b2",
  "skEm": "90345e3a1d116c1dd39ae76d95ab858c142223a63e44f8f85318cfa91a84858e",
  "pkRm": "04abc7e49a4c6b3566d77d0304addc6ed0e98512ffccf505e6a8e3eb25c685136f853148544876de76c0f2ef99cdc3a05ccf5ded7860c7c021238f9e2073d2356c",
  "pkEm": "04c06b4f6bebc7bb495cb797ab753f911aff80aefb86fd8b6fcc35525f3ab5f03e0b21bd31a86c6048af3cb2d98e0d3bf01da5cc4c39ff5370d331a4f1f7d5a4e0",
  "enc": "04c06b4f6bebc7bb495cb797ab753f911aff80aefb86fd8b6fcc35525f3ab5f03e0b21bd31a86c6048af3cb2d98e0d3bf01da5cc4c39ff5370d331a4f1f7d5a4e0",
  "shared_secret": "48893fecd82f7c3456af6a42d8f56325d21e08c10fa81299986aaff54cde7b49",
  "key": "ee16802a936d5f544771131900ee6973d0551de9e852ece2ef34bf0d5f9e1d1d",
  "base_nonce": "9bc50980832a7b4b58c40161",
  "encryptions": [
    {
      "aad": "436f756e742d30",
      "ct": "58c61a45059d0c5704560e9d88b564a8b63f1364b8d1fcb3c4c6ddc1d291742465e902cd216f8908da49f8f96f",
      "nonce": "9bc50980832a7b4b58c40161",
      "pt": "4265617574792069732074727574682c20747275746820626561757479"
    }
  ]
}
```

`test/vectors/wycheproof-ecdsa-secp256r1-sha256-p1363.json`: download it, check it, commit it unchanged:

```sh
curl -sSfL -o packages/crypto/test/vectors/wycheproof-ecdsa-secp256r1-sha256-p1363.json \
  https://raw.githubusercontent.com/C2SP/wycheproof/878e5366008753df2064d40c49f8e2f50f9c6af7/testvectors_v1/ecdsa_secp256r1_sha256_p1363_test.json
shasum -a 256 packages/crypto/test/vectors/wycheproof-ecdsa-secp256r1-sha256-p1363.json
# must print c60de693930e386c3a5472d08081623ef8504decc54b38ac01ec6b2a2575c986
```

If the hash differs, stop and say so in the pull request. Tests never download anything.

### Tests

`test/helpers/vectors.ts`, exactly:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VECTORS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "vectors");

export function readVectors<T>(name: string): T {
  return JSON.parse(readFileSync(join(VECTORS_DIR, name), "utf8")) as T;
}
```

`test/hpke.test.ts`, exactly:

```ts
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
```

`test/keys.test.ts`, exactly:

```ts
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
```

`test/bytes.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { bytesEqual, concat, context, fromBase64Url, fromHex, toBase64Url, toHex, u16 } from "../src/index.ts";

describe("base64url", () => {
  it("round-trips 0 to 66 bytes without padding", () => {
    for (let n = 0; n <= 66; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(text)).toEqual(bytes);
    }
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });

  it("rejects padding, the standard alphabet, bad lengths and non-canonical text", () => {
    for (const bad of ["AA==", "+/8", "A", "AB$", "AB "]) expect(() => fromBase64Url(bad), bad).toThrow(RangeError);
    expect(() => fromBase64Url("AB")).toThrow(RangeError); // canonical form of [0x00] is "AA"
  });
});

describe("hex, u16, concat, bytesEqual", () => {
  it("work", () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
    expect(fromHex("000fff")).toEqual(new Uint8Array([0, 15, 255]));
    expect(() => fromHex("0F")).toThrow(RangeError);
    expect(() => fromHex("abc")).toThrow(RangeError);
    expect(u16(258)).toEqual(new Uint8Array([1, 2]));
    expect(() => u16(65536)).toThrow(RangeError);
    expect(() => u16(-1)).toThrow(RangeError);
    expect(concat(new Uint8Array([1]), new Uint8Array(0), new Uint8Array([2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false);
  });
});

describe("context", () => {
  it("is the label, a zero byte, then length-prefixed UTF-8 fields", () => {
    expect(toHex(context("x"))).toBe(toHex(new TextEncoder().encode("waypoint/v1/x")) + "00");
    expect(toHex(context("x", "", "ab"))).toBe(toHex(new TextEncoder().encode("waypoint/v1/x")) + "00" + "0000" + "00026162");
  });

  it("moving a byte between fields changes the result", () => {
    expect(toHex(context("x", "ab", "c"))).not.toBe(toHex(context("x", "a", "bc")));
  });

  it("rejects labels outside [a-z0-9-]{1,32}", () => {
    for (const bad of ["", "A", "a/b", "a".repeat(33)]) expect(() => context(bad)).toThrow(RangeError);
  });
});
```

What these cover, one line each:
- HPKE seal with the RFC's ephemeral key gives the RFC's `enc` and ciphertext; the key pair derived from `ikmR` has the RFC's `pkRm` and `skRm` and opens the RFC ciphertext.
- A random seal opens; another `info`, another `aad` or a flipped ciphertext byte fails.
- `verifyP256` accepts all 173 `valid` Wycheproof cases and rejects all 89 `invalid` ones (262 in total).
- `decodePublicKey` takes only 65-byte points starting with `0x04`; a point off the curve does not verify.
- base64url round-trips 0 to 66 bytes; padding, `+/`, a 1-character tail and non-canonical text are rejected.
- `context` layout, field boundaries, and label rules.

Not in this PR: request signatures, envelopes, sealed results, recovery, content, links (S0B); anything in `apps/api`.

---

## S0B · `packages/crypto`: Waypoint formats and published vectors

Branch `pr/s0b-crypto-formats`. Builds on S0A. Files: only under `packages/crypto/`. No new dependencies.

Add these files, each exactly as given. They are the reference for every byte format in `docs/security.md`; the iOS module will be checked against the vectors below.

`src/request.ts`:

```ts
import { fromBase64Url, sha256, toHex } from "./bytes.ts";
import { context } from "./context.ts";
import { checkId } from "./ids.ts";

// Headers on a request signed by a device key (docs/security.md, "Request signatures").
export const DEVICE_HEADER = "Waypoint-Device";
export const TIMESTAMP_HEADER = "Waypoint-Timestamp";
export const NONCE_HEADER = "Waypoint-Nonce";
export const SIGNATURE_HEADER = "Waypoint-Signature";

// A signed request is accepted only if its timestamp is within this many ms of the server clock.
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
// The device id used while registering, before the server has given the device an id.
export const NEW_DEVICE = "new";

export type RequestToSign = {
  method: string; // upper case, e.g. "POST"
  target: string; // path and query exactly as sent, e.g. "/v1/devices/abc/approve"
  deviceId: string;
  timestamp: number; // Unix ms
  nonce: string; // base64url of 16 random bytes (22 characters)
  bodySha256: string; // lowercase hex SHA-256 of the body bytes (of zero bytes when there is no body)
};

export async function bodySha256(body: Uint8Array): Promise<string> {
  return toHex(await sha256(body));
}

export function requestSigningInput(request: RequestToSign): Uint8Array {
  if (!/^[A-Z]{3,7}$/.test(request.method)) throw new RangeError("bad method");
  if (!/^\/[\x21-\x7e]{0,2047}$/.test(request.target)) throw new RangeError("bad target");
  if (request.deviceId !== NEW_DEVICE) checkId(request.deviceId);
  if (!Number.isSafeInteger(request.timestamp) || request.timestamp < 0) throw new RangeError("bad timestamp");
  if (request.nonce.length !== 22 || fromBase64Url(request.nonce).length !== 16) throw new RangeError("bad nonce");
  if (!/^[0-9a-f]{64}$/.test(request.bodySha256)) throw new RangeError("bad body hash");
  return context(
    "request",
    request.method,
    request.target,
    request.deviceId,
    String(request.timestamp),
    request.nonce,
    request.bodySha256,
  );
}
```

`src/pairing.ts`:

```ts
import { fromBase64Url, sha256, toBase64Url } from "./bytes.ts";
import { context } from "./context.ts";
import { decodePublicKey } from "./keys.ts";

// Adding a device (docs/security.md, "Adding a device"). Keys and nonces are base64url text.
export const PAIRING_NONCE_BYTES = 32;

function checkNonce(nonce: string): string {
  if (fromBase64Url(nonce).length !== PAIRING_NONCE_BYTES) throw new RangeError("bad pairing nonce");
  return nonce;
}

// The new device commits to its nonce before it sees the approver's nonce.
export async function pairingCommitment(signPub: string, boxPub: string, newNonce: string): Promise<string> {
  decodePublicKey(signPub);
  decodePublicKey(boxPub);
  return toBase64Url(await sha256(context("pair-commit", signPub, boxPub, checkNonce(newNonce))));
}

// The 6-digit code both screens show: the first 4 bytes of the hash, big-endian, mod 1,000,000.
export async function pairingCode(input: {
  newSignPub: string;
  newBoxPub: string;
  approverSignPub: string;
  approverNonce: string;
  newNonce: string;
}): Promise<string> {
  decodePublicKey(input.newSignPub);
  decodePublicKey(input.newBoxPub);
  decodePublicKey(input.approverSignPub);
  const digest = await sha256(
    context(
      "pair-code",
      input.newSignPub,
      input.newBoxPub,
      input.approverSignPub,
      checkNonce(input.approverNonce),
      checkNonce(input.newNonce),
    ),
  );
  const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0, false);
  return String(value % 1_000_000).padStart(6, "0");
}
```

`src/certificate.ts`:

```ts
import { context } from "./context.ts";
import { checkId } from "./ids.ts";
import { decodePublicKey } from "./keys.ts";

// What the account key signs to vouch for one device (docs/security.md, "Device certificates").
export function deviceCertificateInput(userId: string, deviceId: string, signPub: string, boxPub: string): Uint8Array {
  decodePublicKey(signPub);
  decodePublicKey(boxPub);
  return context("device-cert", checkId(userId), checkId(deviceId), signPub, boxPub);
}
```

`src/envelope.ts`:

```ts
import { concat, u16, utf8 } from "./bytes.ts";
import { context } from "./context.ts";
import { HPKE_ENC_BYTES, hpkeOpen, hpkeSeal } from "./hpke.ts";
import { checkId } from "./ids.ts";
import { P256_SIGNATURE_BYTES } from "./keys.ts";

// A key wrapped for one device and signed by the device that wrapped it (docs/security.md, "Envelopes").
//   u8 version (1) | u8 purpose | enc (65) | u16 ct length | ct | u8 signer length | signer id | signature (64)
export const ENVELOPE_VERSION = 1;
export const PURPOSE_GROUP_KEY = 1;
export const PURPOSE_ACCOUNT_KEY = 2;
export type EnvelopePurpose = typeof PURPOSE_GROUP_KEY | typeof PURPOSE_ACCOUNT_KEY;

// Plaintext sizes: a group key is 32 bytes; the account key is the signing scalar then the box scalar.
export const KEY_BYTES: Record<EnvelopePurpose, number> = { 1: 32, 2: 64 };
const TAG_BYTES = 16;

export type ParsedEnvelope = {
  purpose: EnvelopePurpose;
  enc: Uint8Array;
  ct: Uint8Array;
  signerId: string;
  signature: Uint8Array;
  body: Uint8Array; // every byte before the signature
};

export function groupKeyInfo(groupId: string, keyVersion: number, deviceId: string): Uint8Array {
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new RangeError("bad key version");
  return context("group-key", checkId(groupId), String(keyVersion), checkId(deviceId));
}

export function accountKeyInfo(userId: string, accountDeviceId: string, deviceId: string): Uint8Array {
  return context("account-key", checkId(userId), checkId(accountDeviceId), checkId(deviceId));
}

// The bytes the wrapping device signs: the HPKE info (which names the group or account and the recipient),
// then the envelope body.
export function envelopeSignatureInput(info: Uint8Array, body: Uint8Array): Uint8Array {
  return concat(context("envelope-sig"), u16(info.length), info, body);
}

export function parseEnvelope(bytes: Uint8Array): ParsedEnvelope {
  const fail = (): never => {
    throw new RangeError("bad envelope");
  };
  if (bytes.length < 2 + HPKE_ENC_BYTES + 2) fail();
  const purpose = bytes[1];
  if (bytes[0] !== ENVELOPE_VERSION || (purpose !== PURPOSE_GROUP_KEY && purpose !== PURPOSE_ACCOUNT_KEY)) fail();
  const p = purpose as EnvelopePurpose;
  let at = 2;
  const enc = bytes.slice(at, at + HPKE_ENC_BYTES);
  at += HPKE_ENC_BYTES;
  const ctLength = ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
  at += 2;
  if (enc[0] !== 0x04 || ctLength !== KEY_BYTES[p] + TAG_BYTES) fail();
  const ct = bytes.slice(at, at + ctLength);
  at += ctLength;
  const signerLength = bytes[at] ?? 0;
  at += 1;
  if (bytes.length !== at + signerLength + P256_SIGNATURE_BYTES) fail();
  const signerId = new TextDecoder().decode(bytes.slice(at, at + signerLength));
  at += signerLength;
  try {
    checkId(signerId);
  } catch {
    fail();
  }
  return { purpose: p, enc, ct, signerId, signature: bytes.slice(at), body: bytes.slice(0, at) };
}

// Reference for the devices and for test vectors. The server only parses envelopes; it never makes or opens them.
export async function makeEnvelope(input: {
  purpose: EnvelopePurpose;
  info: Uint8Array;
  recipientBoxPub: Uint8Array;
  key: Uint8Array;
  signerId: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
  ekm?: Uint8Array;
}): Promise<Uint8Array> {
  if (input.key.length !== KEY_BYTES[input.purpose]) throw new RangeError("bad key length");
  const header = new Uint8Array([ENVELOPE_VERSION, input.purpose]);
  const { enc, ct } = await hpkeSeal(input.recipientBoxPub, input.info, header, input.key, input.ekm);
  const signer = utf8(checkId(input.signerId));
  const body = concat(header, enc, u16(ct.length), ct, new Uint8Array([signer.length]), signer);
  const signature = await input.sign(envelopeSignatureInput(input.info, body));
  if (signature.length !== P256_SIGNATURE_BYTES) throw new RangeError("bad signature length");
  return concat(body, signature);
}

export async function openEnvelope(envelope: ParsedEnvelope, info: Uint8Array, recipientKey: CryptoKey): Promise<Uint8Array> {
  const header = new Uint8Array([ENVELOPE_VERSION, envelope.purpose]);
  return hpkeOpen(recipientKey, envelope.enc, info, header, envelope.ct);
}
```

`src/sealed.ts`:

```ts
import { concat } from "./bytes.ts";
import { context } from "./context.ts";
import { HPKE_ENC_BYTES, hpkeOpen, hpkeSeal } from "./hpke.ts";
import { checkId } from "./ids.ts";

// A task result sealed to the device that asked for it (docs/security.md, "Sealed task results").
//   u8 version (1) | u8 purpose (3) | enc (65) | ct
export const SEALED_VERSION = 1;
export const PURPOSE_RESULT = 3;
export const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const HEADER = new Uint8Array([SEALED_VERSION, PURPOSE_RESULT]);

export function resultInfo(jobId: string, deviceId: string): Uint8Array {
  return context("result", checkId(jobId), checkId(deviceId));
}

export async function sealResult(input: {
  jobId: string;
  deviceId: string;
  deviceBoxPub: Uint8Array;
  plaintext: Uint8Array;
  ekm?: Uint8Array;
}): Promise<Uint8Array> {
  if (input.plaintext.length > MAX_RESULT_BYTES) throw new RangeError("result too large");
  const info = resultInfo(input.jobId, input.deviceId);
  const { enc, ct } = await hpkeSeal(input.deviceBoxPub, info, HEADER, input.plaintext, input.ekm);
  return concat(HEADER, enc, ct);
}

export async function openResult(sealed: Uint8Array, jobId: string, deviceId: string, deviceKey: CryptoKey): Promise<Uint8Array> {
  if (sealed.length < 2 + HPKE_ENC_BYTES + 16 || sealed[0] !== SEALED_VERSION || sealed[1] !== PURPOSE_RESULT) {
    throw new RangeError("bad sealed result");
  }
  const enc = sealed.slice(2, 2 + HPKE_ENC_BYTES);
  return hpkeOpen(deviceKey, enc, resultInfo(jobId, deviceId), HEADER, sealed.slice(2 + HPKE_ENC_BYTES));
}
```

`src/recovery.ts`:

```ts
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
```

`src/content.ts`:

```ts
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
```

`src/link.ts`:

```ts
import { toBase64Url } from "./bytes.ts";
import { context } from "./context.ts";
import { checkId } from "./ids.ts";

// A shared link's passcode is checked by the server, not used as a key (docs/security.md, "Shared links").
// passcode_hash = base64url(HMAC-SHA256(pepper, context("link-passcode", link id, passcode)))
export async function linkPasscodeHash(pepper: Uint8Array, linkId: string, passcode: string): Promise<string> {
  if (pepper.length !== 32) throw new RangeError("bad pepper");
  const key = await crypto.subtle.importKey("raw", pepper, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, context("link-passcode", checkId(linkId), passcode));
  return toBase64Url(new Uint8Array(mac));
}
```

`src/index.ts`: add, after the S0A lines:

```ts
export * from "./request.ts";
export * from "./pairing.ts";
export * from "./certificate.ts";
export * from "./envelope.ts";
export * from "./sealed.ts";
export * from "./recovery.ts";
export * from "./content.ts";
export * from "./link.ts";
```

### Published vectors

`test/vectors/waypoint-v1.json`, exactly. These were made with the code above and re-derived during the design by a separate script that used only `node:crypto` (with HPKE re-implemented from RFC 9180 and checked against the RFC vector). Private keys in this file are test values only. Signatures are random, so the file gives one valid signature for each signed item; HPKE output is fixed by `ikm_e`.

```json
{
  "context": {
    "label": "group-key",
    "fields": [
      "g_01",
      "7",
      "dev_é"
    ],
    "bytes": "776179706f696e742f76312f67726f75702d6b6579000004675f303100013700066465765fc3a9"
  },
  "request": {
    "method": "POST",
    "target": "/v1/devices/dev_new/approve?x=1",
    "deviceId": "dev_phone",
    "timestamp": 1763560000000,
    "nonce": "AQIDBAUGBwgJCgsMDQ4PEA",
    "bodySha256": "2d4f6661aa3e2cac99d03595c76a7c30b2b2be52d7e2e4906f94043295a376af",
    "body_utf8": "{\"name\":\"iPad\"}",
    "signing_input": "776179706f696e742f76312f72657175657374000004504f5354001f2f76312f646576696365732f6465765f6e65772f617070726f76653f783d3100096465765f70686f6e65000d31373633353630303030303030001641514944424155474277674a4367734d445134504541004032643466363636316161336532636163393964303335393563373661376333306232623262653532643765326534393036663934303433323935613337366166",
    "device_private_key": "c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721",
    "device_sign_pub": "BGD-1LolWp0xyWHrdMY1bWjASbiSO2H6bOZpYi5g8p-2eQP-EAi4vJmkGunpVii8ZPLxsgwtfp9Rd6PClNRGIpk",
    "signature": "WfmKh87ba4LV2dTCQ75ML5DC5Td4hDBHKCNlwro89eNCe_U2gIMpz0jS-cO9bPgpYFv1VrnzWTJST1LZQ4Kh1A"
  },
  "pairing": {
    "new_sign_pub": "BGD-1LolWp0xyWHrdMY1bWjASbiSO2H6bOZpYi5g8p-2eQP-EAi4vJmkGunpVii8ZPLxsgwtfp9Rd6PClNRGIpk",
    "new_box_pub": "BF6EtVCLRb0cWMBg0KVSt9YG00gwJMuoy85r-WQ-2QUiP0MxZrqBoFPEKpMznLlg8dY42sMges18jL4cMKPpwv0",
    "new_nonce": "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8",
    "approver_sign_pub": "BJqF0XF8Ad4Tey5pNbysd4XCFK7JaJ8WWJZBIoeMsNSdkfNIjTNHXpgjgC0S-L2Z0xhQaV7XfUsJW5gu5NOK0_Y",
    "approver_nonce": "gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8",
    "commitment": "pN2iIzuN5OgNBeFbVxvWH-zD18OqbcC8r8mvnYJPwsw",
    "code": "096681"
  },
  "device_certificate": {
    "user_id": "usr_1",
    "device_id": "dev_new",
    "sign_pub": "BGD-1LolWp0xyWHrdMY1bWjASbiSO2H6bOZpYi5g8p-2eQP-EAi4vJmkGunpVii8ZPLxsgwtfp9Rd6PClNRGIpk",
    "box_pub": "BF6EtVCLRb0cWMBg0KVSt9YG00gwJMuoy85r-WQ-2QUiP0MxZrqBoFPEKpMznLlg8dY42sMges18jL4cMKPpwv0",
    "signing_input": "776179706f696e742f76312f6465766963652d636572740000057573725f3100076465765f6e657700574247442d314c6f6c5770307879574872644d593162576a41536269534f324836624f5a705969356738702d326551502d45416934764a6d6b47756e70566969385a504c787367777466703952643650436c4e524749706b0057424636457456434c52623063574d4267304b565374395947303067774a4d756f793835722d57512d3251556950304d785a7271426f4650454b704d7a6e4c6c673864593432734d67657331386a4c34634d4b5070777630",
    "account_private_key": "0f56db78ca460b055c500064824bed999a25aaf48ebb519ac201537b85479813",
    "account_sign_pub": "BOJm3f3BJmjbMNTKPo93SUMsQWBE8tK4wQvz1AEq7_qKv6hkBKLp_-Z9R8WH73qXp_RWuGO00Cz8aSiXOrWxyzk",
    "signature": "738jtYCqsK1tF3jTY7kwIVHAjh8ofxx65wqwkL-Zr-7HUwIij3bKw9DyCCj1HqqMSywM8IhfpGQIrfX9UUi-8g"
  },
  "group_key_envelope": {
    "group_id": "grp_1",
    "key_version": 3,
    "recipient_device_id": "dev_new",
    "recipient_private_key": "8ee4c4f3e7b1c2b6a2c9d4f1e3b5a7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1",
    "recipient_box_pub": "BF6EtVCLRb0cWMBg0KVSt9YG00gwJMuoy85r-WQ-2QUiP0MxZrqBoFPEKpMznLlg8dY42sMges18jL4cMKPpwv0",
    "ikm_e": "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf",
    "group_key": "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f",
    "signer_id": "dev_phone",
    "signer_private_key": "e7a25ad7f2d0c1d4fa4a2d1a9b6c0b8d6a0d4bd8c4a39b0e0f8b8a1d2e3f4a5b",
    "signer_sign_pub": "BJqF0XF8Ad4Tey5pNbysd4XCFK7JaJ8WWJZBIoeMsNSdkfNIjTNHXpgjgC0S-L2Z0xhQaV7XfUsJW5gu5NOK0_Y",
    "info": "776179706f696e742f76312f67726f75702d6b65790000056772705f3100013300076465765f6e6577",
    "signature_input": "776179706f696e742f76312f656e76656c6f70652d736967000029776179706f696e742f76312f67726f75702d6b65790000056772705f3100013300076465765f6e65770101043ecd14c425a55bda0ea6cdf16031bd5a04cc337706cfdeb38b2afa37967be5dc4373a4bd215f7b473252305ed2a9b86a8cb439f186765df4838459b1ca04c4b800304e22100264caeda22d4ceb010b562cb4f5836be6ac5a782f2040bd343038f499eac974c1c48a6f4a3063180fa8153435096465765f70686f6e65",
    "envelope": "AQEEPs0UxCWlW9oOps3xYDG9WgTMM3cGz96ziyr6N5Z75dxDc6S9IV97RzJSMF7SqbhqjLQ58YZ2XfSDhFmxygTEuAAwTiIQAmTK7aItTOsBC1YstPWDa-asWngvIEC9NDA49JnqyXTBxIpvSjBjGA-oFTQ1CWRldl9waG9uZa91B8W-iJLuUREqVAU0dCqM7BvG63wahABlkBXru6bugMR6AAHM4kX53f9MKAfdeXbAZVdo9TEQAAYXi2_rYl4"
  },
  "account_key_envelope": {
    "user_id": "usr_1",
    "account_device_id": "acct_1",
    "recipient_device_id": "dev_new",
    "recipient_private_key": "8ee4c4f3e7b1c2b6a2c9d4f1e3b5a7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1",
    "ikm_e": "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf",
    "account_key": "0f56db78ca460b055c500064824bed999a25aaf48ebb519ac201537b85479813101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f",
    "signer_id": "dev_phone",
    "signer_sign_pub": "BJqF0XF8Ad4Tey5pNbysd4XCFK7JaJ8WWJZBIoeMsNSdkfNIjTNHXpgjgC0S-L2Z0xhQaV7XfUsJW5gu5NOK0_Y",
    "info": "776179706f696e742f76312f6163636f756e742d6b65790000057573725f310006616363745f3100076465765f6e6577",
    "envelope": "AQIEWMOK02el6tEGdY2gavz1dRTridBPSbLdgwb0XH1MZYObdfX3ykKYqOxdmVGSNHFi6eF2SWM1vbebw9K0ivAYewBQ1TGxpWllRxi2uifgI_hKJGFuHC-ff4IC_fCR3g5msqx99UfA99TfQUXXL0VPbgPb4bj3XBufy25Sq-C_3CmYRoHH0qdacGmGgOzlPD5QXQUJZGV2X3Bob25ljwI-FshZ3az63r7eZyMJVkJzrsmHulPujPM-y-SoiThLS1KlOWyF16KSkXA_BNNhUnOaPszusuEbO6eHkYVH9g"
  },
  "sealed_result": {
    "job_id": "job_1",
    "device_id": "dev_new",
    "device_private_key": "8ee4c4f3e7b1c2b6a2c9d4f1e3b5a7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1",
    "device_box_pub": "BF6EtVCLRb0cWMBg0KVSt9YG00gwJMuoy85r-WQ-2QUiP0MxZrqBoFPEKpMznLlg8dY42sMges18jL4cMKPpwv0",
    "ikm_e": "c0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedf",
    "info": "776179706f696e742f76312f726573756c740000056a6f625f3100076465765f6e6577",
    "plaintext_utf8": "HOST A: Today we look at photosynthesis.",
    "sealed": "AQMERb9m3D3fBOd4UX7uiW6OHph2_w50GRBtXPetbwNs-dWN-CpUW-4uGn2Z1jYV55ILiQf_2aXWp_xlo4aHQ1EcbLCunePIJQo4jzTIU8OFU9e9Ld-qa53qg60Tt6t77TGtVdTpnTXGpwRxydXBj7UXHaLGXtjv2_vb"
  },
  "recovery": {
    "words": "legal winner thank year wave sausage worth useful legal winner thank yellow",
    "entropy": "7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f",
    "user_id": "usr_1",
    "account_device_id": "acct_1",
    "wrap_key": "b03d0d1383d90bba2a1030767e35304fd50df8ff6dc430c995cde6ca0fe85286",
    "aad": "01776179706f696e742f76312f7265636f766572790000057573725f310006616363745f31",
    "account_key": "0f56db78ca460b055c500064824bed999a25aaf48ebb519ac201537b85479813101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f",
    "nonce": "606162636465666768696a6b",
    "blob": "AWBhYmNkZWZnaGlqawkZ0TxRxE900CVwSTC66NBj7QsnzLy22zRjTQG3VUZ7pmn7E4xkxUg0IjD-Ja-jCE-UZu98zzQPNoO5OyfnjtIPnD7K9Ul6BIYxwY2J9vEA"
  },
  "content": {
    "key": "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    "key_version": 3,
    "context": "776179706f696e742f76312f6368616e67650000056772705f3100096465765f70686f6e6500046e6f7465",
    "context_label": "change",
    "context_fields": [
      "grp_1",
      "dev_phone",
      "note"
    ],
    "nonce": "707172737475767778797a7b",
    "plaintext_utf8": "{\"t\":\"cell\"}",
    "locked": "AQAAAANwcXJzdHV2d3h5entspc4Fiev_UShGFK_b51KSS8YgR2oXzh6cKVPz"
  },
  "link_passcode": {
    "pepper": "333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152",
    "link_id": "lnk_1",
    "passcode": "4821",
    "hash": "5slJwYc-np2O4JixU5cC2vhWgELRyup98QiB-0ILXWE"
  }
}
```

### Tests

`test/vectors.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import {
  accountKeyInfo, bodySha256, concat, context, deviceCertificateInput, envelopeSignatureInput, fromBase64Url, fromHex,
  groupKeyInfo, HPKE_SUITE, importContentKey, linkPasscodeHash, lockContent, makeEnvelope, openEnvelope, openResult,
  pairingCode, pairingCommitment, parseEnvelope, recoveryAad, recoveryWrapKey, requestSigningInput, resultInfo, sealResult,
  toBase64Url, toHex, unlockContent, unwrapAccountKey, utf8, verifyP256, wrapAccountKey, type EnvelopePurpose,
} from "../src/index.ts";
import { readVectors } from "./helpers/vectors.ts";

// test/vectors/waypoint-v1.json is published for the iOS crypto module: the Swift code must produce and accept the
// same bytes. Signatures are random, so for them the vectors give one valid signature to verify.
type Vectors = {
  context: { label: string; fields: string[]; bytes: string };
  request: { method: string; target: string; deviceId: string; timestamp: number; nonce: string; bodySha256: string; body_utf8: string; signing_input: string; device_sign_pub: string; signature: string };
  pairing: { new_sign_pub: string; new_box_pub: string; new_nonce: string; approver_sign_pub: string; approver_nonce: string; commitment: string; code: string };
  device_certificate: { user_id: string; device_id: string; sign_pub: string; box_pub: string; signing_input: string; account_sign_pub: string; signature: string };
  group_key_envelope: { group_id: string; key_version: number; recipient_device_id: string; recipient_private_key: string; recipient_box_pub: string; ikm_e: string; group_key: string; signer_id: string; signer_sign_pub: string; info: string; signature_input: string; envelope: string };
  account_key_envelope: { user_id: string; account_device_id: string; recipient_device_id: string; recipient_private_key: string; ikm_e: string; account_key: string; signer_id: string; signer_sign_pub: string; info: string; envelope: string };
  sealed_result: { job_id: string; device_id: string; device_private_key: string; device_box_pub: string; ikm_e: string; info: string; plaintext_utf8: string; sealed: string };
  recovery: { entropy: string; user_id: string; account_device_id: string; wrap_key: string; aad: string; account_key: string; nonce: string; blob: string };
  content: { key: string; key_version: number; context_label: string; context_fields: string[]; context: string; nonce: string; plaintext_utf8: string; locked: string };
  link_passcode: { pepper: string; link_id: string; passcode: string; hash: string };
};
const v = readVectors<Vectors>("waypoint-v1.json");

const privateKey = async (hex: string): Promise<CryptoKey> => HPKE_SUITE.kem.deserializePrivateKey(fromHex(hex));

describe("waypoint-v1 vectors", () => {
  it("context", () => {
    expect(toHex(context(v.context.label, ...v.context.fields))).toBe(v.context.bytes);
  });

  it("request signing input and signature", async () => {
    const r = v.request;
    expect(await bodySha256(utf8(r.body_utf8))).toBe(r.bodySha256);
    const input = requestSigningInput(r);
    expect(toHex(input)).toBe(r.signing_input);
    expect(await verifyP256(fromBase64Url(r.device_sign_pub), fromBase64Url(r.signature), input)).toBe(true);
    expect(await verifyP256(fromBase64Url(r.device_sign_pub), fromBase64Url(r.signature), requestSigningInput({ ...r, timestamp: r.timestamp + 1 }))).toBe(false);
  });

  it("pairing commitment and code", async () => {
    const p = v.pairing;
    expect(await pairingCommitment(p.new_sign_pub, p.new_box_pub, p.new_nonce)).toBe(p.commitment);
    const input = { newSignPub: p.new_sign_pub, newBoxPub: p.new_box_pub, approverSignPub: p.approver_sign_pub, approverNonce: p.approver_nonce, newNonce: p.new_nonce };
    expect(await pairingCode(input)).toBe(p.code);
    expect(await pairingCode({ ...input, approverNonce: p.new_nonce, newNonce: p.approver_nonce })).not.toBe(p.code);
  });

  it("device certificate", async () => {
    const c = v.device_certificate;
    const input = deviceCertificateInput(c.user_id, c.device_id, c.sign_pub, c.box_pub);
    expect(toHex(input)).toBe(c.signing_input);
    expect(await verifyP256(fromBase64Url(c.account_sign_pub), fromBase64Url(c.signature), input)).toBe(true);
  });

  const envelopes: [string, EnvelopePurpose, () => Uint8Array, string, string, string, string, string, string][] = [
    ["group key", 1, () => groupKeyInfo(v.group_key_envelope.group_id, v.group_key_envelope.key_version, v.group_key_envelope.recipient_device_id),
      v.group_key_envelope.info, v.group_key_envelope.envelope, v.group_key_envelope.group_key, v.group_key_envelope.ikm_e, v.group_key_envelope.recipient_private_key, v.group_key_envelope.signer_sign_pub],
    ["account key", 2, () => accountKeyInfo(v.account_key_envelope.user_id, v.account_key_envelope.account_device_id, v.account_key_envelope.recipient_device_id),
      v.account_key_envelope.info, v.account_key_envelope.envelope, v.account_key_envelope.account_key, v.account_key_envelope.ikm_e, v.account_key_envelope.recipient_private_key, v.account_key_envelope.signer_sign_pub],
  ];
  for (const [name, purpose, info, infoHex, envelopeB64, keyHex, ikmE, skHex, signerPub] of envelopes) {
    it(`${name} envelope: same bytes, valid signature, opens`, async () => {
      expect(toHex(info())).toBe(infoHex);
      const expected = fromBase64Url(envelopeB64);
      const parsed = parseEnvelope(expected);
      expect(parsed.purpose).toBe(purpose);
      expect(parsed.signerId).toBe("dev_phone");
      const remade = await makeEnvelope({
        purpose, info: info(), recipientBoxPub: fromBase64Url(v.pairing.new_box_pub), key: fromHex(keyHex), signerId: parsed.signerId,
        sign: async () => parsed.signature, ekm: fromHex(ikmE),
      });
      expect(toBase64Url(remade)).toBe(envelopeB64);
      expect(await verifyP256(fromBase64Url(signerPub), parsed.signature, envelopeSignatureInput(info(), parsed.body))).toBe(true);
      expect(toHex(await openEnvelope(parsed, info(), await privateKey(skHex)))).toBe(keyHex);
    });
  }

  it("group key envelope signature input", () => {
    const g = v.group_key_envelope;
    const parsed = parseEnvelope(fromBase64Url(g.envelope));
    expect(toHex(envelopeSignatureInput(fromHex(g.info), parsed.body))).toBe(g.signature_input);
  });

  it("sealed result: same bytes and opens", async () => {
    const s = v.sealed_result;
    expect(toHex(resultInfo(s.job_id, s.device_id))).toBe(s.info);
    const sealed = await sealResult({ jobId: s.job_id, deviceId: s.device_id, deviceBoxPub: fromBase64Url(s.device_box_pub), plaintext: utf8(s.plaintext_utf8), ekm: fromHex(s.ikm_e) });
    expect(toBase64Url(sealed)).toBe(s.sealed);
    const pt = await openResult(sealed, s.job_id, s.device_id, await privateKey(s.device_private_key));
    expect(new TextDecoder().decode(pt)).toBe(s.plaintext_utf8);
    await expect(openResult(sealed, "job_2", s.device_id, await privateKey(s.device_private_key))).rejects.toThrow();
  });

  it("recovery: wrap key, same blob, unwraps", async () => {
    const r = v.recovery;
    const ikm = await crypto.subtle.importKey("raw", fromHex(r.entropy), "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: context("recovery-key", r.user_id) }, ikm, 256);
    expect(toHex(new Uint8Array(bits))).toBe(r.wrap_key);
    expect(toHex(recoveryAad(r.user_id, r.account_device_id))).toBe(r.aad);
    const wrapKey = await recoveryWrapKey(fromHex(r.entropy), r.user_id);
    const blob = await wrapAccountKey({ wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id, accountKey: fromHex(r.account_key), nonce: fromHex(r.nonce) });
    expect(toBase64Url(blob)).toBe(r.blob);
    expect(toHex(await unwrapAccountKey(blob, wrapKey, r.user_id, r.account_device_id))).toBe(r.account_key);
    await expect(unwrapAccountKey(blob, wrapKey, "usr_2", r.account_device_id)).rejects.toThrow();
  });

  it("content: same bytes, unlocks, and the context is bound", async () => {
    const c = v.content;
    const ctx = context(c.context_label, ...c.context_fields);
    expect(toHex(ctx)).toBe(c.context);
    const key = await importContentKey(fromHex(c.key));
    const locked = await lockContent(key, c.key_version, ctx, utf8(c.plaintext_utf8), fromHex(c.nonce));
    expect(toBase64Url(locked)).toBe(c.locked);
    expect(new TextDecoder().decode(await unlockContent(key, ctx, locked))).toBe(c.plaintext_utf8);
    await expect(unlockContent(key, context(c.context_label, "grp_2", "dev_phone", "note"), locked)).rejects.toThrow();
    const otherVersion = concat(locked.slice(0, 4), new Uint8Array([4]), locked.slice(5));
    await expect(unlockContent(key, ctx, otherVersion)).rejects.toThrow();
  });

  it("link passcode hash", async () => {
    const l = v.link_passcode;
    expect(await linkPasscodeHash(fromHex(l.pepper), l.link_id, l.passcode)).toBe(l.hash);
  });
});
```

`test/formats.test.ts`, exactly:

```ts
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
```

What these cover, one line each:
- Every item in `waypoint-v1.json`: exact bytes for contexts, signing inputs, commitment, code, HPKE info, envelopes (with the vector's signature), sealed result, recovery wrap key and blob, locked content and link passcode hash; every signature verifies; envelopes, the sealed result, the recovery blob and the content open to the expected plaintext.
- A changed timestamp breaks the request signature; swapped nonces change the code; another job id, user id, group id or key version fails to open.
- `requestSigningInput` rejects each malformed part on its own.
- Pairing rejects 31-byte nonces and keys that are not P-256 points; codes are always 6 digits.
- `parseEnvelope` rejects each bad shape on its own; `makeEnvelope` rejects a wrong key length and a 63-byte signature; `groupKeyInfo` rejects version 0.
- A random sealed result opens only for the same job and device; over 4 MiB and bad ids are refused.
- `isRecoveryBlob` is true only for 93 bytes starting with `1`.

Not in this PR: anything in `apps/api`; the viewer (V1); BIP-39 words (they are turned into the 16 bytes on the device; the server never sees them).

---

## S1A · Migration, `BatchDb` and the device signature check

Branch `pr/s1a-signatures`. Builds on S0B. Merged after PR 31 and PR 18, whose migrations `0003` and `0004` come first; if PR 18 is not merged when you start, still name the file `0005_security.sql`. Files: `db/d1/migrations/0005_security.sql`, `db/d1/test/schema.test.mjs`, `apps/api/package.json`, `apps/api/src/storage.ts`, `apps/api/src/env.ts`, `apps/api/src/auth/signature.ts`, `apps/api/test/helpers/d1.ts`, `apps/api/test/helpers/signing.ts`, `apps/api/test/helpers.test.ts`, `apps/api/test/signature.test.ts`, `package-lock.json`. No other files.

Dependencies: add `"@waypoint/crypto": "0.0.0"` to `apps/api` `dependencies`.

`db/d1/migrations/0005_security.sql`, exactly:

```sql
-- Device keys, device pairing and signed requests (docs/security.md). Holds public keys, signatures,
-- commitments, nonces and wrapped (encrypted) keys only. Never a private key, never note content.

-- kind 'account' is the account key's row: one active row per user, never a phone.
ALTER TABLE devices ADD COLUMN kind TEXT NOT NULL DEFAULT 'device' CHECK (kind IN ('device', 'account'));
ALTER TABLE devices ADD COLUMN approved_at INTEGER;
ALTER TABLE devices ADD COLUMN approved_by TEXT;
-- The account key's signature over this device's keys (base64url). NULL for account rows and pending devices.
ALTER TABLE devices ADD COLUMN cert TEXT;
-- The account key wrapped for this device by the device that approved it (base64url envelope).
ALTER TABLE devices ADD COLUMN account_envelope TEXT;
CREATE UNIQUE INDEX devices_one_account ON devices (user_id) WHERE kind = 'account' AND removed_at IS NULL;

-- One row per device waiting for approval with the 6-digit code.
CREATE TABLE device_pairings (
  device_id TEXT NOT NULL PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  commitment TEXT NOT NULL,
  approver_id TEXT REFERENCES devices(id) ON DELETE CASCADE,
  approver_nonce TEXT,
  device_nonce TEXT,
  expires_at INTEGER NOT NULL
);

-- Nonces of signed requests, kept until the request's timestamp is out of the replay window.
CREATE TABLE request_nonces (
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, nonce)
);
CREATE INDEX request_nonces_expires_at ON request_nonces (expires_at);

-- The device a job's result is sealed to (S4). Set by POST /v1/jobs from the request signature.
ALTER TABLE jobs ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;
```

`db/d1/test/schema.test.mjs`: keep every test; change only this:
- `EXPECTED.devices` gains, after `removed_at`: `kind`, `approved_at`, `approved_by`, `cert`, `account_envelope`. `EXPECTED_TYPES.devices` gains `kind: "TEXT"`, `approved_at: "INTEGER?"`, `approved_by: "TEXT?"`, `cert: "TEXT?"`, `account_envelope: "TEXT?"`.
- `EXPECTED.jobs` gains `device_id` at the end; `EXPECTED_TYPES.jobs` gains `device_id: "TEXT?"`.
- New entries `device_pairings: ["device_id", "commitment", "approver_id", "approver_nonce", "device_nonce", "expires_at"]` (types `TEXT`, `TEXT`, `TEXT?`, `TEXT?`, `TEXT?`, `INTEGER`) and `request_nonces: ["device_id", "nonce", "expires_at"]` (types `TEXT`, `TEXT`, `INTEGER`).
- The table-count test keeps its name "creates exactly the expected tables" and has no fixed count (PR 31 removed it); adding the two tables to `EXPECTED` is enough.
- `REQUIRED_INDEXES` gains `["request_nonces", ["expires_at"]]`.
- New tests: `devices.kind` rejects `'other'`; a second active `kind = 'account'` row for the same user is rejected, and is allowed once the first has `removed_at` set; deleting a device deletes its `device_pairings` row; deleting a device sets `jobs.device_id` to NULL.

`apps/api/src/storage.ts`: add at the end, exactly:

```ts
// D1 with batch: the statements run in one transaction; if one fails, none is applied. D1Database satisfies this type.
export type BatchDb = Db & { batch(statements: DbStatement[]): Promise<unknown[]> };
```

`apps/api/test/helpers/d1.ts`: `createTestDb` returns `BatchDb` (import it instead of `Db`), and everything after the migration loop, to the end of the function, becomes exactly:

```ts
  const bound = new WeakMap<DbStatement, { query: string; values: SQLInputValue[] }>();
  const statement = (query: string, values: SQLInputValue[]): DbStatement => {
    const made: DbStatement = {
      bind: (...next) => statement(query, next.map(toInput)),
      first: async <T,>() => (db.prepare(query).get(...values) ?? null) as T | null,
      all: async <T,>() => ({ results: db.prepare(query).all(...values) as T[] }),
      run: async () => ({ meta: { changes: Number(db.prepare(query).run(...values).changes) } }),
    };
    bound.set(made, { query, values });
    return made;
  };
  return {
    prepare: (query) => statement(query, []),
    // Like D1's batch: one transaction, run without yielding; any failure rolls every statement back.
    batch: async (statements) => {
      const items = statements.map((item) => {
        const found = bound.get(item);
        if (found === undefined) throw new TypeError("statement is not from this database");
        return found;
      });
      db.exec("BEGIN");
      try {
        const results = items.map(({ query, values }) => ({ meta: { changes: Number(db.prepare(query).run(...values).changes) } }));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
```

(`batch` runs every statement synchronously inside `BEGIN`/`COMMIT`, so two awaited batches never interleave, like D1. Statements wrapped by a test, as in `idempotency-store.test.ts`, are not accepted by `batch`; those tests do not call it.)

`apps/api/test/helpers.test.ts`: add `export const d1BatchFits: (db: D1Database) => BatchDb = (db) => db;` next to `d1Fits`, and tests: a batch of two inserts commits both; a batch whose second statement violates a primary key rejects and leaves neither row; a statement from another `createTestDb()` makes `batch` throw `TypeError`.

`apps/api/src/env.ts`: import `type SignedDevice` from `./auth/signature.ts` and change `Variables` to `{ user: SessionUser; device: SignedDevice }`. Nothing else.

`apps/api/src/auth/signature.ts`, exactly:

```ts
import {
  bodySha256,
  decodePublicKey,
  DEVICE_HEADER,
  fromBase64Url,
  NONCE_HEADER,
  requestSigningInput,
  SIGNATURE_HEADER,
  SIGNATURE_WINDOW_MS,
  TIMESTAMP_HEADER,
  verifyP256,
} from "@waypoint/crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import type { Db } from "../storage.ts";

// The device (or account key row) that signed the request. Set by requireDeviceSignature.
export type SignedDevice = { id: string; user_id: string; kind: "device" | "account"; approved: boolean };

export type SignatureOptions = {
  // Let a device that is still waiting for approval through (only its own pairing reveal).
  allowPending?: boolean;
  // Let the account key's row sign (only POST /v1/devices/:id/approve, for recovery).
  allowAccount?: boolean;
};

type DeviceRow = { id: string; user_id: string; kind: "device" | "account"; sign_pub: string; approved_at: number | null; removed_at: number | null };

const failure = (): ApiFailure => new ApiFailure("unauthorized", "device signature required");

// Checks the Waypoint-* headers against signPub and records the nonce. Every failure is the same 401.
// Used by requireDeviceSignature and, with deviceId "new", by POST /v1/devices.
export async function checkSignature(c: Context<AppEnv>, db: Db, deviceId: string, signPub: string, now: number): Promise<void> {
  const timestampText = c.req.header(TIMESTAMP_HEADER) ?? "";
  const nonce = c.req.header(NONCE_HEADER) ?? "";
  const signatureText = c.req.header(SIGNATURE_HEADER) ?? "";
  if (!/^\d{1,16}$/.test(timestampText)) throw failure();
  const timestamp = Number(timestampText);
  if (Math.abs(now - timestamp) > SIGNATURE_WINDOW_MS) throw failure();
  const { pathname, search } = new URL(c.req.url);
  let ok = false;
  try {
    const input = requestSigningInput({
      method: c.req.method,
      target: pathname + search,
      deviceId,
      timestamp,
      nonce,
      bodySha256: await bodySha256(new Uint8Array(await c.req.arrayBuffer())),
    });
    ok = await verifyP256(decodePublicKey(signPub), fromBase64Url(signatureText), input);
  } catch {
    ok = false;
  }
  if (!ok) throw failure();
  // Only after a good signature, so nobody can use up another device's nonces.
  await db.prepare("DELETE FROM request_nonces WHERE device_id = ? AND expires_at < ?").bind(deviceId, now).run();
  const inserted = await db
    .prepare("INSERT INTO request_nonces (device_id, nonce, expires_at) VALUES (?, ?, ?) ON CONFLICT (device_id, nonce) DO NOTHING")
    .bind(deviceId, nonce, timestamp + SIGNATURE_WINDOW_MS)
    .run();
  if (inserted.meta.changes !== 1) throw failure();
}

export function requireDeviceSignature(deps: { now: () => number }, options: SignatureOptions = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const deviceId = c.req.header(DEVICE_HEADER) ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) throw failure();
    const row = await c.env.DB.prepare(
      "SELECT id, user_id, kind, sign_pub, approved_at, removed_at FROM devices WHERE id = ?",
    )
      .bind(deviceId)
      .first<DeviceRow>();
    const user = c.get("user");
    if (row === null || row.user_id !== user.id || row.removed_at !== null) throw failure();
    if (row.kind === "account" && options.allowAccount !== true) throw failure();
    if (row.approved_at === null && options.allowPending !== true) throw failure();
    await checkSignature(c, c.env.DB, row.id, row.sign_pub, deps.now());
    c.set("device", { id: row.id, user_id: row.user_id, kind: row.kind, approved: row.approved_at !== null });
    await next();
  };
}
```

How routes use it (later cards): `requireDeviceSignature(deps, options)` goes on the route, before `idempotent(deps)` from PR 11, so a retry with a fresh signature still gets the stored reply. It is never registered with `app.use`; each route opts in. The one exception is S1E, which adds it in `createApp` for four routes merged before this card, so their route files and tests stay as they are.

`apps/api/test/helpers/signing.ts`, exactly (later cards reuse it and must not write their own):

```ts
import {
  bodySha256,
  DEVICE_HEADER,
  HPKE_SUITE,
  NONCE_HEADER,
  requestSigningInput,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  toBase64Url,
  utf8,
} from "@waypoint/crypto";
import type { Db } from "../../src/storage.ts";

// A device with software keys, standing in for the iPhone's Secure Enclave keys.
export type TestDevice = {
  id: string;
  signPub: string;
  boxPub: string;
  boxPrivate: CryptoKey;
  sign(message: Uint8Array): Promise<Uint8Array>;
};

export async function makeTestDevice(id: string): Promise<TestDevice> {
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  if (!("privateKey" in signing)) throw new Error("expected a key pair");
  const box = await HPKE_SUITE.kem.generateKeyPair();
  const signPub = new Uint8Array((await crypto.subtle.exportKey("raw", signing.publicKey)) as ArrayBuffer);
  const boxPub = new Uint8Array(await HPKE_SUITE.kem.serializePublicKey(box.publicKey));
  return {
    id,
    signPub: toBase64Url(signPub),
    boxPub: toBase64Url(boxPub),
    boxPrivate: box.privateKey,
    sign: async (message) =>
      new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signing.privateKey, message)),
  };
}

let nonceCounter = 0;
export function freshNonce(): string {
  nonceCounter += 1;
  const bytes = new Uint8Array(16);
  new DataView(bytes.buffer).setUint32(12, nonceCounter);
  return toBase64Url(bytes);
}

// Builds a signed request. `as` overrides the Waypoint-Device header (for example "new" when registering).
export async function signedInit(
  device: TestDevice,
  request: { method: string; path: string; body?: unknown; now: number; nonce?: string; as?: string; idempotencyKey?: string },
): Promise<RequestInit> {
  const bodyText = request.body === undefined ? "" : JSON.stringify(request.body);
  const nonce = request.nonce ?? freshNonce();
  const deviceId = request.as ?? device.id;
  const input = requestSigningInput({
    method: request.method,
    target: request.path,
    deviceId,
    timestamp: request.now,
    nonce,
    bodySha256: await bodySha256(utf8(bodyText)),
  });
  const headers: Record<string, string> = {
    [DEVICE_HEADER]: deviceId,
    [TIMESTAMP_HEADER]: String(request.now),
    [NONCE_HEADER]: nonce,
    [SIGNATURE_HEADER]: toBase64Url(await device.sign(input)),
    "Idempotency-Key": request.idempotencyKey ?? `idem-${nonce}`,
  };
  if (bodyText !== "") headers["Content-Type"] = "application/json";
  return bodyText === "" ? { method: request.method, headers } : { method: request.method, headers, body: bodyText };
}

// Inserts a device row directly. approvedAt null makes it pending.
export async function insertDevice(
  db: Db,
  device: TestDevice,
  row: { userId: string; kind?: "device" | "account"; approvedAt?: number | null; removedAt?: number | null; cert?: string | null },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, removed_at, kind, approved_at, cert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      device.id,
      row.userId,
      row.kind === "account" ? "Account key" : "Test phone",
      row.kind === "account" ? "account" : "ios",
      device.signPub,
      device.boxPub,
      row.approvedAt === null ? 0 : 1,
      1,
      row.removedAt ?? null,
      row.kind ?? "device",
      row.approvedAt === undefined ? 1 : row.approvedAt,
      row.cert ?? null,
    )
    .run();
}
```

Tests (`apps/api/test/signature.test.ts`), a fresh app with a throwaway `POST /v1/x` route behind `requireDeviceSignature({ now: () => NOW }, options)` that returns `c.get("device")` and the JSON body:
- a good signature reaches the route; `c.get("device")` is `{ id, user_id, kind: "device", approved: true }`; the handler can still read the body;
- the same nonce twice → second is 401;
- timestamps 300,000 ms early and late pass; 300,001 ms early and late fail;
- a changed body, another path, another method each fail;
- a key that is not the stored one, an unknown device, another user's device and a removed device each fail;
- a pending device and the account row fail by default and pass with `allowPending` / `allowAccount`;
- each of the four headers missing fails; a signature that is not base64url fails; a 3-character nonce fails; every failure body is exactly `{ code: "unauthorized", message: "device signature required", retry_after: null }`;
- a request with a bad signature does not store its nonce (the same nonce then works with the right key);
- an expired nonce row of that device is deleted by the next good request;
- no row of `request_nonces` holds the signature or the body (check every column of every row against both).

Not in this PR: any route using the middleware (S1B onward), cleanup of `request_nonces` by cron (PR 33 adds `DELETE FROM request_nonces WHERE expires_at < ?` to its cron).

---

## S1B · `POST /v1/devices` and `GET /v1/devices`

Branch `pr/s1b-devices`. Builds on S1A. Files: `packages/contracts/src/keys.ts` (new), `packages/contracts/src/index.ts` (one line), `packages/contracts/test/keys.test.ts` (new), `apps/api/src/devices/view.ts`, `apps/api/src/devices/register.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/devices.test.ts`. No other files. No new dependencies.

`packages/contracts/src/keys.ts`, exactly (later cards append to this file):

```ts
import { z } from "zod";

// Request and reply shapes for devices, group keys and recovery (docs/security.md). Byte strings are base64url
// without padding; the lengths below are the encoded lengths.
export const KeyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const PublicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{87}$/); // 65-byte SEC1 uncompressed P-256 point
export const SignatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/); // 64-byte ECDSA r || s
export const Bytes32Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/); // 32 bytes: pairing nonces and commitments
export const EnvelopeTextSchema = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/);

export const RegisterDeviceRequestSchema = z
  .strictObject({
    id: KeyIdSchema,
    name: z.string().min(1).max(64),
    platform: z.literal("ios"),
    sign_pub: PublicKeySchema,
    box_pub: PublicKeySchema,
    commitment: Bytes32Schema.optional(),
    account: z.strictObject({ id: KeyIdSchema, sign_pub: PublicKeySchema, box_pub: PublicKeySchema, cert: SignatureSchema }).optional(),
  })
  .refine((r) => (r.commitment === undefined) !== (r.account === undefined), {
    message: "send commitment (a new device) or account (the first device), not both",
  });
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequestSchema>;

export const DeviceViewSchema = z.strictObject({
  id: KeyIdSchema,
  kind: z.enum(["device", "account"]),
  name: z.string(),
  platform: z.string(),
  sign_pub: PublicKeySchema,
  box_pub: PublicKeySchema,
  cert: SignatureSchema.nullable(),
  account_envelope: EnvelopeTextSchema.nullable(),
  added_at: z.number().int(),
  approved_at: z.number().int().nullable(),
  approved_by: KeyIdSchema.nullable(),
});
export type DeviceView = z.infer<typeof DeviceViewSchema>;

export const DeviceListSchema = z.strictObject({ devices: z.array(DeviceViewSchema) });
```

`packages/contracts/src/index.ts`: add `export * from "./keys.ts";`.

`apps/api/src/devices/view.ts`, exactly:

```ts
import type { DeviceView } from "@waypoint/contracts";

export const DEVICE_COLUMNS = "id, kind, name, platform, sign_pub, box_pub, cert, account_envelope, added_at, approved_at, approved_by";
export type DeviceRow = DeviceView;
```

`apps/api/src/devices/register.ts`, exactly:

```ts
import { RegisterDeviceRequestSchema, type DeviceView } from "@waypoint/contracts";
import { decodePublicKey, deviceCertificateInput, fromBase64Url, importBoxKey, importVerifyKey, NEW_DEVICE, verifyP256 } from "@waypoint/crypto";
import { Hono } from "hono";
import { checkSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { DEVICE_COLUMNS } from "./view.ts";

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const MAX_WAITING_DEVICES = 3;

export function devicesRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .post("/v1/devices", idempotent(deps), async (c) => {
      const user = c.get("user");
      const db = c.env.DB;
      const now = deps.now();
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = RegisterDeviceRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      // Both keys must be points on P-256; importing checks that.
      try {
        await importVerifyKey(decodePublicKey(req.sign_pub));
        await importBoxKey(decodePublicKey(req.box_pub));
        if (req.account !== undefined) {
          await importVerifyKey(decodePublicKey(req.account.sign_pub));
          await importBoxKey(decodePublicKey(req.account.box_pub));
        }
      } catch {
        throw new ApiFailure("bad_request", "invalid request");
      }
      await checkSignature(c, db, NEW_DEVICE, req.sign_pub, now);
      const account = await db
        .prepare("SELECT id FROM devices WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL")
        .bind(user.id)
        .first<{ id: string }>();
      const insertDevice =
        "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, kind, approved_at, approved_by, cert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
      const statements = [];
      if (req.account !== undefined) {
        if (account !== null) throw new ApiFailure("conflict", "account key already set");
        let certOk = false;
        try {
          certOk = await verifyP256(
            decodePublicKey(req.account.sign_pub),
            fromBase64Url(req.account.cert),
            deviceCertificateInput(user.id, req.id, req.sign_pub, req.box_pub),
          );
        } catch {
          certOk = false;
        }
        if (!certOk || req.account.id === req.id) throw new ApiFailure("bad_request", "invalid certificate");
        statements.push(
          db.prepare(insertDevice).bind(req.account.id, user.id, "Account key", "account", req.account.sign_pub, req.account.box_pub, 1, now, "account", now, null, null),
          db.prepare(insertDevice).bind(req.id, user.id, req.name, req.platform, req.sign_pub, req.box_pub, 1, now, "device", now, req.account.id, req.account.cert),
        );
      } else {
        if (account === null) throw new ApiFailure("conflict", "no account key yet");
        const waiting = await db
          .prepare(
            "SELECT count(*) AS n FROM devices d JOIN device_pairings p ON p.device_id = d.id WHERE d.user_id = ? AND d.approved_at IS NULL AND d.removed_at IS NULL AND p.expires_at > ?",
          )
          .bind(user.id, now)
          .first<{ n: number }>();
        if ((waiting?.n ?? 0) >= MAX_WAITING_DEVICES) throw new ApiFailure("rate_limited", "too many devices waiting", 600);
        statements.push(
          db.prepare(insertDevice).bind(req.id, user.id, req.name, req.platform, req.sign_pub, req.box_pub, 0, now, "device", null, null, null),
          db.prepare("INSERT INTO device_pairings (device_id, commitment, expires_at) VALUES (?, ?, ?)").bind(req.id, req.commitment ?? "", now + PAIRING_TTL_MS),
        );
      }
      try {
        await db.batch(statements);
      } catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) throw new ApiFailure("conflict", "device id taken");
        throw error;
      }
      const device = await db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = ?`).bind(req.id).first<DeviceView>();
      return c.json({ device }, 201);
    })
    .get("/v1/devices", async (c) => {
      const rows = await c.env.DB.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = ? AND removed_at IS NULL ORDER BY added_at, id`)
        .bind(c.get("user").id)
        .all<DeviceView>();
      return c.json({ devices: rows.results });
    });
}
```

What it does (for review): `POST /v1/devices` checks the body, then the request signature with device id `"new"` and the `sign_pub` from the body (proof the caller holds the key). With `account` it is the first device: allowed only when the user has no active account row; the certificate must verify under `account.sign_pub`; both rows are inserted in one batch, approved. With `commitment` it is a new device: the user must already have an account row; at most 3 devices may be waiting with a live pairing (else 429, `retry_after` 600); the device is inserted waiting, with a `device_pairings` row that expires in 10 minutes. A taken id is 409. Note the order here is `idempotent` then the signature check (there is no device row to look up before the body is read); a replayed reply is the public device row only.

`apps/api/src/app.ts`: `import { devicesRoute } from "./devices/register.ts";` and, under "Routes go below this line", `app.route("/", devicesRoute({ now: deps.now }));`.

Tests (`packages/contracts/test/keys.test.ts`): a first-device body and a new-device body parse; both `commitment` and `account` fails; neither fails; an 86-character `sign_pub` fails; `platform: "android"` fails; an extra key fails; `DeviceViewSchema` accepts a pending row (nulls) and an approved one.

Tests (`apps/api/test/devices.test.ts`), with `makeTestDevice`, `signedInit` (`as: "new"`) and a seeded user:
- first device: 201; the reply passes `DeviceViewSchema`; D1 has the account row (`kind 'account'`, approved) and the device (approved, `approved_by` the account id, `cert` stored, `can_approve` 1);
- first device with a certificate signed by another key → 400 "invalid certificate", no rows; with `account.id` equal to `id` → 400;
- first device when the user already has an account row → 409, no new rows;
- new device after the first: 201, `approved_at` null, a `device_pairings` row with the commitment and `expires_at` NOW + 600,000;
- new device when the user has no account row → 409;
- a fourth waiting device → 429 with `retry_after` 600; with one of the three pairings expired, it is accepted;
- a taken device id (any user) → 409;
- the body signed by a key that is not `sign_pub` → 401; a `sign_pub` that is not on the curve → 400;
- a replay with the same `Idempotency-Key` and a fresh signature returns the stored 201 without a second row;
- `GET /v1/devices` lists the user's non-removed rows ordered by `added_at` then `id`, passes `DeviceListSchema`, and does not list another user's or a removed device;
- through `createApp`, `POST /v1/devices` without a session is 401.

Not in this PR: pairing and approval (S1C), removal (S1D), push to the user's other devices (S1F adds it to this route).

---

## S1C · Pairing with the 6-digit code, and approval

Branch `pr/s1c-pairing`. Builds on S1B. Files: `packages/contracts/src/keys.ts` (append), `packages/contracts/test/keys.test.ts` (add), `apps/api/src/keys/envelopes.ts`, `apps/api/src/devices/pairing.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/pairing.test.ts`. No other files. No new dependencies.

`packages/contracts/src/keys.ts`: append, exactly:

```ts
// S1C: pairing and approval.
export const PairingNonceRequestSchema = z.strictObject({ nonce: Bytes32Schema });
export const PairingViewSchema = z.strictObject({
  device_id: KeyIdSchema,
  commitment: Bytes32Schema,
  expires_at: z.number().int(),
  approver: z.strictObject({ id: KeyIdSchema, sign_pub: PublicKeySchema }).nullable(),
  approver_nonce: Bytes32Schema.nullable(),
  device_nonce: Bytes32Schema.nullable(),
});
export type PairingView = z.infer<typeof PairingViewSchema>;

export const GroupEnvelopeSchema = z.strictObject({
  group_id: KeyIdSchema,
  key_version: z.number().int().min(1),
  wrapped_key: EnvelopeTextSchema,
});
export const ApproveDeviceRequestSchema = z.strictObject({
  cert: SignatureSchema,
  account_envelope: EnvelopeTextSchema,
  envelopes: z.array(GroupEnvelopeSchema).max(500),
});
```

`apps/api/src/keys/envelopes.ts`, exactly:

```ts
import { fromBase64Url, parseEnvelope, type EnvelopePurpose } from "@waypoint/crypto";
import { ApiFailure } from "../errors.ts";

// The server only checks an envelope's shape and that the device that signed the request wrapped it.
// Recipients verify the signature and the signer's certificate (docs/security.md, section 9).
export function checkEnvelope(wrappedKey: string, purpose: EnvelopePurpose, signerId: string): void {
  let ok = false;
  try {
    const parsed = parseEnvelope(fromBase64Url(wrappedKey));
    ok = parsed.purpose === purpose && parsed.signerId === signerId;
  } catch {
    ok = false;
  }
  if (!ok) throw new ApiFailure("bad_request", "invalid envelope");
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
```

`apps/api/src/devices/pairing.ts`, exactly:

```ts
import {
  ApproveDeviceRequestSchema,
  PairingNonceRequestSchema,
  type DeviceView,
  type PairingView,
} from "@waypoint/contracts";
import {
  decodePublicKey,
  deviceCertificateInput,
  fromBase64Url,
  pairingCommitment,
  PURPOSE_ACCOUNT_KEY,
  PURPOSE_GROUP_KEY,
  verifyP256,
} from "@waypoint/crypto";
import { Hono, type Context } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { checkEnvelope, isUniqueViolation } from "../keys/envelopes.ts";
import type { Db } from "../storage.ts";
import { DEVICE_COLUMNS } from "./view.ts";

type Target = { id: string; sign_pub: string; box_pub: string; approved_at: number | null };
type PairingRow = { device_id: string; commitment: string; approver_id: string | null; approver_nonce: string | null; device_nonce: string | null; expires_at: number };

async function readJson<T>(c: Context<AppEnv>, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
  const body: unknown = await c.req.json().catch(() => {
    throw new ApiFailure("bad_request", "invalid request");
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
  return parsed.data;
}

// A device of this user that is waiting for approval, or 404.
async function waitingDevice(db: Db, userId: string, deviceId: string): Promise<Target> {
  const row = await db
    .prepare("SELECT id, sign_pub, box_pub, approved_at FROM devices WHERE id = ? AND user_id = ? AND kind = 'device' AND removed_at IS NULL")
    .bind(deviceId, userId)
    .first<Target>();
  if (row === null) throw new ApiFailure("not_found", "no such device");
  if (row.approved_at !== null) throw new ApiFailure("conflict", "device already approved");
  return row;
}

async function livePairing(db: Db, deviceId: string, now: number): Promise<PairingRow> {
  const row = await db
    .prepare("SELECT device_id, commitment, approver_id, approver_nonce, device_nonce, expires_at FROM device_pairings WHERE device_id = ?")
    .bind(deviceId)
    .first<PairingRow>();
  if (row === null) throw new ApiFailure("not_found", "no pairing for this device");
  if (row.expires_at <= now) throw new ApiFailure("conflict", "pairing expired");
  return row;
}

async function pairingView(db: Db, deviceId: string): Promise<PairingView> {
  const row = await db
    .prepare(
      "SELECT p.device_id, p.commitment, p.expires_at, p.approver_id, a.sign_pub AS approver_sign_pub, p.approver_nonce, p.device_nonce FROM device_pairings p LEFT JOIN devices a ON a.id = p.approver_id WHERE p.device_id = ?",
    )
    .bind(deviceId)
    .first<PairingRow & { approver_sign_pub: string | null }>();
  if (row === null) throw new ApiFailure("not_found", "no pairing for this device");
  return {
    device_id: row.device_id,
    commitment: row.commitment,
    expires_at: row.expires_at,
    approver: row.approver_id === null || row.approver_sign_pub === null ? null : { id: row.approver_id, sign_pub: row.approver_sign_pub },
    approver_nonce: row.approver_nonce,
    device_nonce: row.device_nonce,
  };
}

export function pairingRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .get("/v1/devices/:id/pairing", async (c) => {
      const db = c.env.DB;
      const device = await db
        .prepare("SELECT id FROM devices WHERE id = ? AND user_id = ? AND removed_at IS NULL")
        .bind(c.req.param("id"), c.get("user").id)
        .first<{ id: string }>();
      if (device === null) throw new ApiFailure("not_found", "no such device");
      return c.json(await pairingView(db, device.id));
    })
    .post("/v1/devices/:id/pairing", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const now = deps.now();
      const { nonce } = await readJson(c, PairingNonceRequestSchema);
      const target = await waitingDevice(db, c.get("user").id, c.req.param("id"));
      const approver = c.get("device");
      if (approver.id === target.id) throw new ApiFailure("forbidden", "a device cannot approve itself");
      await livePairing(db, target.id, now);
      const updated = await db
        .prepare("UPDATE device_pairings SET approver_id = ?, approver_nonce = ? WHERE device_id = ? AND approver_nonce IS NULL")
        .bind(approver.id, nonce, target.id)
        .run();
      if (updated.meta.changes !== 1) throw new ApiFailure("conflict", "pairing already started");
      return c.json(await pairingView(db, target.id));
    })
    .post("/v1/devices/:id/pairing/reveal", requireDeviceSignature(deps, { allowPending: true }), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const now = deps.now();
      const { nonce } = await readJson(c, PairingNonceRequestSchema);
      const target = await waitingDevice(db, c.get("user").id, c.req.param("id"));
      if (c.get("device").id !== target.id) throw new ApiFailure("forbidden", "only the new device can reveal");
      const pairing = await livePairing(db, target.id, now);
      if (pairing.approver_nonce === null) throw new ApiFailure("conflict", "no approver yet");
      if (pairing.device_nonce !== null) throw new ApiFailure("conflict", "already revealed");
      if ((await pairingCommitment(target.sign_pub, target.box_pub, nonce)) !== pairing.commitment) {
        // One try only: a wrong reveal ends the pairing; the new device must register again.
        await db.prepare("DELETE FROM device_pairings WHERE device_id = ?").bind(target.id).run();
        throw new ApiFailure("conflict", "nonce does not match the commitment");
      }
      const updated = await db
        .prepare("UPDATE device_pairings SET device_nonce = ? WHERE device_id = ? AND device_nonce IS NULL")
        .bind(nonce, target.id)
        .run();
      if (updated.meta.changes !== 1) throw new ApiFailure("conflict", "already revealed");
      return c.json(await pairingView(db, target.id));
    })
    .post("/v1/devices/:id/approve", requireDeviceSignature(deps, { allowAccount: true }), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const signer = c.get("device");
      const req = await readJson(c, ApproveDeviceRequestSchema);
      const target = await waitingDevice(db, user.id, c.req.param("id"));
      if (signer.kind === "device") {
        const pairing = await livePairing(db, target.id, now);
        if (pairing.approver_id !== signer.id || pairing.approver_nonce === null || pairing.device_nonce === null) {
          throw new ApiFailure("conflict", "pairing not finished");
        }
      }
      const account = await db
        .prepare("SELECT sign_pub FROM devices WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL")
        .bind(user.id)
        .first<{ sign_pub: string }>();
      if (account === null) throw new ApiFailure("conflict", "no account key yet");
      let certOk = false;
      try {
        certOk = await verifyP256(
          decodePublicKey(account.sign_pub),
          fromBase64Url(req.cert),
          deviceCertificateInput(user.id, target.id, target.sign_pub, target.box_pub),
        );
      } catch {
        certOk = false;
      }
      if (!certOk) throw new ApiFailure("bad_request", "invalid certificate");
      checkEnvelope(req.account_envelope, PURPOSE_ACCOUNT_KEY, signer.id);
      const seen = new Set<string>();
      for (const envelope of req.envelopes) {
        const pair = `${envelope.group_id}/${envelope.key_version}`;
        if (seen.has(pair)) throw new ApiFailure("bad_request", "invalid request");
        seen.add(pair);
        checkEnvelope(envelope.wrapped_key, PURPOSE_GROUP_KEY, signer.id);
        // Only groups the user is in, and only versions whose key already exists (first sets go through S2).
        const ok = await db
          .prepare(
            "SELECT 1 AS ok FROM groups g JOIN memberships m ON m.group_id = g.id AND m.user_id = ? AND m.left_at IS NULL WHERE g.id = ? AND ? <= g.key_version AND EXISTS (SELECT 1 FROM key_envelopes e WHERE e.group_id = g.id AND e.key_version = ?)",
          )
          .bind(user.id, envelope.group_id, envelope.key_version, envelope.key_version)
          .first<{ ok: number }>();
        if (ok === null) throw new ApiFailure("conflict", "unknown group or key version");
      }
      const statements = [
        db
          .prepare(
            "UPDATE devices SET approved_at = ?, approved_by = ?, can_approve = 1, cert = ?, account_envelope = ? WHERE id = ? AND approved_at IS NULL AND removed_at IS NULL",
          )
          .bind(now, signer.id, req.cert, req.account_envelope, target.id),
        ...req.envelopes.map((e) =>
          db.prepare("INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) VALUES (?, ?, ?, ?)").bind(e.group_id, e.key_version, target.id, e.wrapped_key),
        ),
        db.prepare("DELETE FROM device_pairings WHERE device_id = ?").bind(target.id),
      ];
      try {
        await db.batch(statements);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "device already has a key for this version");
        throw error;
      }
      const device = await db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = ?`).bind(target.id).first<DeviceView>();
      return c.json({ device });
    });
}
```

The protocol is `docs/security.md` section 8. What the server enforces: only an approved device of the same user can start a pairing, once, while it is live; only the waiting device can reveal, once, after the approver's nonce is in, and a nonce that does not match the commitment ends the pairing; approval needs a finished pairing started by the signing device, unless the account key row signs (recovery); the certificate must verify under the user's active account key; the account-key envelope (purpose 2) and every group-key envelope (purpose 1) must be signed by the signing device; group envelopes only for groups the user is a current member of and versions that already have envelopes (first sets go through S2).

`apps/api/src/app.ts`: `import { pairingRoutes } from "./devices/pairing.ts";` and `app.route("/", pairingRoutes({ now: deps.now }));`.

Tests (`packages/contracts/test/keys.test.ts`, add): `PairingNonceRequestSchema` takes 43 characters and refuses 42; `ApproveDeviceRequestSchema` refuses 501 envelopes and `key_version: 0`.

Tests (`apps/api/test/pairing.test.ts`). Set up with `insertDevice` (an account row `acct_1`, an approved phone), a group `g1` (key version 1, the user a member, one existing envelope row for the phone), then register the iPad through `POST /v1/devices` with a commitment to a known nonce. Mount `devicesRoute` and `pairingRoutes`. Cases:
- the whole flow: phone starts the pairing (200, view shows the phone as approver), iPad reveals (200), `pairingCode` computed from the iPad's view and from the phone's own values are equal; phone approves with a certificate from `acct_1`, an account envelope and a group envelope made with `makeEnvelope` → 200; the iPad row is approved with `approved_by` the phone, `cert` and `account_envelope` stored; its envelope row exists; the pairing row is gone; the reply passes `DeviceViewSchema`;
- `GET .../pairing` for another user's device → 404; for a device with no pairing → 404;
- start: by the iPad itself → 403; twice → second 409; after expiry (`now` past `expires_at`) → 409; for an approved device → 409; signed by a pending device → 401;
- reveal: before the approver's nonce → 409; signed by the phone → 403; a wrong nonce → 409 and the pairing row is deleted; twice → 409;
- approve: before the reveal → 409; by a device that did not start the pairing → 409; certificate signed by another key → 400; account envelope with purpose 1 → 400; an envelope whose signer id is not the signing device → 400; a group the user is not in → 409; a version above `groups.key_version` → 409; a version with no envelopes yet → 409; the same group and version twice → 400; nothing is written in any of these cases;
- recovery: with no pairing at all, approve signed by the account row (`Waypoint-Device: acct_1`, envelopes signed by `acct_1`) → 200;
- every route above except `GET` needs a signature: without one → 401.

Not in this PR: removal (S1D), group key first sets (S2), push notices (S1F).

---

## S1D · `DELETE /v1/devices/:id`

Branch `pr/s1d-remove-device`. Builds on S1C. Files: `packages/contracts/src/keys.ts` (append), `packages/contracts/test/keys.test.ts` (add), `apps/api/src/devices/remove.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/remove-device.test.ts`. No other files. No new dependencies.

`packages/contracts/src/keys.ts`: append, exactly:

```ts
// S1D: removing a device.
export const RemoveDeviceRequestSchema = z.union([
  z.strictObject({}),
  z.strictObject({
    account: z.strictObject({ id: KeyIdSchema, sign_pub: PublicKeySchema, box_pub: PublicKeySchema }),
    devices: z.array(z.strictObject({ id: KeyIdSchema, cert: SignatureSchema, account_envelope: EnvelopeTextSchema })).min(1).max(50),
  }),
]);
export const RemoveDeviceResponseSchema = z.strictObject({ removed: KeyIdSchema, account_id: KeyIdSchema.nullable() });
```

`apps/api/src/devices/remove.ts`, exactly:

```ts
import { RemoveDeviceRequestSchema } from "@waypoint/contracts";
import { decodePublicKey, deviceCertificateInput, fromBase64Url, importBoxKey, importVerifyKey, PURPOSE_ACCOUNT_KEY, verifyP256 } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { checkEnvelope, isUniqueViolation } from "../keys/envelopes.ts";

type Row = { id: string; sign_pub: string; box_pub: string; approved_at: number | null };

// Every group the user is in gets a new key version (docs/security.md, sections 10 and 12).
export const BUMP_USER_GROUPS_SQL =
  "UPDATE groups SET key_version = key_version + 1 WHERE id IN (SELECT group_id FROM memberships WHERE user_id = ? AND left_at IS NULL)";

export function removeDeviceRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>().delete("/v1/devices/:id", requireDeviceSignature(deps), idempotent(deps), async (c) => {
    const db = c.env.DB;
    const now = deps.now();
    const user = c.get("user");
    const caller = c.get("device");
    const text = await c.req.text();
    let body: unknown = {};
    try {
      body = text === "" ? {} : JSON.parse(text);
    } catch {
      throw new ApiFailure("bad_request", "invalid request");
    }
    const parsed = RemoveDeviceRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
    const req = parsed.data;

    const target = await db
      .prepare("SELECT id, sign_pub, box_pub, approved_at FROM devices WHERE id = ? AND user_id = ? AND kind = 'device' AND removed_at IS NULL")
      .bind(c.req.param("id"), user.id)
      .first<Row>();
    if (target === null) throw new ApiFailure("not_found", "no such device");

    const markRemoved = db.prepare("UPDATE devices SET removed_at = ? WHERE id = ?").bind(now, target.id);
    const dropPairing = db.prepare("DELETE FROM device_pairings WHERE device_id = ?").bind(target.id);

    if (target.approved_at === null) {
      if ("account" in req) throw new ApiFailure("bad_request", "invalid request");
      await db.batch([markRemoved, dropPairing]);
      return c.json({ removed: target.id, account_id: null });
    }

    const remaining = (
      await db
        .prepare(
          "SELECT id, sign_pub, box_pub, approved_at FROM devices WHERE user_id = ? AND kind = 'device' AND removed_at IS NULL AND approved_at IS NOT NULL AND id != ? ORDER BY id",
        )
        .bind(user.id, target.id)
        .all<Row>()
    ).results;
    const bump = db.prepare(BUMP_USER_GROUPS_SQL).bind(user.id);

    if (remaining.length === 0) {
      // The last device removing itself: nobody would hold a new account key, so nothing is rotated.
      if ("account" in req) throw new ApiFailure("bad_request", "invalid request");
      await db.batch([markRemoved, bump]);
      return c.json({ removed: target.id, account_id: null });
    }

    if (!("account" in req)) throw new ApiFailure("bad_request", "new account key required");
    const sent = new Map(req.devices.map((d) => [d.id, d]));
    if (sent.size !== req.devices.length || sent.size !== remaining.length || remaining.some((d) => !sent.has(d.id))) {
      throw new ApiFailure("conflict", "certificates must cover every remaining device");
    }
    let newSignPub: Uint8Array;
    try {
      newSignPub = decodePublicKey(req.account.sign_pub);
      await importVerifyKey(newSignPub);
      await importBoxKey(decodePublicKey(req.account.box_pub));
    } catch {
      throw new ApiFailure("bad_request", "invalid request");
    }
    const updates = [];
    for (const device of remaining) {
      const entry = sent.get(device.id);
      if (entry === undefined) throw new ApiFailure("conflict", "certificates must cover every remaining device");
      let certOk = false;
      try {
        certOk = await verifyP256(newSignPub, fromBase64Url(entry.cert), deviceCertificateInput(user.id, device.id, device.sign_pub, device.box_pub));
      } catch {
        certOk = false;
      }
      if (!certOk) throw new ApiFailure("bad_request", "invalid certificate");
      checkEnvelope(entry.account_envelope, PURPOSE_ACCOUNT_KEY, caller.id);
      updates.push(db.prepare("UPDATE devices SET cert = ?, account_envelope = ? WHERE id = ?").bind(entry.cert, entry.account_envelope, device.id));
    }
    const statements = [
      markRemoved,
      db.prepare("UPDATE devices SET removed_at = ? WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL").bind(now, user.id),
      db
        .prepare(
          "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, kind, approved_at, approved_by) VALUES (?, ?, 'Account key', 'account', ?, ?, 1, ?, 'account', ?, ?)",
        )
        .bind(req.account.id, user.id, req.account.sign_pub, req.account.box_pub, now, now, caller.id),
      ...updates,
      bump,
      db.prepare("DELETE FROM recovery WHERE user_id = ?").bind(user.id),
    ];
    try {
      await db.batch(statements);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiFailure("conflict", "account key id taken");
      throw error;
    }
    return c.json({ removed: target.id, account_id: req.account.id });
  });
}
```

The rules are `docs/security.md` section 12: a waiting device is just removed; removing an approved device needs a new account key and a new certificate and account-key envelope for every remaining approved device, and in one batch removes the device and the old account row, adds the new account row, stores the certificates, bumps every group the user is in and deletes the recovery blob; the last device removing itself rotates nothing but still bumps the groups.

`apps/api/src/app.ts`: `import { removeDeviceRoute } from "./devices/remove.ts";` and `app.route("/", removeDeviceRoute({ now: deps.now }));`.

Tests (`packages/contracts/test/keys.test.ts`, add): `{}` and a full rotation body parse; `account` without `devices` fails; `devices: []` fails.

Tests (`apps/api/test/remove-device.test.ts`), with an account row, two approved devices (phone, iPad), the user in two groups and another user's group, and a recovery row:
- phone removes the iPad with a new account key: 200 `{ removed: "dev_ipad", account_id: "acct_2" }`; the iPad and `acct_1` have `removed_at`; `acct_2` is an active account row approved by the phone; the phone's `cert` and `account_envelope` are the new ones; both of the user's groups have `key_version` 2 and the other user's group 1; the recovery row is gone;
- the removed iPad's signature is refused afterwards (401 on any signed route);
- a body missing the phone's certificate, or with an extra device, → 409 and nothing changes;
- a certificate signed by the old account key → 400; an account envelope signed by another device id → 400; `{}` when devices remain → 400;
- an `account.id` that is already taken → 409 and nothing changes;
- removing a waiting device with `{}` → 200, its pairing row is gone, groups are not bumped; with an account body → 400;
- the last device removing itself with `{}` → 200, groups bumped, account row and recovery kept;
- another user's device, the account row, an unknown id → 404;
- an empty request body counts as `{}`; invalid JSON → 400;
- without a signature → 401.

Not in this PR: revoking the removed device's Clerk session (open question R13), deleting the device's push token (S1F), the new recovery key prompt (iOS), envelopes of old group versions for the new account row (the device posts them with S2).

---

## S2 · Group key envelopes and `POST /v1/groups/:id/keys`

Branch `pr/s2-group-keys`. Builds on S1C (uses `src/keys/envelopes.ts`). Files: `packages/contracts/src/keys.ts` (append), `packages/contracts/test/keys.test.ts` (add), `apps/api/src/keys/groups.ts`, `apps/api/src/keys/routes.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/group-keys.test.ts`. No other files. No new dependencies.

This card does not create groups or memberships (PR 27). Tests insert `groups` and `memberships` rows directly.

`packages/contracts/src/keys.ts`: append, exactly:

```ts
// S2: group keys.
export const GroupKeysRequestSchema = z.strictObject({
  key_version: z.number().int().min(1),
  envelopes: z.array(z.strictObject({ device_id: KeyIdSchema, wrapped_key: EnvelopeTextSchema })).min(1).max(500),
});
export const GroupKeysResponseSchema = z.strictObject({ key_version: z.number().int().min(1), first: z.boolean() });
export const GroupDevicesSchema = z.strictObject({
  key_version: z.number().int().min(1),
  devices: z.array(
    z.strictObject({
      id: KeyIdSchema,
      user_id: KeyIdSchema,
      kind: z.enum(["device", "account"]),
      role: z.enum(["owner", "editor", "viewer"]),
      sign_pub: PublicKeySchema,
      box_pub: PublicKeySchema,
      cert: SignatureSchema.nullable(),
      has_current_key: z.boolean(),
    }),
  ),
});
export const MyGroupKeysSchema = z.strictObject({
  key_version: z.number().int().min(1),
  envelopes: z.array(z.strictObject({ key_version: z.number().int().min(1), wrapped_key: EnvelopeTextSchema })),
  signers: z.array(
    z.strictObject({ id: KeyIdSchema, user_id: KeyIdSchema, kind: z.enum(["device", "account"]), sign_pub: PublicKeySchema, cert: SignatureSchema.nullable() }),
  ),
});
```

`apps/api/src/keys/groups.ts`, exactly:

```ts
import { PURPOSE_GROUP_KEY } from "@waypoint/crypto";
import { ApiFailure } from "../errors.ts";
import type { BatchDb, Db } from "../storage.ts";
import { checkEnvelope, isUniqueViolation } from "./envelopes.ts";

// The devices that must hold a group's current key: approved, not removed devices and the active account key
// row of every current member (docs/security.md, "Group keys").
export const TARGETS_SQL = `
  SELECT d.id, d.user_id, d.kind, d.sign_pub, d.box_pub, d.cert, m.role
  FROM memberships m
  JOIN devices d ON d.user_id = m.user_id
  WHERE m.group_id = ? AND m.left_at IS NULL AND d.removed_at IS NULL AND d.approved_at IS NOT NULL
  ORDER BY d.user_id, d.kind, d.id`;

export type TargetRow = { id: string; user_id: string; kind: "device" | "account"; sign_pub: string; box_pub: string; cert: string | null; role: string };

export async function currentMember(db: Db, groupId: string, userId: string): Promise<{ key_version: number } | null> {
  return db
    .prepare("SELECT g.key_version FROM groups g JOIN memberships m ON m.group_id = g.id WHERE g.id = ? AND m.user_id = ? AND m.left_at IS NULL")
    .bind(groupId, userId)
    .first<{ key_version: number }>();
}

export async function storeGroupKeys(
  db: BatchDb,
  input: { groupId: string; userId: string; signerId: string; keyVersion: number; envelopes: { device_id: string; wrapped_key: string }[] },
): Promise<{ first: boolean }> {
  const group = await currentMember(db, input.groupId, input.userId);
  if (group === null) throw new ApiFailure("not_found", "no such group");
  if (input.keyVersion > group.key_version) throw new ApiFailure("conflict", "unknown key version");
  const ids = input.envelopes.map((e) => e.device_id);
  if (new Set(ids).size !== ids.length) throw new ApiFailure("bad_request", "invalid request");
  for (const envelope of input.envelopes) checkEnvelope(envelope.wrapped_key, PURPOSE_GROUP_KEY, input.signerId);

  const targets = (await db.prepare(TARGETS_SQL).bind(input.groupId).all<TargetRow>()).results;
  const targetIds = new Set(targets.map((t) => t.id));
  if (ids.some((id) => !targetIds.has(id))) throw new ApiFailure("conflict", "not a device of a current member");

  const existing = await db
    .prepare("SELECT count(*) AS n FROM key_envelopes WHERE group_id = ? AND key_version = ?")
    .bind(input.groupId, input.keyVersion)
    .first<{ n: number }>();
  const first = (existing?.n ?? 0) === 0;
  if (first) {
    // The first envelopes for a version decide the key: they must be for the current version and cover every
    // target, so two devices rotating at once always collide on at least one row and only one key wins.
    if (input.keyVersion !== group.key_version) throw new ApiFailure("conflict", "unknown key version");
    if (ids.length !== targetIds.size) throw new ApiFailure("conflict", "envelopes must cover every device");
  }
  const insert = "INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) VALUES (?, ?, ?, ?)";
  try {
    await db.batch(input.envelopes.map((e) => db.prepare(insert).bind(input.groupId, input.keyVersion, e.device_id, e.wrapped_key)));
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiFailure("conflict", "a device already has a key for this version");
    throw error;
  }
  return { first };
}
```

`apps/api/src/keys/routes.ts`, exactly:

```ts
import { GroupKeysRequestSchema } from "@waypoint/contracts";
import { fromBase64Url, parseEnvelope } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { currentMember, storeGroupKeys, TARGETS_SQL, type TargetRow } from "./groups.ts";

export function groupKeyRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .get("/v1/groups/:id/devices", async (c) => {
      const db = c.env.DB;
      const groupId = c.req.param("id");
      const group = await currentMember(db, groupId, c.get("user").id);
      if (group === null) throw new ApiFailure("not_found", "no such group");
      const targets = (await db.prepare(TARGETS_SQL).bind(groupId).all<TargetRow>()).results;
      const holders = (
        await db.prepare("SELECT device_id FROM key_envelopes WHERE group_id = ? AND key_version = ?").bind(groupId, group.key_version).all<{ device_id: string }>()
      ).results;
      const has = new Set(holders.map((h) => h.device_id));
      return c.json({
        key_version: group.key_version,
        devices: targets.map((t) => ({
          id: t.id, user_id: t.user_id, kind: t.kind, role: t.role, sign_pub: t.sign_pub, box_pub: t.box_pub, cert: t.cert, has_current_key: has.has(t.id),
        })),
      });
    })
    .get("/v1/groups/:id/keys", async (c) => {
      const db = c.env.DB;
      const user = c.get("user");
      const groupId = c.req.param("id");
      const deviceId = c.req.query("device") ?? "";
      const group = await currentMember(db, groupId, user.id);
      if (group === null) throw new ApiFailure("not_found", "no such group");
      const device = await db
        .prepare("SELECT id FROM devices WHERE id = ? AND user_id = ? AND removed_at IS NULL AND approved_at IS NOT NULL")
        .bind(deviceId, user.id)
        .first<{ id: string }>();
      if (device === null) throw new ApiFailure("not_found", "no such device");
      const envelopes = (
        await db
          .prepare("SELECT key_version, wrapped_key FROM key_envelopes WHERE group_id = ? AND device_id = ? ORDER BY key_version")
          .bind(groupId, device.id)
          .all<{ key_version: number; wrapped_key: string }>()
      ).results;
      const signerIds = [...new Set(envelopes.map((e) => parseEnvelope(fromBase64Url(e.wrapped_key)).signerId))].sort();
      const signers = [];
      for (const id of signerIds) {
        const row = await db
          .prepare("SELECT id, user_id, kind, sign_pub, cert FROM devices WHERE id = ?")
          .bind(id)
          .first<{ id: string; user_id: string; kind: "device" | "account"; sign_pub: string; cert: string | null }>();
        if (row !== null) signers.push(row);
      }
      return c.json({ key_version: group.key_version, envelopes, signers });
    })
    .post("/v1/groups/:id/keys", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = GroupKeysRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const { first } = await storeGroupKeys(c.env.DB, {
        groupId: c.req.param("id"),
        userId: c.get("user").id,
        signerId: c.get("device").id,
        keyVersion: parsed.data.key_version,
        envelopes: parsed.data.envelopes,
      });
      return c.json({ key_version: parsed.data.key_version, first }, 201);
    });
}
```

The rules are `docs/security.md` section 10. `POST` for a version with no envelopes is a *first set*: it must be for the current version and cover every target exactly; otherwise it adds envelopes for targets that do not have one. All inserts are one batch; any existing row makes the whole call 409.

`apps/api/src/app.ts`: `import { groupKeyRoutes } from "./keys/routes.ts";` and `app.route("/", groupKeyRoutes({ now: deps.now }));`.

Tests (`packages/contracts/test/keys.test.ts`, add): `GroupKeysRequestSchema` refuses an empty list and 501 envelopes.

Tests (`apps/api/test/group-keys.test.ts`), with two users in group `g1` (key version 2), each with an account row and one approved device, user 2 also with a waiting device and a removed device, and a third user not in the group:
- a first set for version 2 covering the four targets → 201 `{ key_version: 2, first: true }`; four rows;
- a first set missing one target → 409, no rows; with the waiting, the removed or the third user's device → 409; for version 1 when 2 is current → 409; for version 3 → 409;
- after user 1's first set, user 2's own full first set → 409 and the stored rows are still user 1's (the race: first set wins);
- after a first set, a new approved device of user 2 gets an envelope through an add → 201 `{ first: false }`; adding it again → 409;
- an envelope signed by another device id → 400; purpose 2 → 400; a duplicated device id → 400;
- a caller that is not a member → 404; a member who left (`left_at` set) → 404;
- `GET /v1/groups/g1/devices` lists the targets with roles and `has_current_key`, passes `GroupDevicesSchema`, and does not list waiting, removed or non-member devices;
- `GET /v1/groups/g1/keys?device=<id>` returns that device's envelopes in version order and one entry per signer, passes `MyGroupKeysSchema`; for another user's device, a removed device or a missing `device` → 404;
- after a member's removal is simulated by setting `left_at` and running `UPDATE groups SET key_version = key_version + 1 WHERE id = ?`, the removed member's devices are not targets and a first set for the new version must leave them out;
- `POST` without a signature → 401.

Not in this PR: creating groups, invites, membership changes and the key version bump on removal (PR 27); refusing changes with an old key version in sync (PR 28); push notices that a key is needed (not planned yet; PR 31 has no such kind).

---

## S3 · `PUT /v1/recovery` and `GET /v1/recovery`

Branch `pr/s3-recovery`. Builds on S1B (so `packages/contracts/src/keys.ts` already exists). Tests insert devices with `insertDevice`. Files: `packages/contracts/src/keys.ts` (append), `packages/contracts/test/keys.test.ts` (add), `apps/api/src/recovery/route.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/recovery.test.ts`. No other files. No new dependencies.

`packages/contracts/src/keys.ts`: append, exactly:

```ts
// S3: recovery.
export const RecoveryBlobSchema = z.string().regex(/^[A-Za-z0-9_-]{124}$/); // 93 bytes
export const PutRecoveryRequestSchema = z.strictObject({
  account_device_id: KeyIdSchema,
  wrapped_account_key: RecoveryBlobSchema,
  verified: z.boolean(),
});
export const RecoveryViewSchema = z.strictObject({
  account_device_id: KeyIdSchema,
  sign_pub: PublicKeySchema,
  box_pub: PublicKeySchema,
  wrapped_account_key: RecoveryBlobSchema,
  verified_at: z.number().int().nullable(),
});
```

`apps/api/src/recovery/route.ts`, exactly:

```ts
import { PutRecoveryRequestSchema } from "@waypoint/contracts";
import { fromBase64Url, isRecoveryBlob } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";

type AccountRow = { id: string; sign_pub: string; box_pub: string };

export function recoveryRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .put("/v1/recovery", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const user = c.get("user");
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = PutRecoveryRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      let blobOk = false;
      try {
        blobOk = isRecoveryBlob(fromBase64Url(req.wrapped_account_key));
      } catch {
        blobOk = false;
      }
      if (!blobOk) throw new ApiFailure("bad_request", "invalid request");
      const account = await db
        .prepare("SELECT id FROM devices WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL")
        .bind(user.id)
        .first<{ id: string }>();
      if (account === null || account.id !== req.account_device_id) throw new ApiFailure("conflict", "not the current account key");
      const verifiedAt = req.verified ? deps.now() : null;
      await db
        .prepare(
          "INSERT INTO recovery (user_id, wrapped_account_key, verified_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET wrapped_account_key = excluded.wrapped_account_key, verified_at = excluded.verified_at",
        )
        .bind(user.id, req.wrapped_account_key, verifiedAt)
        .run();
      return c.json({ account_device_id: account.id, verified_at: verifiedAt });
    })
    .get("/v1/recovery", async (c) => {
      const db = c.env.DB;
      const user = c.get("user");
      const row = await db
        .prepare(
          "SELECT d.id, d.sign_pub, d.box_pub, r.wrapped_account_key, r.verified_at FROM recovery r JOIN devices d ON d.user_id = r.user_id AND d.kind = 'account' AND d.removed_at IS NULL WHERE r.user_id = ?",
        )
        .bind(user.id)
        .first<AccountRow & { wrapped_account_key: string; verified_at: number | null }>();
      if (row === null) throw new ApiFailure("not_found", "no recovery key");
      return c.json({ account_device_id: row.id, sign_pub: row.sign_pub, box_pub: row.box_pub, wrapped_account_key: row.wrapped_account_key, verified_at: row.verified_at });
    });
}
```

The 12 words never reach the server; it stores a 93-byte blob for the user's current account row (`docs/security.md` section 13). `GET` needs only the session, because a device that is not approved yet needs it.

`apps/api/src/app.ts`: `import { recoveryRoute } from "./recovery/route.ts";` and `app.route("/", recoveryRoute({ now: deps.now }));`.

Tests (`packages/contracts/test/keys.test.ts`, add): `PutRecoveryRequestSchema` takes the `blob` of `waypoint-v1.json` and refuses 123 characters.

Tests (`apps/api/test/recovery.test.ts`), blobs made with `wrapAccountKey` from `@waypoint/crypto`:
- `PUT` with `verified: true` → 200 `{ account_device_id, verified_at: NOW }`; `GET` returns the blob, the account row's keys and `verified_at`, passing `RecoveryViewSchema`;
- `PUT` again with `verified: false` replaces the blob and sets `verified_at` null (still one row);
- `account_device_id` that is not the active account row (another id, or a removed account row) → 409, nothing stored;
- a blob of the right length with version byte 2 → 400; 92 bytes → 400; not base64url → 400;
- `GET` with no recovery row → 404; after the account row is replaced (simulate S1D: old row removed, new row inserted, recovery deleted) → 404;
- a waiting device's session can `GET`; `PUT` signed by a waiting device → 401; without a signature → 401;
- the reply and D1 never contain anything but the blob as sent (no decoding or re-encoding).

Not in this PR: the words, the key derivation and the "type 3 words back" check (iOS); deleting the blob on rotation (S1D does it).

---

## S4 · Sealing job results to one device

Branch `pr/s4-seal-results`. Builds on S1A. Files: `apps/api/src/jobs/seal.ts`, `apps/api/test/seal.test.ts`. No other files. No new dependencies.

This card adds a function only. It adds no route and no R2 binding: PR 33 adds the R2 binding `BUCKET`, PR 20 writes `jobs.device_id` from `c.get("device").id`, and PR 22 to 25 call this function from the workflow step that produces the result.

`apps/api/src/jobs/seal.ts`, exactly:

```ts
import { decodePublicKey, MAX_RESULT_BYTES, sealResult } from "@waypoint/crypto";
import type { Db } from "../storage.ts";

// The part of R2 this module uses. R2Bucket satisfies this type.
export type ResultBucket = {
  put(key: string, value: Uint8Array, options: { customMetadata: Record<string, string> }): Promise<unknown>;
};

export class SealError extends Error {
  constructor(readonly reason: "no_job" | "no_device" | "too_large") {
    super(`cannot seal result: ${reason}`);
    this.name = "SealError";
  }
}

type Target = { device_id: string; box_pub: string };

// Seals a finished job's result to the device that asked for it, stores it at results/{job}, and records the key.
// The caller must not keep, log or return the plaintext; this function overwrites it with zeros.
export async function sealJobResult(
  deps: { db: Db; bucket: ResultBucket },
  input: { jobId: string; plaintext: Uint8Array },
): Promise<{ result_key: string; bytes: number }> {
  try {
    if (input.plaintext.length > MAX_RESULT_BYTES) throw new SealError("too_large");
    const job = await deps.db.prepare("SELECT user_id, device_id FROM jobs WHERE id = ?").bind(input.jobId).first<{ user_id: string; device_id: string | null }>();
    if (job === null) throw new SealError("no_job");
    const target =
      job.device_id === null
        ? null
        : await deps.db
            .prepare(
              "SELECT id AS device_id, box_pub FROM devices WHERE id = ? AND user_id = ? AND kind = 'device' AND approved_at IS NOT NULL AND removed_at IS NULL",
            )
            .bind(job.device_id, job.user_id)
            .first<Target>();
    if (target === null) throw new SealError("no_device");
    const sealed = await sealResult({
      jobId: input.jobId,
      deviceId: target.device_id,
      deviceBoxPub: decodePublicKey(target.box_pub),
      plaintext: input.plaintext,
    });
    const key = `results/${input.jobId}`;
    await deps.bucket.put(key, sealed, { customMetadata: { format: "sealed-result-v1", device_id: target.device_id } });
    await deps.db.prepare("UPDATE jobs SET result_key = ? WHERE id = ?").bind(key, input.jobId).run();
    return { result_key: key, bytes: sealed.length };
  } finally {
    input.plaintext.fill(0);
  }
}
```

How a workflow must call it (put this in PR 22 to 25):

```ts
// Inside ONE step: generate, seal, return only the key. Workflows persist what a step returns.
const { result_key } = await step.do("write and seal", async () => {
  const text = await generateScript(/* ... */);
  return sealJobResult({ db: env.DB, bucket: env.BUCKET }, { jobId, plaintext: new TextEncoder().encode(text) });
});
```

Tests (`apps/api/test/seal.test.ts`), with an in-memory `ResultBucket` that records `put` calls:
- compile-time check `export const bucketFits: (bucket: R2Bucket) => ResultBucket = (bucket) => bucket;`;
- a job with an approved device: returns `{ result_key: "results/<job>", bytes }`; one `put` at that key with `customMetadata` `{ format: "sealed-result-v1", device_id }`; `jobs.result_key` is set; `openResult` with the device's `boxPrivate` gives the plaintext back; the stored bytes do not contain the plaintext; the caller's plaintext buffer is all zeros afterwards;
- no such job → `SealError` `no_job`; a job with `device_id` null, a removed device, a waiting device, another user's device → `no_device`; nothing is put and `result_key` stays null; the plaintext is zeroed in every case;
- exactly 4 MiB is sealed; 4 MiB + 1 byte → `too_large`, nothing put;
- if `put` rejects, the error propagates and `result_key` stays null.

Not in this PR: the R2 binding (PR 33), `GET /v1/jobs/:id/result` (PR 20), the 7-day cleanup (PR 33), what to do with the credits when sealing fails because the device was removed (question for the owner).

---

## S1E · Device signatures on the paid routes merged before S1A

Branch `pr/s1e-signed-paid-routes`. Builds on S1A, PR 14, PR 15 and PR 17 (branch after all four are merged). Files: `apps/api/src/app.ts`, `apps/api/test/app.test.ts` (new tests only). No other files. No new dependencies.

Why it looks like this: `docs/security.md` section 7 requires a device signature on every request that spends or buys credits. `POST /v1/tasks/explain`, `/v1/tasks/more-detail`, `/v1/tasks/double-check` (PR 14, 15) and `POST /v1/purchases/apple` (PR 17) were built before `requireDeviceSignature` existed. Registering it once in `createApp` adds it to all four without touching their route files or their route tests, which mount the routes on a fresh app without `createApp`. Every route written after S1A puts `requireDeviceSignature(deps)` on the route itself (the S1A rule); this card is the only exception. Hono runs a handler registered with `app.on` before the handlers of the same method and path mounted later with `app.route`, and only continues when it calls `next()` (checked in a prototype with a stand-in middleware, together with PR 14's route).

`src/app.ts`: add `import { requireDeviceSignature } from "./auth/signature.ts";`, then above `createApp`, exactly:

```ts
// The routes merged before S1A that spend or buy credits. Routes written after S1A put
// requireDeviceSignature on the route itself instead (docs/cards/security.md, S1A).
export const SIGNED_BEFORE_S1A = ["/v1/tasks/explain", "/v1/tasks/more-detail", "/v1/tasks/double-check", "/v1/purchases/apple"];
```

and in `createApp`, right after the `requireIdempotencyKey` line and above "Routes go below this line", exactly:

```ts
  // Device signature (S1E). Before the routes, so it runs before a route's own idempotent() store.
  app.on("POST", SIGNED_BEFORE_S1A, requireDeviceSignature(deps));
```

`deps` is the `SessionDeps` that `createApp` already takes; it has `now`. A request to one of these paths now goes: session, Idempotency-Key header, device signature, then the route (for Apple purchases, PR 17's `idempotent()` store, then the handler).

**Consequence:** after this card, running a paid task or recording a purchase needs a registered, approved device (S1B, and S1C for a second device); a session alone gets 401 "device signature required". The mobile app registers its first device right after sign-in (mobile cards M26 and M27a, stage 2, before Explain and purchases).

Tests (`test/app.test.ts`, add; change nothing else), through `createApp` with the file's `setup()` and `authed()`. Before these tests: make one authed `GET /v1/x` so the session user exists, read its id with `SELECT id FROM users WHERE clerk_id = 'user_123'`, make `phone = await makeTestDevice("dev_phone")` and `insertDevice(env.DB, phone, { userId })` (from `test/helpers/signing.ts`). A signed request is `await signedInit(phone, { method: "POST", path, body: {}, now: NOW })` with `Authorization` added to its headers. Each bullet is one test:
- Each of the four paths, signed in, with a valid `Idempotency-Key` and no `Waypoint-*` headers → 401 exactly `{ code: "unauthorized", message: "device signature required", retry_after: null }`.
- `POST /v1/tasks/explain` signed by the phone, body `{}` → 400 `bad_request` "invalid request" (it reached the route).
- `POST /v1/purchases/apple` signed by the phone, body `{}` → 400 "invalid request".
- `POST /v1/tasks/explain` signed by a device of another user (insert a second user and an approved device for them) → 401.
- `POST /v1/tasks/quote` with a valid key, no `Waypoint-*` headers and body `{}` → 400 "invalid request", not 401 (a quote spends nothing).
- `POST /v1/x` (the file's throwaway route) with a valid key and no `Waypoint-*` headers → 200.

Not in this PR: signatures on routes written after S1A (each card adds its own), changes to the four route files or their tests.

---

## S1F · Device pushes and push-token cleanup (outline; written in full after S1D)

Builds on S1D and PR 31. Files: `apps/api/src/devices/register.ts`, `apps/api/src/devices/pairing.ts`, `apps/api/src/devices/remove.ts` and their tests (`devices.test.ts`, `pairing.test.ts`, `remove-device.test.ts`, which get a `PUSH_QUEUE` stub in `env`). What it adds, and nothing else:

- `POST /v1/devices` for a new waiting device sends `{ user_id, kind: "device_request", ref: <new device id>, device_id: <approved device id> }` to `PUSH_QUEUE` once for each of the user's approved devices (flow 7: "API pushes to an old device").
- `POST /v1/devices/:id/approve` sends `{ user_id, kind: "device_approved", ref: <device id>, device_id: <device id> }`.
- `DELETE /v1/devices/:id` deletes that device's `push_tokens` rows (`WHERE user_id = ? AND device_id = ?`) in the same D1 batch that marks it removed.
- A failed queue send never fails the request (catch and drop, like `sendUsage`).

`push_tokens.device_id` is the device's `devices.id` (decided in the integration pass; see PR 31).
