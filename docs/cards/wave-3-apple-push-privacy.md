# Wave 3 cards: Apple purchases, push, privacy, usage and cleanup

PR 17, 18, 31, 32 and 33. Written 19 Nov 2026 against `main` at PR 12 (`e53c250`). Every code block marked "exactly" was built and run in a scratch copy of the repo before it was written here: `npm run typecheck`, `npm test` and `npm run bundle -w @waypoint/api` all passed with it.

## Rules for these cards

The wave 2 rules (top of "## Wave 2" in `docs/build-plan.md`) and the wave 3 notes still apply: files only where the card says, no `node:` imports in `apps/api/src`, tests through `app.request` with hand-made `env` objects, no Miniflare, no network, run `npm run bundle -w @waypoint/api` before opening the pull request and paste its last lines. Route tests build a fresh app, as in the PR 11 and PR 12 cards:

```ts
const app = new Hono<AppEnv>();
app.onError(handleError);
app.use(async (c, next) => {
  c.set("user", user);
  await next();
});
// then mount the route under test
```

On top of that:

- **No new dependencies.** Everything here uses WebCrypto (`crypto.subtle`), which Workers and Node both have.
- **Never log** a signed transaction, a signed payload, an APNs device token, the APNs provider token or the `.p8` key. These cards add no `console` calls at all.
- **Shared files.** These cards add lines to `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/wrangler.jsonc` and `packages/contracts/src/index.ts`. Add only your own lines and leave the rest as it is.
- **Migration numbers.** PR 18 adds `0003_apple_notifications.sql`, PR 31 adds `0004_push_tokens.sql`. If `main` already has a migration with your number when you start, use the next free number and say so in the pull request. Gaps are fine: the test helpers apply files in name order.
- **Where an exact code block and the prose disagree, the code block wins.** Copy it as it is, including comments.

Order: PR 17 (two sittings) first. PR 18 after PR 17 is merged. PR 31 and PR 32 do not depend on 17 and can start any time. PR 33 after PR 17 and PR 31 are merged.

## Decisions these cards make

- **Product ids** live in code, in `apps/api/src/apple/products.ts` (PR 17): `waypoint.own_it` (Own it, non-consumable, 2,000 credits once), `waypoint.plus.monthly` and `waypoint.plus.yearly` (auto-renewable, one subscription group), `waypoint.credits.1000`, `waypoint.credits.5000`, `waypoint.credits.20000` (consumable). Product ids in App Store Connect are chosen by us, so the owner creates them with exactly these ids, or changes the table before PR 17 merges. They are not secrets.
- **One wallet command id per transaction:** `apple:txn:<transactionId>`. The app's `POST /v1/purchases/apple` and Apple's notice for the same transaction (`ONE_TIME_CHARGE`, `SUBSCRIBED`, `DID_RENEW`) use the same id, so whichever arrives second changes nothing. A Plus renewal is therefore `reset { id: "apple:txn:<transactionId>", credits: 2000, resets_at: <period end> }` (the PR 18 note gives the reset, not its id; this is the id).
- **Refunds, revokes and lapses** use `apple:<notificationUUID>`, as the PR 18 note says.
- **Which account a purchase belongs to.** The app sets the StoreKit purchase option `appAccountToken` to the signed-in user's id (a UUID). The first account to record a transaction or its original transaction owns it; another account sending it gets 409. Notices find the account by transaction id, then original transaction id, then `appAccountToken`.
- **Family Sharing.** A transaction whose `inAppOwnershipType` is not `PURCHASED` gives an entitlement with source `family_share` (for Own it and Plus) and never a wallet command.
- **Plan.** `users.plan` is worked out from open entitlements: `plus` over `own` over `free`. Anyone not on Plus has `zero_retention` turned off at the same time.
- **Plus yearly** renews once a year, but its credits are monthly. PR 17 resets to 2,000 for the first month; PR 33's hourly cron resets to 2,000 at the start of months 2 to 12.
- **Sandbox.** `APPLE_ENVIRONMENTS` is `"Production,Sandbox"`, because App Review buys with sandbox accounts against the production server. This also lets TestFlight testers get free credits on production; see the open questions.

## What was checked during planning

