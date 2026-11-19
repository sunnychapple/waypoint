import { ApiFailure } from "../errors.ts";

export type SessionClaims = { sub: string; sid: string | null };

export type VerifyOptions = {
  issuer: string;
  authorizedParties: readonly string[];
  now: number;
  getKey: (kid: string) => Promise<JsonWebKey | undefined>;
};

const CLOCK_SKEW_SECONDS = 5;

export async function verifySessionToken(token: string, options: VerifyOptions): Promise<SessionClaims> {
  const reject = (): never => {
    throw new ApiFailure("unauthorized", "sign in required");
  };
  const decode = (part: string): Uint8Array => {
    if (!/^[A-Za-z0-9_-]+$/.test(part)) return reject();
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
  };
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const decodeObject = (part: string): Record<string, unknown> => {
    const value: unknown = JSON.parse(new TextDecoder().decode(decode(part)));
    return isRecord(value) ? value : reject();
  };

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return reject();
    const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;

    const header = decodeObject(headerPart);
    const payload = decodeObject(payloadPart);
    const signature = decode(signaturePart);

    const kid = header.kid;
    if (header.alg !== "RS256" || typeof kid !== "string" || kid === "") return reject();
    const jwk = await options.getKey(kid);
    if (jwk === undefined) return reject();

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
    if (!(await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signed))) return reject();

    if (payload.iss !== options.issuer) return reject();
    const { exp, nbf } = payload;
    if (typeof exp !== "number" || typeof nbf !== "number") return reject();
    const nowSeconds = options.now / 1000;
    if (!(nbf - CLOCK_SKEW_SECONDS <= nowSeconds && nowSeconds < exp + CLOCK_SKEW_SECONDS)) return reject();

    const sub = payload.sub;
    if (typeof sub !== "string" || sub === "") return reject();

    const azp = payload.azp;
    if (azp !== undefined && options.authorizedParties.length > 0) {
      if (typeof azp !== "string" || !options.authorizedParties.includes(azp)) return reject();
    }

    const sid = payload.sid;
    return { sub, sid: typeof sid === "string" ? sid : null };
  } catch {
    return reject();
  }
}
