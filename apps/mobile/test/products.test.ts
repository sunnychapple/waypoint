import { describe, expect, it } from "vitest";
import { PRODUCTS, PRODUCT_IDS, isProductId, purchaseKey, sendOutcome, shouldFinish } from "../src/core/store/products.ts";

describe("products", () => {
  it("six products, each described", () => {
    expect(PRODUCT_IDS).toHaveLength(6);
    for (const id of PRODUCT_IDS) expect(PRODUCTS[id].id).toBe(id);
    expect(PRODUCTS["waypoint.credits.5000"]).toEqual({ id: "waypoint.credits.5000", kind: "pack", credits: 5000, period: null });
    expect(isProductId("waypoint.plus.yearly")).toBe(true);
    expect(isProductId("waypoint.plus")).toBe(false);
  });
  it("purchaseKey fits the Idempotency-Key rule", () => {
    expect(purchaseKey("2000000123456789")).toBe("apple_txn_2000000123456789");
    expect(purchaseKey("42")).toBe("apple_txn_000042");
    expect(purchaseKey("42")).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(() => purchaseKey("12a")).toThrow();
    expect(() => purchaseKey("")).toThrow();
  });
  it("outcomes and finishing", () => {
    expect(sendOutcome(null)).toBe("granted");
    expect(sendOutcome({ status: 409, message: "purchase belongs to another account" })).toBe("other_account");
    expect(sendOutcome({ status: 409, message: "purchase was refunded" })).toBe("refunded");
    expect(sendOutcome({ status: 409, message: "request in progress" })).toBe("retry_later");
    expect(sendOutcome({ status: 400, message: "invalid purchase" })).toBe("invalid");
    expect(sendOutcome({ status: 401, message: "device signature required" })).toBe("retry_later");
    expect(sendOutcome({ status: 500, message: "something went wrong" })).toBe("retry_later");
    for (const outcome of ["granted", "other_account", "refunded"] as const) expect(shouldFinish(outcome)).toBe(true);
    expect(shouldFinish("invalid")).toBe(false);
    expect(shouldFinish("retry_later")).toBe(false);
  });
});