- **Apple Root CA - G3** SHA-256 fingerprint `63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179`, computed from `https://www.apple.com/certificateauthority/AppleRootCA-G3.cer` (P-384, valid 2014-04-30 to 2039-04-30). The DER reader in PR 17 was run on that certificate and on Apple's current intermediate (`AppleWWDRCAG6.cer`): it read the curve, the CA flag, the intermediate marker OID and the dates correctly, and the intermediate's signature verified with the root's key through WebCrypto. The real certificates are not needed in the repo; tests make their own chain.
- **The checks** in PR 17 match Apple's own `app-store-server-library-node` (`SignedDataVerifier` with online checks off): exactly three certificates in `x5c`; the root is the pinned one; the intermediate is signed by the root and the leaf by the intermediate, with matching names; the intermediate is a CA with OID `1.2.840.113635.100.6.2.1`; the leaf has OID `1.2.840.113635.100.6.11.1`; all three are valid at the payload's `signedDate`; the JWS is ES256 signed by the leaf key. Then bundle id and environment, and for production notices the app's Apple id.
- **Why no X.509 library.** Apple's library needs Node's `crypto.X509Certificate`, which is Node-only. `@peculiar/x509` 3.1.0 and `pkijs` 4.0.1 work on WebCrypto, but their `^` dependency ranges resolve today to versions published in the last 14 days (`@peculiar/asn1-*` 3.1.0 and `asn1js` 4.1.0 on 19 Nov 2026, `@peculiar/utils` 4.1.1 on 16 Nov 2026), and `@peculiar/x509` also pulls in `tsyringe`. A 200-line strict DER reader, tested against a test-made chain and checked against Apple's real certificates, was smaller and safer.
- **App Store notices** (types and subtypes) and the transaction fields come from Apple's current documentation for `notificationType`, `subtype`, `responseBodyV2DecodedPayload`, `data`, `JWSTransactionDecodedPayload`, `inAppOwnershipType`, `revocationType` and `environment` (checked 19 Nov 2026).
- **APNs from a Worker.** APNs only speaks HTTP/2. Cloudflare's docs do not say which HTTP version a Worker's `fetch` uses, but a workerd maintainer wrote (cloudflare/workerd#4841, 20 Aug 2025) that a deployed Worker's requests go out through Cloudflare's proxy stack, which talks HTTP/2 to the origin, while local `workerd` (`wrangler dev`) has no HTTP/2 client. Community APNs clients for Workers (for example `FiveSheepCo/cloudflare-apns2`) use plain `fetch` with token auth. So PR 31 calls APNs with `fetch` and token-based auth; it cannot be tried locally, and tests stub `fetch`. The first production push is the real check (see open questions). A recent Cloudflare community report of HTTP 500s from APNs concerns mTLS (certificate) auth, which these cards do not use.
- **Typing.** `MessageBatch<unknown>` fits the small `QueueBatch` type, `R2Bucket` fits `CleanupBucket`, `AnalyticsEngineDataset` fits `UsageDataset`, the wallet Durable Object stub fits `WalletCommands`, and `export default { fetch: app.fetch, queue, scheduled } satisfies ExportedHandler<Env>` type-checks and bundles with the `queues`, `analytics_engine_datasets`, `r2_buckets` and `triggers` config below.

---

### PR 17 · `POST /v1/purchases/apple`

Branch `pr/17-apple-purchases`. No new dependencies. Two sittings on the same branch: Part A (verifying Apple's signature), commit and push, then Part B (the endpoint).

#### Part A: verify a JWS signed by the App Store

Files: `apps/api/src/apple/x509.ts`, `apps/api/src/apple/jws.ts`, `apps/api/test/helpers/apple.ts`, `apps/api/test/apple-jws.test.ts`. No other files.

`src/apple/x509.ts`, exactly:

```ts
// A small, strict DER reader for the X.509 certificates in Apple's x5c chains.
// It reads only what the chain check needs and throws X509Error on anything it does not expect.

export class X509Error extends Error {
  constructor() {
    super("bad certificate");
    this.name = "X509Error";
  }
}

export type Certificate = {
  der: Uint8Array;
  tbs: Uint8Array; // the signed part, as its full DER bytes
  signatureAlgorithm: string; // dotted OID
  signature: Uint8Array; // DER ECDSA-Sig-Value
  issuer: Uint8Array; // DER Name, compared byte for byte
  subject: Uint8Array;
  notBefore: number; // Unix ms
  notAfter: number;
  spki: Uint8Array; // DER SubjectPublicKeyInfo, for crypto.subtle.importKey("spki", ...)
  curve: "P-256" | "P-384" | null; // null: not an EC key on one of these curves
  extensions: ReadonlySet<string>; // dotted OIDs of every extension present
  isCA: boolean; // basicConstraints cA is TRUE
};

type Node = { tag: number; start: number; body: number; end: number };

const EC_PUBLIC_KEY = "1.2.840.10045.2.1";
const CURVES: Readonly<Record<string, "P-256" | "P-384">> = {
  "1.2.840.10045.3.1.7": "P-256",
  "1.3.132.0.34": "P-384",
};
const BASIC_CONSTRAINTS = "2.5.29.19";

function fail(): never {
  throw new X509Error();
}

function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  return value === undefined ? fail() : value;
}

// One tag-length-value at offset, which must end at or before limit. Only short tags and definite lengths.
function readNode(bytes: Uint8Array, offset: number, limit: number): Node {
  const tag = byteAt(bytes, offset);
  if ((tag & 0x1f) === 0x1f) fail();
  let length = byteAt(bytes, offset + 1);
  let body = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 3) fail();
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + byteAt(bytes, body + i);
    body += count;
  }
  const end = body + length;
  if (end > limit) fail();
  return { tag, start: offset, body, end };
}

function children(bytes: Uint8Array, parent: Node): Node[] {
  const nodes: Node[] = [];
  let offset = parent.body;
  while (offset < parent.end) {
    const node = readNode(bytes, offset, parent.end);
    nodes.push(node);
    offset = node.end;
  }
  return nodes;
}

function expectTag(node: Node | undefined, tag: number): Node {
  if (node === undefined || node.tag !== tag) fail();
  return node;
}

function readOid(bytes: Uint8Array, node: Node): string {
  expectTag(node, 0x06);
  if (node.end === node.body) fail();
  const first = byteAt(bytes, node.body);
  const parts = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
  let value = 0;
  for (let i = node.body + 1; i < node.end; i++) {
    const b = byteAt(bytes, i);
    value = value * 128 + (b & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER) fail();
    if ((b & 0x80) === 0) {
      parts.push(value);
      value = 0;
    } else if (i === node.end - 1) {
      fail();
    }
  }
  return parts.join(".");
}

function readTime(bytes: Uint8Array, node: Node): number {
  const text = String.fromCharCode(...bytes.subarray(node.body, node.end));
  let match: RegExpExecArray | null;
  let year: number;
  if (node.tag === 0x17) {
    match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
    if (match === null) fail();
    const yy = Number(match[1]);
    year = yy >= 50 ? 1900 + yy : 2000 + yy;
  } else if (node.tag === 0x18) {
    match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
    if (match === null) fail();
    year = Number(match[1]);
  } else {
    return fail();
  }
  const [, , month, day, hour, minute, second] = match.map(Number);
  if (month === undefined || day === undefined || hour === undefined || minute === undefined || second === undefined) fail();
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function parseCertificate(der: Uint8Array): Certificate {
  const root = readNode(der, 0, der.length);
  if (root.tag !== 0x30 || root.end !== der.length) fail();
  const [tbsNode, algNode, sigNode, extra] = children(der, root);
  if (extra !== undefined) fail();
  const tbsSeq = expectTag(tbsNode, 0x30);
  const signatureAlgorithm = readOid(der, expectTag(children(der, expectTag(algNode, 0x30))[0], 0x06));
  const sigBits = expectTag(sigNode, 0x03);
  if (byteAt(der, sigBits.body) !== 0) fail();

  const fields = children(der, tbsSeq);
  let i = 0;
  if (fields[i]?.tag === 0xa0) i++; // version
  expectTag(fields[i++], 0x02); // serial number
  const innerAlg = readOid(der, expectTag(children(der, expectTag(fields[i++], 0x30))[0], 0x06));
  if (innerAlg !== signatureAlgorithm) fail();
  const issuer = expectTag(fields[i++], 0x30);
  const validity = children(der, expectTag(fields[i++], 0x30));
  const subject = expectTag(fields[i++], 0x30);
  const spki = expectTag(fields[i++], 0x30);
  if (validity.length !== 2) fail();
  const [notBeforeNode, notAfterNode] = validity;
  if (notBeforeNode === undefined || notAfterNode === undefined) fail();

  const keyAlg = children(der, expectTag(children(der, spki)[0], 0x30));
  const keyType = readOid(der, expectTag(keyAlg[0], 0x06));
  const curveNode = keyAlg[1];
  const curveOid = keyType === EC_PUBLIC_KEY && curveNode?.tag === 0x06 ? readOid(der, curveNode) : "";
  const curve = Object.hasOwn(CURVES, curveOid) ? (CURVES[curveOid] ?? null) : null;

  const extensions = new Set<string>();
  let isCA = false;
  for (const field of fields.slice(i)) {
    if (field.tag !== 0xa3) continue; // issuerUniqueID [1] and subjectUniqueID [2] are skipped
    for (const ext of children(der, expectTag(children(der, field)[0], 0x30))) {
      const parts = children(der, expectTag(ext, 0x30));
      const oid = readOid(der, expectTag(parts[0], 0x06));
      if (extensions.has(oid)) fail();
      extensions.add(oid);
      const value = expectTag(parts[parts.length - 1], 0x04);
      if (oid === BASIC_CONSTRAINTS) {
        const inner = readNode(der, value.body, value.end);
        const first = children(der, expectTag(inner, 0x30))[0];
        isCA = first !== undefined && first.tag === 0x01 && first.end - first.body === 1 && byteAt(der, first.body) !== 0;
      }
    }
  }

  return {
    der,
    tbs: der.slice(tbsSeq.start, tbsSeq.end),
    signatureAlgorithm,
    signature: der.slice(sigBits.body + 1, sigBits.end),
    issuer: der.slice(issuer.start, issuer.end),
    subject: der.slice(subject.start, subject.end),
    notBefore: readTime(der, notBeforeNode),
    notAfter: readTime(der, notAfterNode),
    spki: der.slice(spki.start, spki.end),
    curve,
    extensions,
    isCA,
  };
}

// DER ECDSA-Sig-Value (SEQUENCE of two INTEGERs) to the r||s form WebCrypto verifies.
export function ecdsaDerToRaw(sig: Uint8Array, size: number): Uint8Array {
  const seq = readNode(sig, 0, sig.length);
  if (seq.tag !== 0x30 || seq.end !== sig.length) fail();
  const ints = children(sig, seq);
  if (ints.length !== 2) fail();
  const raw = new Uint8Array(size * 2);
  ints.forEach((node, index) => {
    expectTag(node, 0x02);
    let start = node.body;
    while (start < node.end - 1 && byteAt(sig, start) === 0) start++;
    const length = node.end - start;
    if (length > size) fail();
    raw.set(sig.subarray(start, node.end), index * size + size - length);
  });
  return raw;
}

const HASH_FOR_ALGORITHM: Readonly<Record<string, "SHA-256" | "SHA-384">> = {
  "1.2.840.10045.4.3.2": "SHA-256",
  "1.2.840.10045.4.3.3": "SHA-384",
};

// True when issuer's key made cert's signature. Only ECDSA with SHA-256 or SHA-384 on P-256 or P-384.
export async function isSignedBy(cert: Certificate, issuer: Certificate): Promise<boolean> {
  const hash = Object.hasOwn(HASH_FOR_ALGORITHM, cert.signatureAlgorithm)
    ? HASH_FOR_ALGORITHM[cert.signatureAlgorithm]
    : undefined;
  if (hash === undefined || issuer.curve === null) return false;
  const key = await crypto.subtle.importKey("spki", issuer.spki, { name: "ECDSA", namedCurve: issuer.curve }, false, [
    "verify",
  ]);
  const raw = ecdsaDerToRaw(cert.signature, issuer.curve === "P-256" ? 32 : 48);
  return crypto.subtle.verify({ name: "ECDSA", hash }, key, raw, cert.tbs);
}
```

`src/apple/jws.ts`, exactly:

```ts
import { isSignedBy, parseCertificate, type Certificate } from "./x509.ts";

// SHA-256 of the DER bytes of "Apple Root CA - G3", as published at https://www.apple.com/certificateauthority/.
export const APPLE_ROOT_CA_G3_SHA256 = "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";

// Marker extensions Apple puts on the App Store signing certificates (same checks as Apple's own server library).
const LEAF_MARKER = "1.2.840.113635.100.6.11.1";
const INTERMEDIATE_MARKER = "1.2.840.113635.100.6.2.1";

export class AppleJwsError extends Error {
  constructor() {
    super("invalid signed data");
    this.name = "AppleJwsError";
  }
}

function fail(): never {
  throw new AppleJwsError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fromBase64Url(part: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) fail();
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
}

function fromBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) fail();
  return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
}

function decodeJson(part: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
  return isRecord(value) ? value : fail();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validAt(cert: Certificate, at: number): boolean {
  return cert.notBefore <= at && at <= cert.notAfter;
}

// Verifies a JWS signed by the App Store (a StoreKit 2 transaction, renewal info or a server notification)
// and returns its decoded payload. rootSha256 is APPLE_ROOT_CA_G3_SHA256 in the Worker; tests pass their own root's.
// Certificates are checked at the payload's signedDate, as Apple's library does when online checks are off.
// Every failure throws AppleJwsError with the same message.
export async function verifyAppleJws(jws: string, rootSha256: string): Promise<Record<string, unknown>> {
  try {
    const parts = jws.split(".");
    if (parts.length !== 3) fail();
    const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;
    const header = decodeJson(headerPart);
    const payload = decodeJson(payloadPart);
    const signature = fromBase64Url(signaturePart);
    if (header.alg !== "ES256") fail();

    const x5c: unknown = header.x5c;
    if (!Array.isArray(x5c) || x5c.length !== 3) fail();
    const [leaf, intermediate, root] = x5c.map((entry: unknown) =>
      typeof entry === "string" ? parseCertificate(fromBase64(entry)) : fail(),
    );
    if (leaf === undefined || intermediate === undefined || root === undefined) fail();

    if ((await sha256Hex(root.der)) !== rootSha256) fail();
    if (!sameBytes(intermediate.issuer, root.subject) || !sameBytes(leaf.issuer, intermediate.subject)) fail();
    if (!intermediate.isCA || !intermediate.extensions.has(INTERMEDIATE_MARKER)) fail();
    if (!leaf.extensions.has(LEAF_MARKER)) fail();
    if (!(await isSignedBy(intermediate, root)) || !(await isSignedBy(leaf, intermediate))) fail();

    const signedDate = payload.signedDate;
    if (typeof signedDate !== "number" || !Number.isSafeInteger(signedDate)) fail();
    if (![leaf, intermediate, root].every((cert) => validAt(cert, signedDate))) fail();

    if (leaf.curve !== "P-256" || signature.length !== 64) fail();
    const key = await crypto.subtle.importKey("spki", leaf.spki, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
    const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
    if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, signed))) fail();
    return payload;
  } catch {
    return fail();
  }
}
```

`test/helpers/apple.ts`, exactly. Later cards (PR 18) reuse it and must not write their own chain builder.

```ts
// Builds a fake App Store certificate chain and signs JWS with it, all at test time with WebCrypto.
// The chain has the same shape as Apple's: P-384 root and intermediate, P-256 leaf, ECDSA signatures,
// basicConstraints on the CAs and Apple's marker extensions.

const ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const ECDSA_SHA384 = "1.2.840.10045.4.3.3";
export const LEAF_MARKER = "1.2.840.113635.100.6.11.1";
export const INTERMEDIATE_MARKER = "1.2.840.113635.100.6.2.1";

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function tlv(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  const n = body.length;
  const head = n < 0x80 ? [tag, n] : n < 0x100 ? [tag, 0x81, n] : [tag, 0x82, n >> 8, n & 0xff];
  return concat([Uint8Array.from(head), body]);
}

const seq = (...parts: Uint8Array[]): Uint8Array => tlv(0x30, ...parts);

export function oid(dotted: string): Uint8Array {
  const [a = 0, b = 0, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(bytes));
}

function integer(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const trimmed = bytes.subarray(start);
  return tlv(0x02, (trimmed[0] ?? 0) & 0x80 ? concat([Uint8Array.of(0), trimmed]) : trimmed);
}

function name(commonName: string): Uint8Array {
  return seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, new TextEncoder().encode(commonName)))));
}

function time(ms: number): Uint8Array {
  const iso = new Date(ms).toISOString(); // 2026-11-19T12:00:00.000Z
  const digits = iso.slice(0, 19).replace(/[-T:]/g, "") + "Z"; // 20261119120000Z
  const year = new Date(ms).getUTCFullYear();
  return year < 2050 ? tlv(0x17, new TextEncoder().encode(digits.slice(2))) : tlv(0x18, new TextEncoder().encode(digits));
}

function extension(id: string, value: Uint8Array, critical = false): Uint8Array {
  return seq(oid(id), ...(critical ? [tlv(0x01, Uint8Array.of(0xff))] : []), tlv(0x04, value));
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  return seq(integer(raw.subarray(0, half)), integer(raw.subarray(half)));
}

export type KeyPair = { privateKey: CryptoKey; publicKey: CryptoKey };

export async function ecKey(curve: "P-256" | "P-384"): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: curve }, true, ["sign", "verify"]);
  if (!("privateKey" in pair)) throw new Error("expected a key pair");
  return pair;
}

export type CertOptions = {
  subject: string;
  issuer: string;
  publicKey: CryptoKey;
  signer: CryptoKey; // the issuer's private key
  signerCurve: "P-256" | "P-384";
  notBefore: number;
  notAfter: number;
  ca: boolean;
  markers: readonly string[];
};

// One DER certificate. The signature hash follows the signer's curve: SHA-256 on P-256, SHA-384 on P-384.
export async function makeCert(o: CertOptions): Promise<Uint8Array> {
  const algorithm = o.signerCurve === "P-256" ? ECDSA_SHA256 : ECDSA_SHA384;
  const extensions = [
    ...(o.ca ? [extension("2.5.29.19", seq(tlv(0x01, Uint8Array.of(0xff))), true)] : []),
    ...o.markers.map((marker) => extension(marker, tlv(0x05))),
  ];
  const exported = await crypto.subtle.exportKey("spki", o.publicKey);
  if (!(exported instanceof ArrayBuffer)) throw new Error("expected spki bytes");
  const spki = new Uint8Array(exported);
  const tbs = seq(
    tlv(0xa0, integer(Uint8Array.of(2))),
    integer(crypto.getRandomValues(new Uint8Array(8))),
    seq(oid(algorithm)),
    name(o.issuer),
    seq(time(o.notBefore), time(o.notAfter)),
    name(o.subject),
    spki,
    ...(extensions.length > 0 ? [tlv(0xa3, seq(...extensions))] : []),
  );
  const hash = o.signerCurve === "P-256" ? "SHA-256" : "SHA-384";
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash }, o.signer, tbs));
  return seq(tbs, seq(oid(algorithm)), tlv(0x03, Uint8Array.of(0), rawToDer(raw)));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export type TestChain = {
  root: Uint8Array;
  intermediate: Uint8Array;
  leaf: Uint8Array;
  leafKey: KeyPair;
  rootSha256: string;
  // The x5c header value: leaf, intermediate, root, standard base64.
  x5c: string[];
};

const YEAR = 365 * 24 * 60 * 60 * 1000;
export const CHAIN_FROM = Date.UTC(2025, 0, 1);
export const CHAIN_TO = Date.UTC(2030, 0, 1);

// A chain shaped like Apple's, valid from CHAIN_FROM to CHAIN_TO. Pass overrides to break one part of it.
export async function makeChain(
  overrides: { leaf?: Partial<CertOptions>; intermediate?: Partial<CertOptions> } = {},
): Promise<TestChain> {
  const rootKey = await ecKey("P-384");
  const intermediateKey = await ecKey("P-384");
  const leafKey = await ecKey("P-256");
  const root = await makeCert({
    subject: "Test Root CA",
    issuer: "Test Root CA",
    publicKey: rootKey.publicKey,
    signer: rootKey.privateKey,
    signerCurve: "P-384",
    notBefore: CHAIN_FROM - YEAR,
    notAfter: CHAIN_TO + YEAR,
    ca: true,
    markers: [],
  });
  const intermediate = await makeCert({
    subject: "Test Intermediate CA",
    issuer: "Test Root CA",
    publicKey: intermediateKey.publicKey,
    signer: rootKey.privateKey,
    signerCurve: "P-384",
    notBefore: CHAIN_FROM,
    notAfter: CHAIN_TO,
    ca: true,
    markers: [INTERMEDIATE_MARKER],
    ...overrides.intermediate,
  });
  const leaf = await makeCert({
    subject: "Test App Store Signing",
    issuer: "Test Intermediate CA",
    publicKey: leafKey.publicKey,
    signer: intermediateKey.privateKey,
    signerCurve: "P-384",
    notBefore: CHAIN_FROM,
    notAfter: CHAIN_TO,
    ca: false,
    markers: [LEAF_MARKER],
    ...overrides.leaf,
  });
  return {
    root,
    intermediate,
    leaf,
    leafKey,
    rootSha256: await sha256Hex(root),
    x5c: [leaf, intermediate, root].map(toBase64),
  };
}

// A compact JWS over payload, signed ES256 with key, with header { alg, x5c } unless header is given.
export async function signJws(
  payload: unknown,
  chain: TestChain,
  options: { header?: Record<string, unknown>; key?: CryptoKey } = {},
): Promise<string> {
  const encode = (value: unknown): string => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${encode(options.header ?? { alg: "ES256", x5c: chain.x5c })}.${encode(payload)}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    options.key ?? chain.leafKey.privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${toBase64Url(new Uint8Array(signature))}`;
}
```

Tests (`test/apple-jws.test.ts`). Make one chain with `makeChain()` in `beforeAll` and reuse it; make a new chain only where a test needs a broken one. `payload` is `{ transactionId: "2000000000000001", signedDate: Date.UTC(2026, 10, 19) }`. One bullet is one test.

`parseCertificate`, `isSignedBy`, `ecdsaDerToRaw`:
- The test leaf: `curve` `"P-256"`, `isCA` false, `extensions` has `LEAF_MARKER`, `notBefore` equals `CHAIN_FROM`, `notAfter` equals `CHAIN_TO`.
- The test root: `curve` `"P-384"`, `isCA` true. The test intermediate: `isCA` true, `extensions` has `INTERMEDIATE_MARKER`.
- A leaf made with `notAfter: Date.UTC(2060, 5, 1, 12, 30, 15)` (written as GeneralizedTime) reads back that exact value.
- The leaf's DER with one extra byte at the end throws `X509Error`.
- The leaf's DER with its last byte cut off throws `X509Error`.
- `new Uint8Array([1, 2, 3])` and `new Uint8Array(0)` throw `X509Error`.
- `ecdsaDerToRaw(Uint8Array.from([0x30, 0x08, 0x02, 0x02, 0x00, 0x80, 0x02, 0x02, 0x01, 0x02]), 4)` gives `[0, 0, 0, 0x80, 0, 0, 1, 2]`; the same input with size 1 throws `X509Error`.
- `isSignedBy(intermediate, root)` and `isSignedBy(root, root)` are true; `isSignedBy(leaf, root)` is false.

`verifyAppleJws`:
- A good JWS returns the payload, equal to what was signed.
- `APPLE_ROOT_CA_G3_SHA256` equals `"63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179"`, and a JWS from the test chain checked against it is rejected.
- Leaf signed by a key other than the intermediate's (`makeChain({ leaf: { signer: (await ecKey("P-384")).privateKey } })`): rejected.
- Leaf without `LEAF_MARKER` (`leaf: { markers: [] }`): rejected.
- Intermediate without `INTERMEDIATE_MARKER`: rejected.
- Intermediate with `ca: false`: rejected.
- `x5c` with the root swapped for another chain's root, checked against that other root's fingerprint: rejected.
- `signedDate` 1 ms after `CHAIN_TO`: rejected. 1 ms before `CHAIN_FROM`: rejected. Exactly `CHAIN_TO`: accepted.
- No `signedDate`: rejected. `signedDate` as a string: rejected.
- Header `alg: "ES384"`: rejected. `alg: "none"`: rejected.
- `x5c` with 2 entries: rejected. With 4 entries: rejected. With a number as an entry: rejected. With `"%%%"` as an entry: rejected.
- Signed with another P-256 key (`signJws(payload, chain, { key })`): rejected.
- The payload part replaced after signing (same header and signature): rejected.
- `"a.b"` (two parts): rejected.
- Every rejection above is `AppleJwsError` with message `"invalid signed data"` (one shared `expectInvalid` helper is fine).

Run `npm run typecheck`, `npm test` and `npm run bundle -w @waypoint/api`, commit, push.

#### Part B: the endpoint

Files: `packages/contracts/src/purchases.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/purchases.test.ts`, `apps/api/src/apple/products.ts`, `apps/api/src/apple/transaction.ts`, `apps/api/src/apple/purchases.ts`, `apps/api/src/apple/route.ts`, `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/wrangler.jsonc`, `apps/api/test/apple-purchase.test.ts`, `apps/api/test/app.test.ts` (new tests only). No other files.

`packages/contracts/src/purchases.ts`, exactly, and `export * from "./purchases.ts";` at the end of `packages/contracts/src/index.ts`:

```ts
import { z } from "zod";

export const PLANS = ["free", "plus", "own"] as const;
export const PRODUCT_KINDS = ["own_it", "plus", "pack"] as const;

export type Plan = (typeof PLANS)[number];
export type ProductKind = (typeof PRODUCT_KINDS)[number];

// The StoreKit 2 transaction's jwsRepresentation, sent as it is.
export const ApplePurchaseRequestSchema = z.strictObject({
  signed_transaction: z.string().min(1).max(16384),
});

// credits: what this transaction gave this account (0 for Family Sharing, an expired period or a repeat).
export const ApplePurchaseResponseSchema = z.strictObject({
  transaction_id: z.string().min(1),
  product: z.enum(PRODUCT_KINDS),
  credits: z.number().int().min(0),
  plan: z.enum(PLANS),
});

export type ApplePurchaseRequest = z.infer<typeof ApplePurchaseRequestSchema>;
export type ApplePurchaseResponse = z.infer<typeof ApplePurchaseResponseSchema>;
```

`src/apple/products.ts`, exactly:

```ts
import type { ProductKind } from "@waypoint/contracts";

export type AppleProduct =
  | { kind: "own_it"; credits: number; appleType: "Non-Consumable" }
  | { kind: "plus"; period: "monthly" | "yearly"; appleType: "Auto-Renewable Subscription" }
  | { kind: "pack"; credits: number; appleType: "Consumable" };

export const PLUS_MONTHLY_CREDITS = 2000;

// App Store Connect product ids (docs/architecture.md section 7). Change these only together with App Store Connect.
export const APPLE_PRODUCTS: Readonly<Record<string, AppleProduct>> = {
  "waypoint.own_it": { kind: "own_it", credits: 2000, appleType: "Non-Consumable" },
  "waypoint.plus.monthly": { kind: "plus", period: "monthly", appleType: "Auto-Renewable Subscription" },
  "waypoint.plus.yearly": { kind: "plus", period: "yearly", appleType: "Auto-Renewable Subscription" },
  "waypoint.credits.1000": { kind: "pack", credits: 1000, appleType: "Consumable" },
  "waypoint.credits.5000": { kind: "pack", credits: 5000, appleType: "Consumable" },
  "waypoint.credits.20000": { kind: "pack", credits: 20000, appleType: "Consumable" },
};

export function appleProduct(productId: string): AppleProduct | undefined {
  return Object.hasOwn(APPLE_PRODUCTS, productId) ? APPLE_PRODUCTS[productId] : undefined;
}

// The purchases.kind value for a product.
export function purchaseKind(kind: ProductKind): "consumable" | "subscription" | "non_consumable" {
  return kind === "pack" ? "consumable" : kind === "plus" ? "subscription" : "non_consumable";
}

// ms plus whole calendar months in UTC; the day is clamped to the month's last day (Jan 31 + 1 -> Feb 28).
export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const month = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return Date.UTC(
    d.getUTCFullYear(),
    month,
    Math.min(d.getUTCDate(), lastDay),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}
```

`src/apple/transaction.ts`, exactly:

```ts
import { z } from "zod";

// Apple adds fields over time, so unknown keys are allowed (looseObject); the ones used here are checked.
const AppleId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const AppleTransactionSchema = z.looseObject({
  transactionId: AppleId,
  originalTransactionId: AppleId,
  bundleId: z.string(),
  productId: z.string(),
  type: z.string(),
  inAppOwnershipType: z.string(),
  environment: z.string(),
  purchaseDate: z.number().int().min(0),
  signedDate: z.number().int().min(0),
  expiresDate: z.number().int().min(0).optional(),
  quantity: z.number().int().min(1).max(100).optional(),
  appAccountToken: z.string().optional(),
  revocationDate: z.number().int().min(0).optional(),
  revocationType: z.string().optional(),
  revocationPercentage: z.number().int().min(0).max(100000).optional(),
});

export type AppleTransaction = z.infer<typeof AppleTransactionSchema>;

// The comma-separated APPLE_ENVIRONMENTS var as a list, for example "Production,Sandbox".
export function allowedEnvironments(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter((part) => part !== "");
}
```

`src/apple/purchases.ts`, exactly. What `applyTransaction` does, in order: refuse a refunded transaction; refuse a purchase whose original transaction another account recorded; insert the `purchases` row once (status `expired` for a Plus period already over); refuse if the row belongs to another account or was refunded or revoked; then, only for an `active` row, open the entitlement (Own it and Plus; source `family_share` unless `PURCHASED`) and, only for `PURCHASED`, apply one wallet command with id `apple:txn:<transactionId>`: Own it `grant` 2,000 to purchased; a pack `grant` its credits × `quantity`; Plus `reset` to 2,000 until the period end (monthly: `expiresDate`; yearly: one calendar month after `purchaseDate`, or `expiresDate` if sooner). Last, `refreshPlan`.

```ts
import type { Plan, ProductKind } from "@waypoint/contracts";
import type { Command, CommandResult } from "@waypoint/ledger";
import type { Db } from "../storage.ts";
import { addMonths, PLUS_MONTHLY_CREDITS, purchaseKind, type AppleProduct } from "./products.ts";
import type { AppleTransaction } from "./transaction.ts";

export type WalletCommands = { apply(command: Command): Promise<CommandResult> };
export type PurchaseAccount = { user_id: string; billing_account_id: string };
export type PurchaseOutcome =
  | { ok: true; product: ProductKind; credits: number; plan: Plan }
  | { ok: false; reason: "other_account" | "refunded" };

type PurchaseRow = { billing_account_id: string; status: "active" | "refunded" | "revoked" | "expired" };

// The wallet command id for everything a transaction grants. The app's POST and Apple's notice share it,
// so a transaction is granted once however often it arrives.
export function transactionCommandId(transactionId: string): string {
  return `apple:txn:${transactionId}`;
}

// Applies a grant, reset or clawback, which only fail by throwing; any other failure is a bug.
export async function applyWalletCommand(wallet: WalletCommands, command: Command): Promise<void> {
  const result = await wallet.apply(command);
  if (!result.ok) throw new Error("wallet command failed");
}

// Sets users.plan from the open entitlements (plus over own over free) and turns zero retention off
// for anyone who is no longer on Plus. Returns the new plan.
export async function refreshPlan(db: Db, userId: string): Promise<Plan> {
  await db
    .prepare(
      `UPDATE users SET plan = CASE
         WHEN EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = users.id AND e.product = 'plus' AND e.ended_at IS NULL) THEN 'plus'
         WHEN EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = users.id AND e.product = 'own_it' AND e.ended_at IS NULL) THEN 'own'
         ELSE 'free' END
       WHERE id = ?`,
    )
    .bind(userId)
    .run();
  await db.prepare("UPDATE users SET zero_retention = 0 WHERE id = ? AND plan <> 'plus'").bind(userId).run();
  const row = await db.prepare("SELECT plan FROM users WHERE id = ?").bind(userId).first<{ plan: Plan }>();
  if (row === null) throw new Error("user missing");
  return row.plan;
}

// Records one verified transaction for an account and grants what it buys, once per transaction id.
export async function applyTransaction(
  db: Db,
  wallet: WalletCommands,
  account: PurchaseAccount,
  txn: AppleTransaction,
  product: AppleProduct,
  now: number,
): Promise<PurchaseOutcome> {
  if (txn.revocationDate !== undefined) return { ok: false, reason: "refunded" };
  if (txn.inAppOwnershipType === "PURCHASED") {
    // A subscription or purchase belongs to the account that recorded it first, renewals included.
    const owner = await db
      .prepare("SELECT 1 AS found FROM purchases WHERE original_id = ? AND billing_account_id <> ? LIMIT 1")
      .bind(txn.originalTransactionId, account.billing_account_id)
      .first<{ found: number }>();
    if (owner !== null) return { ok: false, reason: "other_account" };
  }
  const expired = product.kind === "plus" && (txn.expiresDate ?? 0) <= now;
  await db
    .prepare(
      "INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (transaction_id) DO NOTHING",
    )
    .bind(
      txn.transactionId,
      txn.originalTransactionId,
      account.billing_account_id,
      txn.productId,
      purchaseKind(product.kind),
      expired ? "expired" : "active",
      txn.purchaseDate,
    )
    .run();
  const row = await db
    .prepare("SELECT billing_account_id, status FROM purchases WHERE transaction_id = ?")
    .bind(txn.transactionId)
    .first<PurchaseRow>();
  if (row === null) throw new Error("purchase row missing after insert");
  if (row.billing_account_id !== account.billing_account_id) return { ok: false, reason: "other_account" };
  if (row.status === "refunded" || row.status === "revoked") return { ok: false, reason: "refunded" };

  let credits = 0;
  if (row.status === "active") {
    const shared = txn.inAppOwnershipType !== "PURCHASED";
    if (product.kind !== "pack") {
      await db
        .prepare(
          "INSERT INTO entitlements (user_id, product, source, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, product, source) DO UPDATE SET ended_at = NULL",
        )
        .bind(account.user_id, product.kind, shared ? "family_share" : "purchase", now)
        .run();
    }
    if (!shared) {
      const id = transactionCommandId(txn.transactionId);
      const ref = `apple:${txn.transactionId}`;
      if (product.kind === "plus") {
        const end = txn.expiresDate ?? now;
        const resetsAt = product.period === "monthly" ? end : Math.min(addMonths(txn.purchaseDate, 1), end);
        await applyWalletCommand(wallet, { type: "reset", id, credits: PLUS_MONTHLY_CREDITS, resets_at: resetsAt });
        credits = PLUS_MONTHLY_CREDITS;
      } else {
        credits = product.credits * (product.kind === "pack" ? (txn.quantity ?? 1) : 1);
        await applyWalletCommand(wallet, { type: "grant", id, bucket: "purchased", credits, ref, user_id: account.user_id });
      }
    }
  }
  return { ok: true, product: product.kind, credits, plan: await refreshPlan(db, account.user_id) };
}
```

`src/apple/route.ts`, exactly. The reply is stored by the PR 11 store (`idempotent`), so a retry with the same key replays it.

```ts
import { ApplePurchaseRequestSchema, type ApplePurchaseResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { AppleJwsError, verifyAppleJws } from "./jws.ts";
import { appleProduct } from "./products.ts";
import { applyTransaction } from "./purchases.ts";
import { allowedEnvironments, AppleTransactionSchema } from "./transaction.ts";

export type ApplePurchaseDeps = { now: () => number; rootSha256: string };

export function applePurchaseRoute(deps: ApplePurchaseDeps): Hono<AppEnv> {
  return new Hono<AppEnv>().post("/v1/purchases/apple", idempotent(deps), async (c) => {
    const user = c.get("user");
    const body: unknown = await c.req.json().catch(() => {
      throw new ApiFailure("bad_request", "invalid request");
    });
    const request = ApplePurchaseRequestSchema.safeParse(body);
    if (!request.success) throw new ApiFailure("bad_request", "invalid request");

    const payload = await verifyAppleJws(request.data.signed_transaction, deps.rootSha256).catch((err: unknown) => {
      if (err instanceof AppleJwsError) throw new ApiFailure("bad_request", "invalid purchase");
      throw err;
    });
    const parsed = AppleTransactionSchema.safeParse(payload);
    if (!parsed.success) throw new ApiFailure("bad_request", "invalid purchase");
    const txn = parsed.data;
    if (txn.bundleId !== c.env.APPLE_BUNDLE_ID) throw new ApiFailure("bad_request", "invalid purchase");
    if (!allowedEnvironments(c.env.APPLE_ENVIRONMENTS).includes(txn.environment)) {
      throw new ApiFailure("bad_request", "invalid purchase");
    }
    const product = appleProduct(txn.productId);
    if (product === undefined || product.appleType !== txn.type) throw new ApiFailure("bad_request", "unknown product");
    if (
      txn.inAppOwnershipType === "PURCHASED" &&
      txn.appAccountToken !== undefined &&
      txn.appAccountToken.toLowerCase() !== user.id.toLowerCase()
    ) {
      throw new ApiFailure("conflict", "purchase belongs to another account");
    }

    const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
    const outcome = await applyTransaction(
      c.env.DB,
      wallet,
      { user_id: user.id, billing_account_id: user.billing_account_id },
      txn,
      product,
      deps.now(),
    );
    if (!outcome.ok) {
      throw new ApiFailure(
        "conflict",
        outcome.reason === "other_account" ? "purchase belongs to another account" : "purchase was refunded",
      );
    }
    const reply: ApplePurchaseResponse = {
      transaction_id: txn.transactionId,
      product: outcome.product,
      credits: outcome.credits,
      plan: outcome.plan,
    };
    return c.json(reply);
  });
}
```

Errors, for reference: bad JSON or body → 400 `bad_request` "invalid request"; a JWS that fails verification, a payload that fails `AppleTransactionSchema`, another bundle id or an environment not in `APPLE_ENVIRONMENTS` → 400 "invalid purchase"; a product id not in the table, or a `type` that does not match it → 400 "unknown product"; another account's purchase → 409 `conflict` "purchase belongs to another account"; a refunded or revoked one → 409 "purchase was refunded".

`src/env.ts`: add to `Env`:

```ts
  APPLE_BUNDLE_ID: string;
  APPLE_ENVIRONMENTS: string; // comma-separated: Production, Sandbox
```

`src/app.ts`: add the imports `import { APPLE_ROOT_CA_G3_SHA256 } from "./apple/jws.ts";` and `import { applePurchaseRoute } from "./apple/route.ts";`, and under the quote route:

```ts
  app.route("/", applePurchaseRoute({ now: deps.now, rootSha256: APPLE_ROOT_CA_G3_SHA256 }));
```

`wrangler.jsonc`: replace the one-line `"vars"` with (same values, two new):

```jsonc
  "vars": {
    "CLERK_ISSUER": "https://clerk.example.com",
    "CLERK_AUTHORIZED_PARTIES": "",
    "APPLE_BUNDLE_ID": "com.example.waypoint",
    "APPLE_ENVIRONMENTS": "Production,Sandbox"
  },
```

The bundle id is a placeholder until the owner sets the real one; it is not a secret.

Tests, `packages/contracts/test/purchases.test.ts`:
- `ApplePurchaseRequestSchema`: a 10-character `signed_transaction` parses; an empty one, one of 16,385 characters and an extra key fail.
- `ApplePurchaseResponseSchema`: a good reply parses; `credits: -1`, `plan: "gold"` and `product: "tip"` fail.

Tests, `apps/api/test/apple-purchase.test.ts`. Setup: `createTestDb()` with the user rows the test needs inserted (`INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)`, `billing_account_id` equal to the id); user ids are UUIDs such as `"6f1c2b9a-0000-4000-8000-000000000001"`; one `makeChain()` in `beforeAll`; the route mounted as `applePurchaseRoute({ now: () => NOW, rootSha256: chain.rootSha256 })` on the fresh app; a new `Idempotency-Key` per request unless the test says otherwise. `env` is `{ DB, WALLET, APPLE_BUNDLE_ID: "com.example.waypoint", APPLE_ENVIRONMENTS: "Production,Sandbox" }`, where `WALLET` runs the real wallet store and records every command:

```ts
const wallets = new Map<string, ReturnType<typeof createWalletStore>>();
const commands: Command[] = [];
const walletFor = (id: string) => {
  let wallet = wallets.get(id);
  if (wallet === undefined) {
    wallet = createWalletStore(createTestStore());
    wallets.set(id, wallet);
  }
  return wallet;
};
const WALLET = {
  idFromName: (name: string) => name,
  get: (id: string) => ({
    apply: async (command: Command) => {
      commands.push(command);
      return walletFor(id).apply(command, NOW);
    },
  }),
};
```

A transaction payload has `transactionId`, `originalTransactionId`, `bundleId`, `productId`, `type`, `inAppOwnershipType: "PURCHASED"`, `environment: "Production"`, `purchaseDate`, `signedDate`, plus an unknown field such as `storefront: "USA"` (it must be ignored). Cases:
- `waypoint.credits.1000` (`Consumable`) → 200, body `{ transaction_id, product: "pack", credits: 1000, plan: "free" }` passing `ApplePurchaseResponseSchema`; purchased balance 1000; one `purchases` row with kind `consumable`, status `active`.
- The same JWS again with a new key → 200, purchased still 1000; both wallet commands had id `apple:txn:<transactionId>`.
- The same JWS with the same key → the stored reply with `Idempotent-Replayed: true`, and no new wallet command.
- `quantity: 3` on `waypoint.credits.5000` → credits 15000.
- `waypoint.own_it` (`Non-Consumable`) → `{ product: "own_it", credits: 2000, plan: "own" }`; an `entitlements` row `own_it` / `purchase` with `ended_at` null; `users.plan` is `own`.
- Own it with `inAppOwnershipType: "FAMILY_SHARED"` for a second user (its own transaction ids) → `credits: 0`, `plan: "own"`; that user's wallet got no command; their entitlement source is `family_share`.
- `waypoint.plus.monthly` with `expiresDate` NOW + 30 days → `{ product: "plus", credits: 2000, plan: "plus" }`; monthly 2000, `monthly_resets_at` equals `expiresDate`; the command is a `reset`.
- `waypoint.plus.yearly` bought `Date.UTC(2026, 0, 31, 10)` with `expiresDate` a year later → `monthly_resets_at` `Date.UTC(2026, 1, 28, 10)`.
- Plus with `expiresDate` before NOW → `credits: 0`, `plan: "free"`, no wallet command, row status `expired`.
- A user with `zero_retention` 1 in D1 buys a pack → `zero_retention` is 0 afterwards (not on Plus); a Plus buyer with `zero_retention` 1 keeps it.
- Another user sends a transaction the first user already recorded → 409 `conflict`; the other user's wallet unchanged.
- Another user sends a Plus renewal (new `transactionId`, same `originalTransactionId`) of the first user's subscription → 409.
- `appAccountToken` set to another user's id → 409. Set to this user's id in capitals → 200.
- `revocationDate` set → 409 "purchase was refunded", no row written.
- Wrong `bundleId` → 400 "invalid purchase". `environment: "Xcode"` → 400. `APPLE_ENVIRONMENTS: "Production"` and `environment: "Sandbox"` → 400.
- `productId: "nope"` → 400 "unknown product". `waypoint.credits.1000` with `type: "Non-Consumable"` → 400 "unknown product".
- A payload without `transactionId` → 400 "invalid purchase". `transactionId: "1/2"` → 400.
- A JWS from another chain (other root) → 400 "invalid purchase".
- Bad JSON → 400 "invalid request"; `{ signed_transaction: "x", extra: 1 }` → 400; no body field → 400. None of the 400 bodies contain the signed transaction text.
- `addMonths`: Jan 31 2026 + 1 → Feb 28 2026; Dec 15 2026 + 1 → Jan 15 2027; Jan 31 2028 + 1 → Feb 29 2028; keeps hours and minutes.

`test/app.test.ts` (add, change nothing else): through `createApp`, `POST /v1/purchases/apple` with no `Authorization` header → 401.

Not in this PR: App Store notices (PR 18), monthly top-ups for Plus yearly (PR 33), OCSP revocation checks, calls to the App Store Server API, `GET /v1/wallet`, restoring purchases in bulk.

---

### PR 18 · `POST /webhooks/apple`

Branch `pr/18-apple-webhook`. Builds on PR 17 (branch after it is merged). No new dependencies. Two sittings: Part A (what a notice does), commit and push, then Part B (the endpoint).

Apple sends App Store Server Notifications V2 as `{ "signedPayload": "<JWS>" }`. The decoded payload has `notificationType`, `subtype`, `notificationUUID`, `signedDate` and usually `data` (`bundleId`, `environment`, `appAppleId` in production, `signedTransactionInfo` as another JWS). Apple retries a notice that does not get HTTP 200.

What each notice does (anything not listed is recorded and answered 200 with no other effect):

| Notice | Effect |
|---|---|
| `SUBSCRIBED`, `DID_RENEW`, `ONE_TIME_CHARGE`, `OFFER_REDEEMED`, `DID_CHANGE_RENEWAL_PREF` with subtype `UPGRADE` | `applyTransaction` from PR 17, the same as the app sending the transaction. A renewal is a `reset` to 2,000 with id `apple:txn:<transactionId>`. |
| `REFUND` | Only if we recorded that transaction for that account and it is `active` and `PURCHASED`: Plus → `reset { id: "apple:<notificationUUID>", credits: 0, resets_at: now }`; Own it or a pack → `clawback { id: "apple:<notificationUUID>", credits, ref: "apple:<transactionId>" }` (credits × quantity; a `REFUND_PRORATED` takes `revocationPercentage` / 100,000 of it, rounded up). Then the row becomes `refunded`, the entitlement ends, the plan is worked out again. |
| `REVOKE` | The same as `REFUND`, with status `revoked`. For a Family Sharing transaction this only ends the `family_share` entitlement. |
| `EXPIRED`, `GRACE_PERIOD_EXPIRED`, `DID_FAIL_TO_RENEW` without a subtype | Plus only, and only if no later period of that subscription is `active`: rows of that original transaction become `expired`, the entitlement ends, and for `PURCHASED` monthly credits reset to 0 with id `apple:<notificationUUID>` (the paid period is over). |

#### Part A: what a notice does

Files: `db/d1/migrations/0003_apple_notifications.sql`, `db/d1/test/schema.test.mjs`, `apps/api/src/apple/notifications.ts`, `apps/api/test/apple-notices.test.ts`. No other files.

`db/d1/migrations/0003_apple_notifications.sql`, exactly:

```sql
-- App Store Server Notifications already handled (PR 18), so a repeated notificationUUID does nothing.
-- Holds only the id, the type and when it was handled; never the signed payload.
CREATE TABLE apple_notifications (
  notification_uuid TEXT NOT NULL PRIMARY KEY,
  notification_type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
```

`db/d1/test/schema.test.mjs`: add `apple_notifications: ["notification_uuid", "notification_type", "received_at"]` to `EXPECTED` and `apple_notifications: { notification_uuid: "TEXT", notification_type: "TEXT", received_at: "INTEGER" }` to `EXPECTED_TYPES`; rename the "creates exactly the 12 directory tables and the idempotency table" test to "creates exactly the expected tables". Add one test: inserting the same `notification_uuid` twice fails. Keep every other test.

`src/apple/notifications.ts`, exactly:

```ts
import { z } from "zod";
import type { Db } from "../storage.ts";
import type { AppleProduct } from "./products.ts";
import {
  applyTransaction,
  applyWalletCommand,
  refreshPlan,
  type PurchaseAccount,
  type WalletCommands,
} from "./purchases.ts";
import type { AppleTransaction } from "./transaction.ts";

// The decoded signedPayload (responseBodyV2DecodedPayload). Unknown keys are allowed.
export const AppleNotificationSchema = z.looseObject({
  notificationType: z.string().min(1).max(64),
  subtype: z.string().max(64).optional(),
  notificationUUID: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  signedDate: z.number().int().min(0),
  data: z
    .looseObject({
      bundleId: z.string(),
      environment: z.string(),
      appAppleId: z.number().int().optional(),
      signedTransactionInfo: z.string().max(16384).optional(),
    })
    .optional(),
});

export type AppleNotification = z.infer<typeof AppleNotificationSchema>;

// Notices that start or continue service: the transaction is applied exactly as POST /v1/purchases/apple does.
const GRANTS = new Set(["SUBSCRIBED", "DID_RENEW", "ONE_TIME_CHARGE", "OFFER_REDEEMED"]);

export type NoticeAction = "grant" | "refund" | "revoke" | "lapse" | "none";

export function actionFor(type: string, subtype: string | undefined): NoticeAction {
  if (GRANTS.has(type)) return "grant";
  if (type === "DID_CHANGE_RENEWAL_PREF" && subtype === "UPGRADE") return "grant";
  if (type === "REFUND") return "refund";
  if (type === "REVOKE") return "revoke";
  if (type === "EXPIRED" || type === "GRACE_PERIOD_EXPIRED") return "lapse";
  if (type === "DID_FAIL_TO_RENEW" && subtype === undefined) return "lapse";
  return "none";
}

const ACCOUNT_BY = (column: "transaction_id" | "original_id"): string =>
  `SELECT u.id AS user_id, u.billing_account_id FROM purchases p JOIN users u ON u.billing_account_id = p.billing_account_id WHERE p.${column} = ? ORDER BY u.created_at, u.id LIMIT 1`;

// The account a transaction belongs to: the one that recorded this transaction, else the one that recorded
// its subscription or purchase, else the user whose id the app put in appAccountToken. null when none is known.
export async function findAccount(db: Db, txn: AppleTransaction): Promise<PurchaseAccount | null> {
  const byTransaction = await db.prepare(ACCOUNT_BY("transaction_id")).bind(txn.transactionId).first<PurchaseAccount>();
  if (byTransaction !== null) return byTransaction;
  const byOriginal = await db.prepare(ACCOUNT_BY("original_id")).bind(txn.originalTransactionId).first<PurchaseAccount>();
  if (byOriginal !== null) return byOriginal;
  if (txn.appAccountToken === undefined) return null;
  return db
    .prepare("SELECT id AS user_id, billing_account_id FROM users WHERE id = ?")
    .bind(txn.appAccountToken.toLowerCase())
    .first<PurchaseAccount>();
}

// Credits a refund takes back from a pack or Own it: all of them, or the refunded share of a prorated refund.
export function refundCredits(product: AppleProduct, txn: AppleTransaction): number {
  if (product.kind === "plus") return 0;
  const credits = product.credits * (product.kind === "pack" ? (txn.quantity ?? 1) : 1);
  if (txn.revocationType === "REFUND_PRORATED" && txn.revocationPercentage !== undefined) {
    return Math.ceil((credits * txn.revocationPercentage) / 100000);
  }
  return credits;
}

async function endEntitlement(
  db: Db,
  account: PurchaseAccount,
  product: AppleProduct,
  txn: AppleTransaction,
  now: number,
): Promise<void> {
  if (product.kind === "pack") return;
  await db
    .prepare("UPDATE entitlements SET ended_at = ? WHERE user_id = ? AND product = ? AND source = ? AND ended_at IS NULL")
    .bind(now, account.user_id, product.kind, txn.inAppOwnershipType === "PURCHASED" ? "purchase" : "family_share")
    .run();
}

export type NoticeInput = {
  db: Db;
  wallet: WalletCommands;
  account: PurchaseAccount;
  notification: AppleNotification;
  txn: AppleTransaction;
  product: AppleProduct;
  now: number;
};

// Applies one verified notice. Safe to run again for the same notice: every wallet command has a fixed id.
export async function applyNotice(input: NoticeInput): Promise<void> {
  const { db, wallet, account, notification, txn, product, now } = input;
  const action = actionFor(notification.notificationType, notification.subtype);
  const commandId = `apple:${notification.notificationUUID}`;
  const purchased = txn.inAppOwnershipType === "PURCHASED";

  if (action === "grant") {
    await applyTransaction(db, wallet, account, txn, product, now);
    return;
  }

  if (action === "refund" || action === "revoke") {
    const row = await db
      .prepare("SELECT status FROM purchases WHERE transaction_id = ? AND billing_account_id = ?")
      .bind(txn.transactionId, account.billing_account_id)
      .first<{ status: string }>();
    if (row === null) return; // never granted here, so nothing to take back
    if (row.status === "active" && purchased) {
      if (product.kind === "plus") {
        await applyWalletCommand(wallet, { type: "reset", id: commandId, credits: 0, resets_at: now });
      } else {
        const credits = refundCredits(product, txn);
        if (credits > 0) {
          await applyWalletCommand(wallet, { type: "clawback", id: commandId, credits, ref: `apple:${txn.transactionId}` });
        }
      }
    }
    await db
      .prepare("UPDATE purchases SET status = ? WHERE transaction_id = ? AND status IN ('active', 'expired')")
      .bind(action === "refund" ? "refunded" : "revoked", txn.transactionId)
      .run();
    await endEntitlement(db, account, product, txn, now);
    await refreshPlan(db, account.user_id);
    return;
  }

  if (action === "lapse" && product.kind === "plus") {
    const later = await db
      .prepare("SELECT 1 AS found FROM purchases WHERE original_id = ? AND status = 'active' AND purchased_at > ? LIMIT 1")
      .bind(txn.originalTransactionId, txn.purchaseDate)
      .first<{ found: number }>();
    if (later !== null) return; // a later period is already active: this notice is out of date
    await db
      .prepare("UPDATE purchases SET status = 'expired' WHERE original_id = ? AND status = 'active'")
      .bind(txn.originalTransactionId)
      .run();
    if (purchased) await applyWalletCommand(wallet, { type: "reset", id: commandId, credits: 0, resets_at: now });
    await endEntitlement(db, account, product, txn, now);
    await refreshPlan(db, account.user_id);
  }
}
```

Tests (`test/apple-notices.test.ts`), calling the functions directly with `createTestDb()` and the recording `WALLET` / real wallet store from the PR 17 tests (one wallet per billing account). Transactions are plain objects typed `AppleTransaction`; notices are typed `AppleNotification`. One bullet is one test.
- `actionFor`: each row of the table above, `DID_CHANGE_RENEWAL_PREF` without subtype → `none`, `DID_FAIL_TO_RENEW` with `GRACE_PERIOD` → `none`, `TEST` → `none`, `CONSUMPTION_REQUEST` → `none`.
- `findAccount`: by transaction id; by original id when the transaction id is new; by `appAccountToken` (given in capitals) when neither is recorded; `null` when there is nothing; `null` for an `appAccountToken` that is no user.
- `refundCredits`: pack 5000 × quantity 2 → 10000; Own it → 2000; `REFUND_PRORATED` with `revocationPercentage` 33333 on 1000 → 334; Plus → 0.
- Grant: `DID_RENEW` for a new transaction of a recorded monthly subscription → `reset` 2000 with id `apple:txn:<new id>` and a new `active` row.
- Grant: `ONE_TIME_CHARGE` for a pack, then the app's own PR 17 path for the same transaction → one grant (purchased 1000).
- Refund of a pack: purchased 1000 → 0, one `clawback` with id `apple:<uuid>`, row `refunded`.
- Refund of a pack after 600 were spent (a hold settled): purchased 0, owed 600.
- Refund of Own it: clawback 2000, entitlement `ended_at` set, plan back to `free`.
- Refund of Plus: monthly → 0 with `reset` id `apple:<uuid>`, credits 0; entitlement ended; plan `free`; `zero_retention` 0.
- The same refund notice applied twice → one wallet command (the second finds the row `refunded`).
- Two different refund notices for the same transaction → one wallet command.
- Refund of a transaction never recorded → no wallet command, no row.
- `REVOKE` of a Family Sharing Own it → no wallet command, `family_share` entitlement ended, the purchaser's entitlement untouched.
- `EXPIRED` for the current Plus period → rows `expired`, monthly 0, entitlement ended, plan `free` (or `own` if the user also has Own it).
- `EXPIRED` that arrives after a later period is already `active` → nothing changes.
- `EXPIRED` for a Family Sharing Plus → entitlement ended, no wallet command.
- `DID_FAIL_TO_RENEW` with subtype `GRACE_PERIOD` → nothing changes.

Run the checks, commit, push.

#### Part B: the endpoint

Files: `apps/api/src/apple/webhook.ts`, `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/wrangler.jsonc`, `apps/api/test/apple-webhook.test.ts`, `apps/api/test/app.test.ts` (new tests only). No other files.

`src/apple/webhook.ts`, exactly:

```ts
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { AppleJwsError, verifyAppleJws } from "./jws.ts";
import { AppleNotificationSchema, applyNotice, findAccount } from "./notifications.ts";
import { appleProduct } from "./products.ts";
import { allowedEnvironments, AppleTransactionSchema } from "./transaction.ts";

export type AppleWebhookDeps = { now: () => number; rootSha256: string };

const BodySchema = z.looseObject({ signedPayload: z.string().min(1).max(65536) });

function invalid(): never {
  throw new ApiFailure("bad_request", "invalid notification");
}

async function verified(jws: string, rootSha256: string): Promise<Record<string, unknown>> {
  return verifyAppleJws(jws, rootSha256).catch((err: unknown) => {
    if (err instanceof AppleJwsError) invalid();
    throw err;
  });
}

// POST /webhooks/apple: App Store Server Notifications V2. Not under /v1, so no session and no Idempotency-Key;
// notificationUUID makes it run once. Replies 200 with no body once handled; any 4xx or 5xx makes Apple retry.
export function appleWebhookRoute(deps: AppleWebhookDeps): Hono<AppEnv> {
  return new Hono<AppEnv>().post("/webhooks/apple", async (c) => {
    const db = c.env.DB;
    const body: unknown = await c.req.json().catch(() => invalid());
    const request = BodySchema.safeParse(body);
    if (!request.success) invalid();
    const parsed = AppleNotificationSchema.safeParse(await verified(request.data.signedPayload, deps.rootSha256));
    if (!parsed.success) invalid();
    const notification = parsed.data;

    const seen = await db
      .prepare("SELECT 1 AS found FROM apple_notifications WHERE notification_uuid = ?")
      .bind(notification.notificationUUID)
      .first<{ found: number }>();
    if (seen !== null) return c.body(null, 200);

    const data = notification.data;
    if (data !== undefined) {
      if (data.bundleId !== c.env.APPLE_BUNDLE_ID) invalid();
      if (!allowedEnvironments(c.env.APPLE_ENVIRONMENTS).includes(data.environment)) invalid();
      if (data.environment === "Production" && data.appAppleId !== Number(c.env.APPLE_APP_APPLE_ID)) invalid();
    }
    if (data?.signedTransactionInfo !== undefined) {
      const txnParsed = AppleTransactionSchema.safeParse(await verified(data.signedTransactionInfo, deps.rootSha256));
      if (!txnParsed.success || txnParsed.data.bundleId !== c.env.APPLE_BUNDLE_ID) invalid();
      const txn = txnParsed.data;
      const product = appleProduct(txn.productId);
      const account = product === undefined ? null : await findAccount(db, txn);
      if (product !== undefined && account !== null) {
        const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(account.billing_account_id));
        await applyNotice({ db, wallet, account, notification, txn, product, now: deps.now() });
      }
    }

    await db
      .prepare(
        "INSERT INTO apple_notifications (notification_uuid, notification_type, received_at) VALUES (?, ?, ?) ON CONFLICT (notification_uuid) DO NOTHING",
      )
      .bind(notification.notificationUUID, notification.notificationType, deps.now())
      .run();
    return c.body(null, 200);
  });
}
```

`src/env.ts`: add `APPLE_APP_APPLE_ID: string; // the app's numeric Apple id from App Store Connect`. `wrangler.jsonc`: add `"APPLE_APP_APPLE_ID": "0"` to `"vars"` (a placeholder: production notices are refused with 400 until the owner sets it, and Apple retries them for 3 days). `src/app.ts`: add `import { appleWebhookRoute } from "./apple/webhook.ts";` and, under the PR 17 line:

```ts
  app.route("/", appleWebhookRoute({ now: deps.now, rootSha256: APPLE_ROOT_CA_G3_SHA256 }));
```

Tests (`test/apple-webhook.test.ts`): the fresh app with no user middleware, `appleWebhookRoute({ now: () => NOW, rootSha256: chain.rootSha256 })`, `env` = `{ DB, WALLET, APPLE_BUNDLE_ID, APPLE_ENVIRONMENTS: "Production,Sandbox", APPLE_APP_APPLE_ID: "1234" }`. A notice is `{ signedPayload: await signJws({ notificationType, subtype?, notificationUUID, version: "2.0", signedDate, data: { bundleId, environment: "Production", appAppleId: 1234, signedTransactionInfo: await signJws(txn, chain) } }, chain) }`, with UUID-shaped ids (hex and hyphens).
- `ONE_TIME_CHARGE` for a pack with `appAccountToken` set to a user → 200 with an empty body; purchased 1000; one `apple_notifications` row holding only the uuid, the type and `received_at`.
- The same notice again → 200, no new wallet command.
- `SUBSCRIBED` (monthly) → plan `plus`, monthly 2000; then `DID_RENEW` for the next transaction → a `reset` with id `apple:txn:<next id>`.
- `REFUND` of that Plus renewal → monthly 0, plan `free`.
- `REFUND` of a pack the app recorded → purchased back to 0.
- A notice for a transaction no account knows → 200, recorded, no wallet command.
- A notice with an unknown `productId` → 200, recorded, no wallet command.
- A `TEST` notice with `data` but no `signedTransactionInfo` → 200, recorded.
- A notice with no `data` (a `summary` instead) → 200, recorded.
- Another `bundleId` in `data` → 400 `bad_request` "invalid notification", nothing recorded.
- `environment: "Sandbox"` with `APPLE_ENVIRONMENTS: "Production"` → 400.
- `environment: "Production"` with `appAppleId` 9 → 400; with `appAppleId` missing → 400; `environment: "Sandbox"` with no `appAppleId` → 200.
- `signedTransactionInfo` signed by another chain → 400; with another `bundleId` → 400.
- `signedPayload` from another chain → 400; `"a.b.c"` → 400; bad JSON → 400; `{}` → 400.
- A `notificationUUID` with a `/` in it → 400.
- A wallet stub whose `apply` throws → 500, nothing recorded (so Apple retries), and the same notice later with a working wallet succeeds.

`test/app.test.ts` (add, change nothing else): through `createApp`, `POST /webhooks/apple` with no `Authorization` and no `Idempotency-Key` and body `{}` → 400 `bad_request` (not 401: the route is outside `/v1/*`).

Not in this PR: `REFUND_REVERSED` (see open questions), `CONSUMPTION_REQUEST` replies, Plus yearly monthly top-ups (PR 33), deleting old `apple_notifications` rows, a queue for notices (they are handled inline; Apple retries on failure).

---

### PR 31 · Push: `POST /v1/push-tokens` and the APNs queue consumer

Branch `pr/31-push`. No new dependencies. Does not depend on PR 17 or 18. Two sittings: Part A (storing tokens), commit and push, then Part B (sending).

How push works here: other code (job workflows, sync, device approval, in later cards) sends a `PushMessage` to the `PUSH_QUEUE` queue. The consumer looks up the user's APNs tokens in D1 and calls APNs with `fetch` and a provider token (an ES256 JWT signed with the `.p8` key). Alert text is fixed per message kind; payloads carry only the kind and an id, never note text. See "What was checked during planning" for why a Worker's `fetch` can reach APNs.

#### Part A: storing tokens

Files: `db/d1/migrations/0004_push_tokens.sql`, `db/d1/test/schema.test.mjs`, `packages/contracts/src/push.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/push.test.ts`, `apps/api/src/push/route.ts`, `apps/api/src/app.ts`, `apps/api/test/push-route.test.ts`, `apps/api/test/app.test.ts` (new tests only). No other files.

`db/d1/migrations/0004_push_tokens.sql`, exactly:

```sql
-- APNs device tokens (PR 31). One row per signed-in app install; a token belongs to one user at a time.
-- device_id is the app's own install id; it does not reference devices(id) until device registration (S1) exists.
CREATE TABLE push_tokens (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
```

`db/d1/test/schema.test.mjs`: add `push_tokens: ["user_id", "device_id", "token", "environment", "updated_at"]` to `EXPECTED` and `push_tokens: { user_id: "TEXT", device_id: "TEXT", token: "TEXT", environment: "TEXT", updated_at: "INTEGER" }` to `EXPECTED_TYPES` (if PR 18 has not renamed the "creates exactly ..." test yet, rename it to "creates exactly the expected tables"). Add tests: `environment` rejects `'dev'`; the same token for two rows is rejected; deleting the user deletes their rows.

`packages/contracts/src/push.ts`, exactly, and `export * from "./push.ts";` at the end of `packages/contracts/src/index.ts`:

```ts
import { z } from "zod";

// The app's own install id, the APNs device token as lowercase hex, and which APNs server issued it
// (sandbox for development and TestFlight-from-Xcode builds, production for App Store and TestFlight builds).
export const PushTokenRequestSchema = z.strictObject({
  device_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  token: z.string().regex(/^[0-9a-f]{64,200}$/),
  environment: z.enum(["sandbox", "production"]),
});

export const PushTokenResponseSchema = z.strictObject({ device_id: z.string().min(1) });

export type PushTokenRequest = z.infer<typeof PushTokenRequestSchema>;
export type PushTokenResponse = z.infer<typeof PushTokenResponseSchema>;
```

`src/push/route.ts`, exactly:

```ts
import { PushTokenRequestSchema, type PushTokenResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";

export const MAX_PUSH_DEVICES = 10;

export function pushTokenRoute(deps: { now: () => number }): Hono<AppEnv> {
  return new Hono<AppEnv>().post("/v1/push-tokens", idempotent(deps), async (c) => {
    const user = c.get("user");
    const body: unknown = await c.req.json().catch(() => {
      throw new ApiFailure("bad_request", "invalid request");
    });
    const parsed = PushTokenRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
    const { device_id, token, environment } = parsed.data;
    const db = c.env.DB;

    const others = await db
      .prepare("SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ? AND device_id <> ?")
      .bind(user.id, device_id)
      .first<{ n: number }>();
    if ((others?.n ?? 0) >= MAX_PUSH_DEVICES) throw new ApiFailure("conflict", "too many devices");

    // A token moves with the app install: whoever registers it last gets its pushes.
    await db
      .prepare("DELETE FROM push_tokens WHERE token = ? AND NOT (user_id = ? AND device_id = ?)")
      .bind(token, user.id, device_id)
      .run();
    await db
      .prepare(
        "INSERT INTO push_tokens (user_id, device_id, token, environment, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, device_id) DO UPDATE SET token = excluded.token, environment = excluded.environment, updated_at = excluded.updated_at",
      )
      .bind(user.id, device_id, token, environment, deps.now())
      .run();
    const reply: PushTokenResponse = { device_id };
    return c.json(reply);
  });
}
```

`src/app.ts`: add `import { pushTokenRoute } from "./push/route.ts";` and, under the last route line, `app.route("/", pushTokenRoute({ now: deps.now }));`.

Tests, `packages/contracts/test/push.test.ts`: a good request parses; a token in capitals, a token of 63 characters, a token of 201 characters, a `device_id` of 7 characters, `environment: "dev"` and an extra key each fail.

Tests, `apps/api/test/push-route.test.ts` (fresh app, `createTestDb()` with users `u1` and `u2`, `env` `{ DB }`, a new `Idempotency-Key` per request unless said otherwise):
- A good request → 200 `{ device_id }` passing `PushTokenResponseSchema`; the row has the token, environment and `updated_at` NOW.
- The same device with a new token → one row, the new token.
- The same token sent by `u2` for its own device → `u1`'s row is gone, `u2` has it.
- The same token from the same user under a new `device_id` → only the new row remains.
- 10 devices for `u1`, then an 11th → 409 `conflict` "too many devices"; updating one of the 10 still works.
- Bad JSON, an uppercase token and an extra key → 400 `bad_request`, nothing stored.
- The same key and body twice → the second reply has `Idempotent-Replayed: true`.

`test/app.test.ts` (add): through `createApp`, `POST /v1/push-tokens` with no `Authorization` → 401.

Run the checks, commit, push.

#### Part B: sending

Files: `apps/api/src/queue.ts`, `apps/api/src/push/messages.ts`, `apps/api/src/push/apns.ts`, `apps/api/src/push/consumer.ts`, `apps/api/src/index.ts`, `apps/api/src/env.ts`, `apps/api/wrangler.jsonc`, `apps/api/test/push.test.ts`. No other files.

`src/queue.ts`, exactly:

```ts
// The parts of a Queues batch the consumers use. MessageBatch<unknown> satisfies this type.
export type QueueMessage = {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type QueueBatch = { readonly queue: string; readonly messages: readonly QueueMessage[] };
```

`src/push/messages.ts`, exactly:

```ts
import { z } from "zod";

export const PUSH_KINDS = ["job_ready", "sync", "device_request", "device_approved"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

// A message on the push queue. ref is an id the app uses to open the right screen (a job id, a group id);
// device_id null means every device of the user. Never note text.
export const PushMessageSchema = z.strictObject({
  user_id: z.string().min(1).max(128),
  kind: z.enum(PUSH_KINDS),
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/).nullable(),
  device_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable(),
});

export type PushMessage = z.infer<typeof PushMessageSchema>;

export type ApnsNotification = {
  pushType: "alert" | "background";
  priority: 10 | 5;
  collapseId: string; // at most 64 bytes
  payload: Record<string, unknown>;
};

// Fixed text per kind. The payload carries only the kind and ref, never anything from a note.
const ALERTS: Readonly<Record<Exclude<PushKind, "sync">, string>> = {
  job_ready: "Your result is ready.",
  device_request: "A new device wants to sign in. Open Waypoint to compare the code.",
  device_approved: "Your new device was approved.",
};

export function notificationFor(message: PushMessage): ApnsNotification {
  const collapseId = `${message.kind}:${message.ref ?? "none"}`;
  if (message.kind === "sync") {
    return {
      pushType: "background",
      priority: 5,
      collapseId,
      payload: { aps: { "content-available": 1 }, kind: message.kind, ref: message.ref },
    };
  }
  return {
    pushType: "alert",
    priority: 10,
    collapseId,
    payload: {
      aps: { alert: { title: "Waypoint", body: ALERTS[message.kind] }, sound: "default" },
      kind: message.kind,
      ref: message.ref,
    },
  };
}
```

`src/push/apns.ts`, exactly:

```ts
import type { ApnsNotification } from "./messages.ts";

export type ApnsConfig = { keyId: string; teamId: string; privateKeyPem: string; topic: string };
export type ApnsDevice = { token: string; environment: "sandbox" | "production" };
export type ApnsResult = "sent" | "drop_token" | "retry" | "failed";
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// APNs wants a provider token refreshed at most every 20 and at least every 60 minutes. Every isolate
// rounds iat down to the same 30-minute step, so they all present the same iat.
export const APNS_TOKEN_STEP_SECONDS = 30 * 60;
const HOSTS = { sandbox: "api.sandbox.push.apple.com", production: "api.push.apple.com" } as const;
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered", "ExpiredToken"]);

function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// The DER bytes inside a "-----BEGIN PRIVATE KEY-----" PEM (the .p8 file from the Apple developer site).
export function pemToPkcs8(pem: string): Uint8Array {
  const match = /-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----/.exec(pem);
  if (match === null) throw new Error("APNS_PRIVATE_KEY is not a PKCS#8 PEM");
  return Uint8Array.from(atob((match[1] ?? "").replace(/\s+/g, "")), (ch) => ch.charCodeAt(0));
}

export async function signApnsJwt(config: ApnsConfig, iatSeconds: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(config.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const encode = (value: unknown): string => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${encode({ alg: "ES256", kid: config.keyId })}.${encode({ iss: config.teamId, iat: iatSeconds })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `${input}.${toBase64Url(new Uint8Array(signature))}`;
}

// Returns a function that gives the current provider token, signing a new one only when the 30-minute step changes.
export function apnsJwtSource(now: () => number): (config: ApnsConfig) => Promise<string> {
  let cached: { key: string; jwt: string } | null = null;
  return async (config) => {
    const iat = Math.floor(now() / 1000 / APNS_TOKEN_STEP_SECONDS) * APNS_TOKEN_STEP_SECONDS;
    const key = `${config.keyId}:${config.teamId}:${iat}`;
    if (cached === null || cached.key !== key) cached = { key, jwt: await signApnsJwt(config, iat) };
    return cached.jwt;
  };
}

// Sends one notification to one device and says what to do next. Never logs the token or the payload.
export async function sendApns(
  fetchFn: FetchLike,
  jwt: string,
  config: ApnsConfig,
  device: ApnsDevice,
  notification: ApnsNotification,
  expiresAtSeconds: number,
): Promise<ApnsResult> {
  let response: Response;
  try {
    response = await fetchFn(`https://${HOSTS[device.environment]}/3/device/${device.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": config.topic,
        "apns-push-type": notification.pushType,
        "apns-priority": String(notification.priority),
        "apns-expiration": String(expiresAtSeconds),
        "apns-collapse-id": notification.collapseId,
        "content-type": "application/json",
      },
      body: JSON.stringify(notification.payload),
    });
  } catch {
    return "retry";
  }
  if (response.status === 200) return "sent";
  const reply: unknown = await response.json().catch(() => null);
  const reason =
    typeof reply === "object" && reply !== null && "reason" in reply && typeof reply.reason === "string" ? reply.reason : "";
  if (response.status === 410 || DEAD_TOKEN_REASONS.has(reason)) return "drop_token";
  if (response.status === 403 || response.status === 429 || response.status >= 500) return "retry";
  return "failed";
}
```

`src/push/consumer.ts`, exactly:

```ts
import type { QueueBatch } from "../queue.ts";
import type { Db } from "../storage.ts";
import { sendApns, type ApnsConfig, type ApnsDevice, type FetchLike } from "./apns.ts";
import { notificationFor, PushMessageSchema } from "./messages.ts";

