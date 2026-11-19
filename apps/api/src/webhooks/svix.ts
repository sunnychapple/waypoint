// Clerk sends webhooks through Svix (the Standard Webhooks scheme). The signed content is
// "<svix-id>.<svix-timestamp>.<raw body>", signed with HMAC-SHA256 using the base64 part of the
// "whsec_..." secret. svix-signature is a space-separated list of "v1,<base64 signature>".
export const SVIX_TOLERANCE_SECONDS = 300;

export type SvixHeaders = { id: string | undefined; timestamp: string | undefined; signature: string | undefined };

export class WebhookSecretError extends Error {
  constructor() {
    super("webhook signing secret is not a whsec_ secret");
    this.name = "WebhookSecretError";
  }
}

function base64Bytes(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

// True only when one v1 signature matches and the timestamp is within 5 minutes of now (Unix ms).
// crypto.subtle.verify compares in constant time. Throws WebhookSecretError for a malformed secret.
export async function verifySvix(secret: string, headers: SvixHeaders, body: string, now: number): Promise<boolean> {
  const keyBytes = typeof secret === "string" && secret.startsWith("whsec_") ? base64Bytes(secret.slice("whsec_".length)) : null;
  if (keyBytes === null || keyBytes.byteLength === 0) throw new WebhookSecretError();

  const { id, timestamp, signature } = headers;
  if (id === undefined || timestamp === undefined || signature === undefined) return false;
  if (id === "" || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > SVIX_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  for (const part of signature.split(" ")) {
    if (!part.startsWith("v1,")) continue;
    const bytes = base64Bytes(part.slice(3));
    if (bytes === null) continue;
    if (await crypto.subtle.verify("HMAC", key, bytes, signed)) return true;
  }
  return false;
}
