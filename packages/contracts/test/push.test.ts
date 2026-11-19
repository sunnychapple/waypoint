import { describe, expect, test } from "vitest";
import { PushTokenRequestSchema, PushTokenResponseSchema } from "../src/push.ts";

const GOOD = {
  device_id: "device_1234",
  token: "a".repeat(64),
  environment: "production",
};

describe("PushTokenRequestSchema", () => {
  test("a good request parses", () => {
    expect(PushTokenRequestSchema.safeParse(GOOD).success).toBe(true);
  });

  test("a token in capitals fails", () => {
    expect(PushTokenRequestSchema.safeParse({ ...GOOD, token: "A".repeat(64) }).success).toBe(false);
  });

  test("a token of 63 characters fails", () => {
    expect(PushTokenRequestSchema.safeParse({ ...GOOD, token: "a".repeat(63) }).success).toBe(false);
  });

  test("a token of 201 characters fails", () => {
    expect(PushTokenRequestSchema.safeParse({ ...GOOD, token: "a".repeat(201) }).success).toBe(false);
  });

  test("a device_id of 7 characters fails", () => {
    expect(PushTokenRequestSchema.safeParse({ ...GOOD, device_id: "abcdefg" }).success).toBe(false);
  });

  test("environment dev fails", () => {
    expect(PushTokenRequestSchema.safeParse({ ...GOOD, environment: "dev" }).success).toBe(false);
  });

  test("an extra key fails", () => {
    expect(PushTokenRequestSchema.safeParse({ ...GOOD, extra: 1 }).success).toBe(false);
  });
});

describe("PushTokenResponseSchema", () => {
  test("a reply with a device_id parses", () => {
    expect(PushTokenResponseSchema.safeParse({ device_id: "device_1234" }).success).toBe(true);
  });
});