export const PUSH_QUEUE_NAME = "waypoint-push";
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
export const PUSH_RETRY_DELAY_SECONDS = 60;

export type PushEnv = {
  DB: Db;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_TOPIC: string;
  APNS_PRIVATE_KEY: string;
};

export type PushDeps = { fetch: FetchLike; now: () => number; jwt: (config: ApnsConfig) => Promise<string> };

type TokenRow = ApnsDevice & { device_id: string };

export async function handlePushBatch(batch: QueueBatch, env: PushEnv, deps: PushDeps): Promise<void> {
  const config: ApnsConfig = {
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
    privateKeyPem: env.APNS_PRIVATE_KEY,
    topic: env.APNS_TOPIC,
  };
  for (const message of batch.messages) {
    const parsed = PushMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack(); // a bad message never gets better; drop it
      continue;
    }
    const push = parsed.data;
    try {
      const query =
        push.device_id === null
          ? env.DB.prepare("SELECT device_id, token, environment FROM push_tokens WHERE user_id = ?").bind(push.user_id)
          : env.DB.prepare("SELECT device_id, token, environment FROM push_tokens WHERE user_id = ? AND device_id = ?").bind(
              push.user_id,
              push.device_id,
            );
      const { results } = await query.all<TokenRow>();
      const jwt = await deps.jwt(config);
      const notification = notificationFor(push);
      const expiresAt = Math.floor(deps.now() / 1000) + PUSH_TTL_SECONDS;
      let retry = false;
      for (const device of results) {
        const result = await sendApns(deps.fetch, jwt, config, device, notification, expiresAt);
        if (result === "drop_token") {
          await env.DB.prepare("DELETE FROM push_tokens WHERE token = ?").bind(device.token).run();
        }
        if (result === "retry") retry = true;
      }
      if (retry) message.retry({ delaySeconds: PUSH_RETRY_DELAY_SECONDS });
      else message.ack();
    } catch {
      message.retry({ delaySeconds: PUSH_RETRY_DELAY_SECONDS });
    }
  }
}
```

`src/index.ts`, exactly (the Worker now exports an object with `fetch` and `queue`; tests never import this file):

```ts
import { createApp } from "./app.ts";
import type { Env } from "./env.ts";
import { apnsJwtSource } from "./push/apns.ts";
import { handlePushBatch, PUSH_QUEUE_NAME, type PushDeps } from "./push/consumer.ts";

