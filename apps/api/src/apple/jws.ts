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
