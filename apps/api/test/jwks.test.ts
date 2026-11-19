import { describe, expect, test, vi } from "vitest";
import { jwksKeySource } from "../src/auth/jwks.ts";

const ISSUER = "https://clerk.example.com";
const URL_ = "https://clerk.example.com/.well-known/jwks.json";
const MINUTE = 60 * 1000;
const KEY = { kty: "RSA", kid: "k1", n: "AQAB", e: "AQAB" };

function clock(start: number): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms) => void (at += ms) };
}

describe("jwksKeySource", () => {
  test("builds the JWKS URL from an issuer without a trailing slash", async () => {
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({ keys: [KEY] }));
    await jwksKeySource(ISSUER, fetchJwks, () => 0)("k1");
    expect(fetchJwks).toHaveBeenCalledWith(URL_);
  });

  test("builds the JWKS URL from an issuer with a trailing slash, without a double slash", async () => {
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({ keys: [KEY] }));
    await jwksKeySource(`${ISSUER}/`, fetchJwks, () => 0)("k1");
    expect(fetchJwks).toHaveBeenCalledWith(URL_);
  });

  test("returns the key for a known kid", async () => {
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({ keys: [KEY] }));
    await expect(jwksKeySource(ISSUER, fetchJwks, () => 0)("k1")).resolves.toEqual(KEY);
  });

  test("fetches once and reuses the keys within 10 minutes", async () => {
    const time = clock(1_000_000);
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({ keys: [KEY] }));
    const getKey = jwksKeySource(ISSUER, fetchJwks, time.now);
    await getKey("k1");
    time.advance(5 * MINUTE);
    await expect(getKey("k1")).resolves.toEqual(KEY);
    expect(fetchJwks).toHaveBeenCalledTimes(1);
  });

  test("fetches again after 10 minutes", async () => {
    const time = clock(1_000_000);
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({ keys: [KEY] }));
    const getKey = jwksKeySource(ISSUER, fetchJwks, time.now);
    await getKey("k1");
    time.advance(10 * MINUTE);
    await getKey("k1");
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  test("fetches for an unknown kid only after 60 seconds", async () => {
    const time = clock(1_000_000);
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({ keys: [KEY] }));
    const getKey = jwksKeySource(ISSUER, fetchJwks, time.now);
    await getKey("k1");
    time.advance(59 * 1000);
    await expect(getKey("unknown")).resolves.toBeUndefined();
    expect(fetchJwks).toHaveBeenCalledTimes(1);
    time.advance(1000);
    await expect(getKey("unknown")).resolves.toBeUndefined();
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  test("picks up a new kid once the 60 second wait is over", async () => {
    const time = clock(1_000_000);
    let keys: unknown[] = [KEY];
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({ keys }));
    const getKey = jwksKeySource(ISSUER, fetchJwks, time.now);
    await getKey("k1");
    keys = [KEY, { ...KEY, kid: "k2" }];
    time.advance(MINUTE);
    await expect(getKey("k2")).resolves.toEqual({ ...KEY, kid: "k2" });
  });

  test("keeps the old keys when a refetch throws", async () => {
    const time = clock(1_000_000);
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => {
      if (fetchJwks.mock.calls.length > 1) throw new Error("network down");
      return { keys: [KEY] };
    });
    const getKey = jwksKeySource(ISSUER, fetchJwks, time.now);
    await getKey("k1");
    time.advance(10 * MINUTE);
    await expect(getKey("k1")).resolves.toEqual(KEY);
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  test("gives no keys for a bad response", async () => {
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({ nope: true }));
    await expect(jwksKeySource(ISSUER, fetchJwks, () => 0)("k1")).resolves.toBeUndefined();
  });

  test("gives no keys when the response is not an object", async () => {
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => "not json");
    await expect(jwksKeySource(ISSUER, fetchJwks, () => 0)("k1")).resolves.toBeUndefined();
  });

  test("keeps only RSA keys with a string kid", async () => {
    const fetchJwks = vi.fn(async (_url: string): Promise<unknown> => ({
      keys: [
        { kty: "EC", kid: "ec" },
        { kty: "RSA" },
        { kty: "RSA", kid: 7 },
        "not a key",
        KEY,
      ],
    }));
    const getKey = jwksKeySource(ISSUER, fetchJwks, () => 0);
    await expect(getKey("k1")).resolves.toEqual(KEY);
    await expect(getKey("ec")).resolves.toBeUndefined();
  });
});