export { GroupRoom } from "./room/object.ts";
export { Wallet } from "./wallet/object.ts";

const app = createApp({
  fetchJwks: (url) => fetch(url).then((r) => r.json()),
  now: Date.now,
  newId: () => crypto.randomUUID(),
});

const pushDeps: PushDeps = { fetch: (input, init) => fetch(input, init), now: Date.now, jwt: apnsJwtSource(Date.now) };

export default {
  fetch: app.fetch,
  async queue(batch, env) {
    if (batch.queue === PUSH_QUEUE_NAME) return handlePushBatch(batch, env, pushDeps);
    throw new Error("unknown queue");
  },
} satisfies ExportedHandler<Env>;
```

`src/env.ts`: add `import type { PushMessage } from "./push/messages.ts";` and to `Env`:

```ts
  PUSH_QUEUE: Queue<PushMessage>;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  APNS_TOPIC: string;
  APNS_PRIVATE_KEY: string; // secret: wrangler secret put APNS_PRIVATE_KEY
```

`wrangler.jsonc`: add `"APNS_KEY_ID": "XXXXXXXXXX"`, `"APNS_TEAM_ID": "XXXXXXXXXX"` and `"APNS_TOPIC": "com.example.waypoint"` to `"vars"` (placeholders; the key id and team id are not secrets), and at the top level:

```jsonc
  "queues": {
    "producers": [{ "binding": "PUSH_QUEUE", "queue": "waypoint-push" }],
    "consumers": [{ "queue": "waypoint-push", "max_batch_size": 50, "max_batch_timeout": 5, "max_retries": 5 }]
  }
