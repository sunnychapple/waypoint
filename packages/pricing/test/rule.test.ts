import { describe, expect, test } from "vitest";
import { creditsForCost } from "../src/rule.ts";

describe("creditsForCost", () => {
  test("rounds up with a minimum of 1", () => {
    expect(creditsForCost(0)).toBe(1);
    expect(creditsForCost(0.0005)).toBe(1);
    expect(creditsForCost(0.00051)).toBe(2);
    expect(creditsForCost(0.001)).toBe(2);
    expect(creditsForCost(0.0612)).toBe(123);
  });

  test("throws RangeError for negative input", () => {
    expect(() => creditsForCost(-0.01)).toThrow(RangeError);
  });

  test("throws RangeError for NaN", () => {
    expect(() => creditsForCost(Number.NaN)).toThrow(RangeError);
  });

  test("throws RangeError for infinite input", () => {
    expect(() => creditsForCost(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
