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