```

`APNS_PRIVATE_KEY` is never in `vars` or in the repo. The owner sets it with `npx wrangler secret put APNS_PRIVATE_KEY < AuthKey_<KEY ID>.p8` (the whole PEM file, header lines included).

Tests (`test/push.test.ts`). Make the `.p8` stand-in in the test: generate a P-256 ECDSA key, `exportKey("pkcs8", ...)` (narrow the result with `instanceof ArrayBuffer`), base64 in 64-character lines between `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`. `fetch` is a stub that records `url` and `init` and returns a `Response` the test chooses. Queue messages are hand-made `QueueMessage` objects whose `ack` and `retry` record calls. One bullet is one test.
- Compile-time check: `export const batchFits: (batch: MessageBatch<unknown>) => QueueBatch = (batch) => batch;`
- `signApnsJwt(config, 1800)`: header `{ alg: "ES256", kid }`, claims `{ iss: teamId, iat: 1800 }`, and the signature verifies with the public key.
- `apnsJwtSource`: two calls 1 minute apart inside one 30-minute step return the same token; a call after the step boundary returns a new one whose `iat` is the boundary.
- `pemToPkcs8("nope")` throws.
- `notificationFor`: `job_ready`, `device_request`, `device_approved` are `alert`, priority 10, with their fixed text, and the payload's only keys are `aps`, `kind`, `ref`; `sync` is `background`, priority 5, `aps` `{ "content-available": 1 }`; `collapseId` is `"<kind>:<ref>"`, or `"<kind>:none"` when `ref` is null.
- `PushMessageSchema` rejects an extra key (for example `text`), a `ref` of 49 characters and an unknown kind.
- `sendApns`: a sandbox device goes to `https://api.sandbox.push.apple.com/3/device/<token>`, a production one to `https://api.push.apple.com/3/device/<token>`; the request has `authorization: bearer <jwt>`, `apns-topic`, `apns-push-type`, `apns-priority`, `apns-expiration`, `apns-collapse-id`, and the JSON payload as body.
- `sendApns` results: 200 → `sent`; 410 → `drop_token`; 400 `{ "reason": "BadDeviceToken" }` → `drop_token`; 400 `DeviceTokenNotForTopic` → `drop_token`; 400 `BadPriority` → `failed`; 403 `ExpiredProviderToken` → `retry`; 429 → `retry`; 500 and 503 → `retry`; a `fetch` that throws → `retry`; a 400 with a body that is not JSON → `failed`.
- Consumer: a user with two tokens gets two sends and the message is acked; `device_id` set sends to that device only.
- Consumer: a user with no tokens → acked, no `fetch`.
- Consumer: a 410 deletes that token's row and the message is acked.
- Consumer: one send `retry`, one `sent` → `retry({ delaySeconds: 60 })`, no ack.
- Consumer: an invalid message body → acked, no `fetch`, no D1 read.
- Consumer: a D1 that throws on `prepare` → `retry({ delaySeconds: 60 })`.
- Consumer: no request body or URL the stub saw contains the `.p8` PEM text.

