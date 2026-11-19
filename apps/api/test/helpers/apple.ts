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
  basicConstraints?: Uint8Array; // the extension's value; default is cA TRUE for a CA and no extension otherwise
  markers: readonly string[];
};

// One DER certificate. The signature hash follows the signer's curve: SHA-256 on P-256, SHA-384 on P-384.
export async function makeCert(o: CertOptions): Promise<Uint8Array> {
  const algorithm = o.signerCurve === "P-256" ? ECDSA_SHA256 : ECDSA_SHA384;
  const basicConstraints = o.basicConstraints ?? (o.ca ? seq(tlv(0x01, Uint8Array.of(0xff))) : undefined);
  const extensions = [
    ...(basicConstraints !== undefined ? [extension("2.5.29.19", basicConstraints, true)] : []),
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
