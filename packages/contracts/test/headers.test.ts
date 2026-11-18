import { describe, expect, test } from "vitest";
import { IDEMPOTENCY_KEY_HEADER, isValidIdempotencyKey } from "../src/headers.ts";

describe("isValidIdempotencyKey", () => {
  test("uses the Idempotency-Key header name", () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe("Idempotency-Key");
  });

  test("accepts lengths 16 and 128", () => {
    expect(isValidIdempotencyKey("a".repeat(16))).toBe(true);
    expect(isValidIdempotencyKey("a".repeat(128))).toBe(true);
  });

  test("rejects lengths 15 and 129", () => {
    expect(isValidIdempotencyKey("a".repeat(15))).toBe(false);
    expect(isValidIdempotencyKey("a".repeat(129))).toBe(false);
  });

  test("accepts letters, digits, underscore and hyphen", () => {
    expect(isValidIdempotencyKey("Abc_123-xyzXYZ00")).toBe(true);
  });

  test("rejects a bad character", () => {
    expect(isValidIdempotencyKey("abcdefghijklmnop!")).toBe(false);
    expect(isValidIdempotencyKey("abcdefghijklmnop.")).toBe(false);
  });

  test("rejects missing values", () => {
    expect(isValidIdempotencyKey(null)).toBe(false);
    expect(isValidIdempotencyKey(undefined)).toBe(false);
  });
});