Not in this PR: sending to the queue from jobs, sync or devices (their own cards), deleting a token on sign-out, Android, Live Activity pushes, a dead-letter queue.

---

### PR 32 · `PUT /v1/settings/zero-retention` and `GET /v1/activity`

Branch `pr/32-privacy`. No new dependencies. One sitting. Does not depend on 17, 18 or 31.

Files: `packages/contracts/src/privacy.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/privacy.test.ts`, `apps/api/src/privacy/routes.ts`, `apps/api/src/app.ts`, `apps/api/test/privacy.test.ts`, `apps/api/test/app.test.ts` (new tests only). No other files.

Behaviour: turning zero retention **on** needs Plus (`user.plan === "plus"`), else 403 `plan_required`; turning it **off** is always allowed (someone whose Plus ended must be able to switch it off; PR 17 also turns it off when Plus ends). The reply is stored by the PR 11 store. `GET /v1/activity` lists the signed-in user's `activity` rows newest first: `id, task, bytes_sent` (the size), `credits, route, retention, at`. Nothing else, and no text. Paging: `?limit=` 1 to 100 (default 50) and `?before=<next>` from the previous page.

`packages/contracts/src/privacy.ts`, exactly, and `export * from "./privacy.ts";` at the end of `packages/contracts/src/index.ts`:

