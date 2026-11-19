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
