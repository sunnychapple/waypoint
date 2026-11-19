import { describe, expect, test } from "vitest";
import { ApplePurchaseRequestSchema, ApplePurchaseResponseSchema } from "../src/purchases.ts";

const GOOD_RESPONSE = {
  transaction_id: "2000000000000001",
  product: "pack",
  credits: 1000,
  plan: "free",
};

describe("ApplePurchaseRequestSchema", () => {
  test("a 10-character signed_transaction parses", () => {
    expect(ApplePurchaseRequestSchema.safeParse({ signed_transaction: "a".repeat(10) }).success).toBe(true);
  });

  test("an empty, too long (16,385 characters) or extra-key request fails", () => {
    expect(ApplePurchaseRequestSchema.safeParse({ signed_transaction: "" }).success).toBe(false);
    expect(ApplePurchaseRequestSchema.safeParse({ signed_transaction: "a".repeat(16385) }).success).toBe(false);
    expect(ApplePurchaseRequestSchema.safeParse({ signed_transaction: "a", extra: 1 }).success).toBe(false);
  });
});

describe("ApplePurchaseResponseSchema", () => {
  test("a good reply parses", () => {
    expect(ApplePurchaseResponseSchema.safeParse(GOOD_RESPONSE).success).toBe(true);
  });

  test("credits -1, plan gold and product tip each fail", () => {
    expect(ApplePurchaseResponseSchema.safeParse({ ...GOOD_RESPONSE, credits: -1 }).success).toBe(false);
    expect(ApplePurchaseResponseSchema.safeParse({ ...GOOD_RESPONSE, plan: "gold" }).success).toBe(false);
    expect(ApplePurchaseResponseSchema.safeParse({ ...GOOD_RESPONSE, product: "tip" }).success).toBe(false);
  });
});
