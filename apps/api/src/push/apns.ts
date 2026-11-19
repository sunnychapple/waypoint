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
