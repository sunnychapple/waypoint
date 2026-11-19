import { beforeAll, describe, expect, test } from "vitest";
import { verifySessionToken, type VerifyOptions } from "../src/auth/token.ts";
import { ApiFailure } from "../src/errors.ts";

const ISSUER = "https://clerk.example.com";
const AZP = "https://app.example.com";
const NOW = 1_800_000_000_000;
const NOW_SECONDS = NOW / 1000;
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let publicJwk: JsonWebKey;

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJson(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signToken(header: object, payload: object, key: CryptoKey = privateKey): Promise<string> {
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

function goodHeader(): object {
  return { alg: "RS256", kid: "k1", typ: "JWT" };
}

function goodPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    sub: "user_123",
    sid: "sess_456",
    azp: AZP,
    nbf: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 60,
    ...overrides,
  };
}

function options(overrides: Partial<VerifyOptions> = {}): VerifyOptions {
  return {
    issuer: ISSUER,
    authorizedParties: [AZP],
    now: NOW,
    getKey: async (kid) => (kid === "k1" ? publicJwk : undefined),
    ...overrides,
  };
}

async function expectSignInRequired(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(ApiFailure);
  await expect(promise).rejects.toMatchObject({ code: "unauthorized", message: "sign in required" });
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  const other = await crypto.subtle.generateKey(
    { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in pair) || !("privateKey" in other)) throw new Error("expected key pairs");
  privateKey = pair.privateKey;
  otherPrivateKey = other.privateKey;
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  if (!("kty" in exported)) throw new Error("expected a JWK");
  publicJwk = exported;
});

describe("verifySessionToken", () => {
  test("accepts a good token and returns sub and sid", async () => {
    const token = await signToken(goodHeader(), goodPayload());
    await expect(verifySessionToken(token, options())).resolves.toEqual({ sub: "user_123", sid: "sess_456" });
  });

  test("returns sid as null when the token has no sid", async () => {
    const token = await signToken(goodHeader(), goodPayload({ sid: undefined }));
    await expect(verifySessionToken(token, options())).resolves.toEqual({ sub: "user_123", sid: null });
  });

  test("rejects a token without three parts", async () => {
    await expectSignInRequired(verifySessionToken("abc.def", options()));
  });

  test("rejects a part that is not base64url", async () => {
    const token = await signToken(goodHeader(), goodPayload());
    const [header, payload, signature] = token.split(".");
    await expectSignInRequired(verifySessionToken(`${header}!.${payload}.${signature}`, options()));
  });

  test("rejects a header that is not a JSON object", async () => {
    const token = await signToken(goodHeader(), goodPayload());
    const [, payload, signature] = token.split(".");
    await expectSignInRequired(verifySessionToken(`${encodeJson(["RS256"])}.${payload}.${signature}`, options()));
  });

  test("rejects a payload that is not a JSON object", async () => {
    const token = await signToken(goodHeader(), goodPayload());
    const [header, , signature] = token.split(".");
    await expectSignInRequired(verifySessionToken(`${header}.${encodeJson("user_123")}.${signature}`, options()));
  });

  test("rejects alg none", async () => {
    const token = await signToken({ alg: "none", kid: "k1" }, goodPayload());
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("rejects alg HS256", async () => {
    const token = await signToken({ alg: "HS256", kid: "k1" }, goodPayload());
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("rejects a header without kid", async () => {
    const token = await signToken({ alg: "RS256" }, goodPayload());
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("rejects an empty kid", async () => {
    const token = await signToken({ alg: "RS256", kid: "" }, goodPayload());
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("rejects a kid that getKey does not know", async () => {
    const token = await signToken({ alg: "RS256", kid: "k2" }, goodPayload());
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("rejects a signature made with another key", async () => {
    const token = await signToken(goodHeader(), goodPayload(), otherPrivateKey);
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("rejects a token whose payload was changed after signing", async () => {
    const token = await signToken(goodHeader(), goodPayload());
    const [header, , signature] = token.split(".");
    const forged = `${header}.${encodeJson(goodPayload({ sub: "user_999" }))}.${signature}`;
    await expectSignInRequired(verifySessionToken(forged, options()));
  });

  test("rejects a wrong iss", async () => {
    const token = await signToken(goodHeader(), goodPayload({ iss: "https://evil.example.com" }));
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("rejects an expired token", async () => {
    const token = await signToken(goodHeader(), goodPayload({ exp: NOW_SECONDS - 6 }));
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("accepts a token that expired 4 seconds ago", async () => {
    const token = await signToken(goodHeader(), goodPayload({ exp: NOW_SECONDS - 4 }));
    await expect(verifySessionToken(token, options())).resolves.toEqual({ sub: "user_123", sid: "sess_456" });
  });

  test("rejects a token that is not yet valid", async () => {
    const token = await signToken(goodHeader(), goodPayload({ nbf: NOW_SECONDS + 6 }));
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("accepts a token that becomes valid 4 seconds from now", async () => {
    const token = await signToken(goodHeader(), goodPayload({ nbf: NOW_SECONDS + 4 }));
    await expect(verifySessionToken(token, options())).resolves.toEqual({ sub: "user_123", sid: "sess_456" });
  });

  test("rejects an exp that is not a number", async () => {
    const token = await signToken(goodHeader(), goodPayload({ exp: "later" }));
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("rejects a missing sub", async () => {
    const token = await signToken(goodHeader(), goodPayload({ sub: undefined }));
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("rejects an azp that is not authorized", async () => {
    const token = await signToken(goodHeader(), goodPayload({ azp: "https://other.example.com" }));
    await expectSignInRequired(verifySessionToken(token, options()));
  });

  test("accepts a token without azp", async () => {
    const token = await signToken(goodHeader(), goodPayload({ azp: undefined }));
    await expect(verifySessionToken(token, options())).resolves.toEqual({ sub: "user_123", sid: "sess_456" });
  });

  test("accepts any azp when no parties are listed", async () => {
    const token = await signToken(goodHeader(), goodPayload({ azp: "https://anything.example.com" }));
    await expect(verifySessionToken(token, options({ authorizedParties: [] }))).resolves.toEqual({
      sub: "user_123",
      sid: "sess_456",
    });
  });
});