```ts
import { z } from "zod";
import { INSTANT_TASKS, JOB_TYPES } from "./tasks.ts";

export const ZeroRetentionRequestSchema = z.strictObject({ enabled: z.boolean() });
export const ZeroRetentionResponseSchema = z.strictObject({ zero_retention: z.boolean() });

export const ACTIVITY_TASKS = [...INSTANT_TASKS, ...JOB_TYPES] as const;

// One cloud task as GET /v1/activity shows it. No text: the text sent is kept only on the device.
export const ActivityItemSchema = z.strictObject({
  id: z.string().min(1),
  task: z.enum(ACTIVITY_TASKS),
  bytes_sent: z.number().int().min(0),
  credits: z.number().int().min(0),
  route: z.string().min(1),
  retention: z.enum(["standard", "zero"]),
  at: z.number().int().min(0),
});

// next: pass it back as ?before= for the following page; null when there are no older items.
export const ActivityResponseSchema = z.strictObject({
  items: z.array(ActivityItemSchema),
  next: z.string().nullable(),
});

export type ZeroRetentionRequest = z.infer<typeof ZeroRetentionRequestSchema>;
export type ZeroRetentionResponse = z.infer<typeof ZeroRetentionResponseSchema>;
export type ActivityItem = z.infer<typeof ActivityItemSchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
```

`src/privacy/routes.ts`, exactly:

```ts
import {
  ZeroRetentionRequestSchema,
  type ActivityItem,
  type ActivityResponse,
  type ZeroRetentionResponse,
} from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";

export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 100;

// Cursor "<at>_<id>": the last item of the page before. Items are newest first, ties broken by id.
function parseCursor(value: string | undefined): { at: number; id: string } | null {
  if (value === undefined) return null;
  const match = /^(\d{1,16})_([A-Za-z0-9_:-]{1,128})$/.exec(value);
  if (match === null) throw new ApiFailure("bad_request", "invalid request");
  return { at: Number(match[1]), id: match[2] ?? "" };
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return ACTIVITY_DEFAULT_LIMIT;
  if (!/^\d{1,3}$/.test(value)) throw new ApiFailure("bad_request", "invalid request");
  const limit = Number(value);
  if (limit < 1 || limit > ACTIVITY_MAX_LIMIT) throw new ApiFailure("bad_request", "invalid request");
  return limit;
}

export function privacyRoutes(deps: { now: () => number }): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .put("/v1/settings/zero-retention", idempotent(deps), async (c) => {
      const user = c.get("user");
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = ZeroRetentionRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const enabled = parsed.data.enabled;
      if (enabled && user.plan !== "plus") throw new ApiFailure("plan_required", "zero retention needs Plus");
      await c.env.DB.prepare("UPDATE users SET zero_retention = ? WHERE id = ?").bind(enabled ? 1 : 0, user.id).run();
      const reply: ZeroRetentionResponse = { zero_retention: enabled };
      return c.json(reply);
    })
    .get("/v1/activity", async (c) => {
      const user = c.get("user");
      const limit = parseLimit(c.req.query("limit"));
      const before = parseCursor(c.req.query("before"));
      const columns = "id, task, bytes_sent, credits, route, retention, at";
      const query =
        before === null
          ? c.env.DB.prepare(`SELECT ${columns} FROM activity WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT ?`).bind(
              user.id,
              limit + 1,
            )
          : c.env.DB.prepare(
              `SELECT ${columns} FROM activity WHERE user_id = ? AND (at < ? OR (at = ? AND id < ?)) ORDER BY at DESC, id DESC LIMIT ?`,
            ).bind(user.id, before.at, before.at, before.id, limit + 1);
      const { results } = await query.all<ActivityItem>();
      const items = results.slice(0, limit);
      const last = items[items.length - 1];
      const reply: ActivityResponse = {
        items,
        next: results.length > limit && last !== undefined ? `${last.at}_${last.id}` : null,
      };
      return c.json(reply);
    });
}
```

`src/app.ts`: add `import { privacyRoutes } from "./privacy/routes.ts";` and, under the last route line, `app.route("/", privacyRoutes({ now: deps.now }));`.

Tests, `packages/contracts/test/privacy.test.ts`: `ZeroRetentionRequestSchema` rejects `{ enabled: "yes" }` and an extra key; `ActivityItemSchema` rejects an extra `text` key and an unknown task; `ActivityResponseSchema` accepts `next: null`.

Tests, `apps/api/test/privacy.test.ts` (fresh app, `createTestDb()` with users `u1` and `u2`, activity rows inserted by hand):
- A Plus user turning it on → 200 `{ zero_retention: true }`; `users.zero_retention` is 1.
- A Plus user turning it off → 200 `{ zero_retention: false }`; the column is 0.
- A free user turning it on → 403 with `code: "plan_required"`; the column stays 0.
- An `own` user turning it on → 403 `plan_required`.
- A free user turning it off → 200.
- `{ "enabled": "yes" }`, bad JSON and an extra key → 400.
- The same key and body twice → replayed with `Idempotent-Replayed: true`.
- Activity: 5 rows for `u1` and 2 for `u2`; `?limit=2` gives the 2 newest of `u1` and a `next`; following `next` gives the next 2; the last page has 1 item and `next: null`; `u2`'s rows never appear. Every body passes `ActivityResponseSchema`.
- Activity: two rows with the same `at` are ordered by id descending and paging does not skip or repeat either.
- Activity: no rows → `{ items: [], next: null }`.
- Activity: `limit=0`, `limit=101`, `limit=abc` and `before=nonsense` → 400.
- Activity: a reply item has exactly the keys `id, task, bytes_sent, credits, route, retention, at`.

`test/app.test.ts` (add): through `createApp`, `GET /v1/activity` with no `Authorization` → 401.

Not in this PR: writing `activity` rows (PR 33 Part A), using `zero_retention` when routing (PR 13/14), deleting activity.

---

### PR 33 · Usage events, Analytics Engine, the cleanup cron and Plus yearly top-ups

Branch `pr/33-usage-cleanup`. Builds on PR 17 and PR 31 (branch after both are merged). No new dependencies. Two sittings: Part A (usage events), commit and push, then Part B (the cron).

**R2.** No card merged before this one adds an R2 binding (checked on `main` on 19 Nov 2026), so Part B adds it as `BUCKET`. If one has been merged by the time you start, use it, do not add a second, and use its binding name wherever this card says `BUCKET`; say so in the pull request.

#### Part A: usage events to D1 activity and Analytics Engine

Files: `apps/api/src/usage.ts`, `apps/api/src/index.ts`, `apps/api/src/env.ts`, `apps/api/wrangler.jsonc`, `apps/api/test/usage.test.ts`. No other files.

Flow 1 says a usage event goes to a queue. Task code (PR 14, 15, 20 and later) sends a `UsageEvent` to `USAGE_QUEUE` after it settles; this consumer writes the `activity` row the person sees in `GET /v1/activity` and one Analytics Engine data point (task, route, retention, credits, bytes; no user id, no text). `task` comes from the typed task list (the wave 3 note), and `id` should be the hold id so a redelivered event is written once.

`src/usage.ts`, exactly:

```ts
import { INSTANT_TASKS, JOB_TYPES } from "@waypoint/contracts";
import { TIERS } from "@waypoint/router";
import { z } from "zod";
import type { QueueBatch } from "./queue.ts";
import type { Db } from "./storage.ts";

export const USAGE_QUEUE_NAME = "waypoint-usage";
export const USAGE_TASKS = [...INSTANT_TASKS, ...JOB_TYPES] as const;

// One finished cloud task, sent to the usage queue by the task and job code. Counts and names only, never text.
// id is unique per task run (the hold id works) so a redelivered message is written once.
export const UsageEventSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_:-]{1,128}$/),
  user_id: z.string().min(1).max(128),
  task: z.enum(USAGE_TASKS),
  bytes_sent: z.number().int().min(0),
  credits: z.number().int().min(0),
  route: z.enum(TIERS),
  retention: z.enum(["standard", "zero"]),
  at: z.number().int().min(0),
});

export type UsageEvent = z.infer<typeof UsageEventSchema>;

// The part of an Analytics Engine dataset this Worker uses. AnalyticsEngineDataset satisfies this type.
export type UsageDataset = { writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void };

export type UsageEnv = { DB: Db; USAGE: UsageDataset };

// Writes each event to D1 activity (what GET /v1/activity shows the person) and, the first time only, one
// Analytics Engine data point with no user id: index task; blobs task, route, retention; doubles credits, bytes_sent.
export async function handleUsageBatch(batch: QueueBatch, env: UsageEnv): Promise<void> {
  for (const message of batch.messages) {
    const parsed = UsageEventSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack();
      continue;
    }
    const e = parsed.data;
    try {
      const { meta } = await env.DB.prepare(
        "INSERT INTO activity (id, user_id, task, bytes_sent, credits, route, retention, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
      )
        .bind(e.id, e.user_id, e.task, e.bytes_sent, e.credits, e.route, e.retention, e.at)
        .run();
      if (meta.changes === 1) {
        env.USAGE.writeDataPoint({ indexes: [e.task], blobs: [e.task, e.route, e.retention], doubles: [e.credits, e.bytes_sent] });
      }
      message.ack();
    } catch {
      message.retry({ delaySeconds: 30 });
    }
  }
}
```

`src/env.ts`: add `import type { UsageEvent } from "./usage.ts";` and to `Env`:

```ts
  USAGE_QUEUE: Queue<UsageEvent>;
  USAGE: AnalyticsEngineDataset;
```

`wrangler.jsonc`: the `"queues"` block becomes:

```jsonc
  "queues": {
    "producers": [
      { "binding": "PUSH_QUEUE", "queue": "waypoint-push" },
      { "binding": "USAGE_QUEUE", "queue": "waypoint-usage" }
    ],
    "consumers": [
      { "queue": "waypoint-push", "max_batch_size": 50, "max_batch_timeout": 5, "max_retries": 5 },
      { "queue": "waypoint-usage", "max_batch_size": 100, "max_batch_timeout": 30, "max_retries": 10 }
    ]
  },
  "analytics_engine_datasets": [{ "binding": "USAGE", "dataset": "waypoint_usage" }]
```

`src/index.ts`: add `import { handleUsageBatch, USAGE_QUEUE_NAME } from "./usage.ts";` and, in `queue`, after the push line: `if (batch.queue === USAGE_QUEUE_NAME) return handleUsageBatch(batch, env);`. (Part B gives the whole file.)

Tests (`test/usage.test.ts`), with `createTestDb()` and user `u1`, a `USAGE` stub that records data points, and hand-made `QueueMessage` objects:
- Compile-time check: `export const aeFits: (dataset: AnalyticsEngineDataset) => UsageDataset = (dataset) => dataset;`
- A good event → one `activity` row with exactly its fields; one data point `{ indexes: [task], blobs: [task, route, retention], doubles: [credits, bytes_sent] }`; acked.
- The same event twice in one batch → one row, one data point, both acked.
- An event with an extra `text` key → acked, no row, no data point.
- An event with task `"summarize"` → acked, nothing written. With route `"gpt"` → acked, nothing written.
- An event for a user that does not exist (foreign key fails) → `retry({ delaySeconds: 30 })`, no data point.
- No data point holds the user id.

Run the checks, commit, push.

#### Part B: the hourly cron

Files: `apps/api/src/cleanup.ts`, `apps/api/src/apple/allowance.ts`, `apps/api/src/index.ts`, `apps/api/src/env.ts`, `apps/api/wrangler.jsonc`, `apps/api/test/cleanup.test.ts`, `apps/api/test/allowance.test.ts`. No other files.

Every hour: delete `results/` objects older than 7 days and `tmp/audio/` objects older than 24 hours (the second transcript deletes its own audio when the job ends; this catches what a failed job left), delete `idempotency` rows older than 24 hours (the PR 11 table), and give Plus yearly subscribers their monthly reset.

`src/cleanup.ts`, exactly:

```ts
import type { Db } from "./storage.ts";

export const RESULTS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const TMP_AUDIO_KEEP_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_ROWS_KEEP_MS = 24 * 60 * 60 * 1000;
export const MAX_LIST_PAGES = 20;

// The parts of an R2 bucket the cleanup uses. R2Bucket satisfies this type.
export type CleanupBucket = {
  list(options: { prefix: string; limit: number; cursor?: string }): Promise<{
    objects: { key: string; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
};

// Deletes objects under prefix uploaded before cutoff, at most MAX_LIST_PAGES pages of 1,000 per run.
// The next run carries on where this one stopped. Returns how many were deleted.
export async function deleteOlderThan(bucket: CleanupBucket, prefix: string, cutoff: number): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const listed = await bucket.list(cursor === undefined ? { prefix, limit: 1000 } : { prefix, limit: 1000, cursor });
    const old = listed.objects.filter((object) => object.uploaded.getTime() < cutoff).map((object) => object.key);
    if (old.length > 0) {
      await bucket.delete(old);
      deleted += old.length;
    }
    if (!listed.truncated || listed.cursor === undefined) break;
    cursor = listed.cursor;
  }
  return deleted;
}

export type CleanupEnv = { DB: Db; BUCKET: CleanupBucket };

export async function cleanup(env: CleanupEnv, now: number): Promise<{ results: number; tmp_audio: number; idempotency: number }> {
  const results = await deleteOlderThan(env.BUCKET, "results/", now - RESULTS_KEEP_MS);
  const tmpAudio = await deleteOlderThan(env.BUCKET, "tmp/audio/", now - TMP_AUDIO_KEEP_MS);
  const { meta } = await env.DB.prepare("DELETE FROM idempotency WHERE created_at < ?").bind(now - IDEMPOTENCY_ROWS_KEEP_MS).run();
  return { results, tmp_audio: tmpAudio, idempotency: meta.changes };
}
```

`src/apple/allowance.ts`, exactly:

```ts
import type { Db } from "../storage.ts";
import { addMonths, APPLE_PRODUCTS, PLUS_MONTHLY_CREDITS } from "./products.ts";
import type { WalletCommands } from "./purchases.ts";

const YEARLY_PLUS = Object.entries(APPLE_PRODUCTS)
  .filter(([, product]) => product.kind === "plus" && product.period === "yearly")
  .map(([id]) => id);

type YearlyRow = { transaction_id: string; billing_account_id: string; purchased_at: number };

// Plus yearly renews once a year, but its allowance is monthly. For each yearly subscription still active,
// in month k (1 to 11) of its year, reset monthly to 2,000 once, with command id plus-month:<transaction id>:<k>.
// Month 0 was reset when the year was bought (PR 17). Family Sharing members get no credits, so only accounts
// with an open Plus entitlement from a purchase are topped up. Returns how many resets were applied.
export async function topUpYearlyPlus(db: Db, walletFor: (billingAccountId: string) => WalletCommands, now: number): Promise<number> {
  if (YEARLY_PLUS.length === 0) return 0;
  const { results } = await db
    .prepare(
      `SELECT p.transaction_id, p.billing_account_id, p.purchased_at FROM purchases p
       WHERE p.product_id IN (${YEARLY_PLUS.map(() => "?").join(", ")}) AND p.status = 'active'
         AND p.purchased_at = (SELECT MAX(q.purchased_at) FROM purchases q WHERE q.original_id = p.original_id)
         AND EXISTS (SELECT 1 FROM users u JOIN entitlements e ON e.user_id = u.id
                     WHERE u.billing_account_id = p.billing_account_id AND e.product = 'plus'
                       AND e.source = 'purchase' AND e.ended_at IS NULL)`,
    )
    .bind(...YEARLY_PLUS)
    .all<YearlyRow>();
  let applied = 0;
  for (const row of results) {
    let month = 0;
    while (month < 11 && addMonths(row.purchased_at, month + 1) <= now) month++;
    if (month === 0) continue;
    const result = await walletFor(row.billing_account_id).apply({
      type: "reset",
      id: `plus-month:${row.transaction_id}:${month}`,
      credits: PLUS_MONTHLY_CREDITS,
      resets_at: addMonths(row.purchased_at, month + 1),
    });
    if (result.ok) applied++;
  }
  return applied;
}
```

`src/index.ts`, exactly:

```ts
import { topUpYearlyPlus } from "./apple/allowance.ts";
import { createApp } from "./app.ts";
import { cleanup } from "./cleanup.ts";
import type { Env } from "./env.ts";
import { apnsJwtSource } from "./push/apns.ts";
import { handlePushBatch, PUSH_QUEUE_NAME, type PushDeps } from "./push/consumer.ts";
import { handleUsageBatch, USAGE_QUEUE_NAME } from "./usage.ts";

export { GroupRoom } from "./room/object.ts";
export { Wallet } from "./wallet/object.ts";

const app = createApp({
  fetchJwks: (url) => fetch(url).then((r) => r.json()),
  now: Date.now,
  newId: () => crypto.randomUUID(),
});

const pushDeps: PushDeps = { fetch: (input, init) => fetch(input, init), now: Date.now, jwt: apnsJwtSource(Date.now) };

export default {
  fetch: app.fetch,
  async queue(batch, env) {
    if (batch.queue === PUSH_QUEUE_NAME) return handlePushBatch(batch, env, pushDeps);
    if (batch.queue === USAGE_QUEUE_NAME) return handleUsageBatch(batch, env);
    throw new Error("unknown queue");
  },
  async scheduled(controller, env) {
    await cleanup(env, controller.scheduledTime);
    await topUpYearlyPlus(env.DB, (id) => env.WALLET.get(env.WALLET.idFromName(id)), controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
```

`src/env.ts`: add `BUCKET: R2Bucket;` to `Env`. `wrangler.jsonc`: add at the top level:

```jsonc
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "waypoint" }],
  "triggers": { "crons": ["0 * * * *"] }
```

Tests (`test/cleanup.test.ts`), with a `CleanupBucket` stub over an in-memory list of `{ key, uploaded }` that pages 1,000 at a time and records deletes:
- Compile-time check: `export const r2Fits: (bucket: R2Bucket) => CleanupBucket = (bucket) => bucket;`
- `results/` objects 8 days old are deleted, 6 days old kept; `tmp/audio/` 25 hours old deleted, 23 hours kept; objects under `groups/` are never listed or deleted.
- 2,500 old `results/` objects over three pages → all 2,500 deleted, `cursor` passed back each time.
- 25 pages of old objects → only 20 pages are listed in one run.
- `idempotency` rows 25 hours old are deleted, 23 hours old kept; the return value counts each kind.

Tests (`test/allowance.test.ts`), with `createTestDb()`, user `u1`, a `purchases` row and an entitlement inserted by hand, and a wallet stub recording commands:
- A yearly row bought `Date.UTC(2026, 0, 31, 10)`, entitlement `plus` / `purchase` open, now `Date.UTC(2026, 10, 19, 12)` → one `reset` `{ id: "plus-month:<transaction id>:9", credits: 2000, resets_at: addMonths(start, 10) }`.
- Bought 10 days ago → no command (month 0 was PR 17's).
- Bought 13 months ago and still `active` → month 11 at most.
- Run twice with the real wallet store → the second run's command has the same id and changes nothing.
- Status `expired` or `refunded` → no command.
- Entitlement source `family_share` only → no command.
- Entitlement ended → no command.
- Two yearly rows for one original id → only the newest is used.
- A monthly Plus row → no command.

Not in this PR: sending usage events from task code (their cards), Analytics Engine queries or dashboards, deleting `apple_notifications` rows, deleting `jobs` rows.

---

## Open questions for the product owner

1. **Sandbox purchases on production.** `APPLE_ENVIRONMENTS` is `"Production,Sandbox"` so App Review works. It also means TestFlight testers get credits on the production server for free. Options: keep it (testers are invited people), or run a separate staging Worker for TestFlight and set production to `"Production"` once the app is approved.
2. **OCSP.** Certificates are checked at the payload's `signedDate`, without Apple's online revocation check, as Apple's library does with online checks off. Adding OCSP needs another network call per purchase and a DER encoder for the request; not planned.
3. **`REFUND_REVERSED`.** Apple reverses a refund after a dispute. These cards record it and do nothing. Should a reversed pack or Own it refund grant the credits again (with id `apple:<notificationUUID>`), and a reversed Plus refund restore Plus?
4. **Expiry resets monthly credits to 0.** On `EXPIRED`, `GRACE_PERIOD_EXPIRED` and `DID_FAIL_TO_RENEW` (no grace period) the paid period is over, so PR 18 resets monthly to 0. Confirm. A Plus refund also resets monthly to 0 even if the refunded transaction was not the current month (Apple ends the subscription on a refund).
5. **Family Sharing ids.** Apple's forums say each family member gets their own `originalTransactionId`; the account matching relies on that. If it is wrong, a family member could be refused with 409.
6. **APNs from production.** Confirmed by a workerd maintainer and community clients, not by Cloudflare's docs. If the first production push fails (for example HTTP 500 with no `apns-id`), the options are: a small HTTP/2 relay outside Cloudflare, or Firebase Cloud Messaging's HTTP v1 API (which accepts HTTP/1.1 and forwards to APNs, but adds Google as an outside service).
7. **APNs provider token refresh.** APNs refuses tokens refreshed more than once per 20 minutes. Many isolates each sign their own token; PR 31 rounds `iat` down to a shared 30-minute step so they all present the same `iat`. If APNs still answers `TooManyProviderTokenUpdates`, the token would need to be kept in one place (a Durable Object).
8. **Push text.** The fixed alert strings in `src/push/messages.ts` are placeholders for copy review.
9. **Push tokens and devices.** `push_tokens.device_id` is the app's own install id and does not reference `devices` because device registration (S1) is waiting for the security review. When S1 lands, decide whether a push token must belong to a registered device. `docs/architecture.md` section 5 should also list the two new tables (`apple_notifications`, `push_tokens`); this pull request does not edit section 5.
10. **Usage events from other cards.** PR 14, 15 and 20 must send a `UsageEvent` (PR 33) to `USAGE_QUEUE` and not write `activity` themselves. Their cards are being written at the same time; check they agree before they are built.

## What the owner sets up

- **App Store Connect:** the six products with the ids above (Plus monthly and yearly in one subscription group); App Store Server Notifications **Version 2** with production URL `https://<api host>/webhooks/apple` and the sandbox URL the same (or a staging host); the app's numeric Apple id into `APPLE_APP_APPLE_ID`; the bundle id into `APPLE_BUNDLE_ID` and `APNS_TOPIC`.
- **App:** set `appAccountToken` to the signed-in user's id on every purchase; send `Transaction.jwsRepresentation` to `POST /v1/purchases/apple` for every purchase and every update from `Transaction.updates`; register the APNs token with `POST /v1/push-tokens` (lowercase hex, and `sandbox` for development builds).
- **Apple developer account:** an APNs auth key (`.p8`); its 10-character key id into `APNS_KEY_ID`, the team id into `APNS_TEAM_ID`; the key itself only with `npx wrangler secret put APNS_PRIVATE_KEY`.
- **Cloudflare:** queues `waypoint-push` and `waypoint-usage`; the Analytics Engine dataset `waypoint_usage` (created on first write); the R2 bucket `waypoint`; the real D1 and KV ids (already placeholders from wave 2).
