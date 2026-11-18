import { describe, expect, test } from "vitest";
import {
  PRICE_KEYS,
  PRICE_TABLE_2026_11_16_2,
  PriceTableSchema,
} from "../src/table.ts";

describe("price table", () => {
  test("the shipped table parses", () => {
    expect(PriceTableSchema.safeParse(PRICE_TABLE_2026_11_16_2).success).toBe(true);
    expect(PRICE_TABLE_2026_11_16_2.version).toBe("2026-11-16.2");
    expect(PRICE_TABLE_2026_11_16_2.credits.retranscribe).toBe(1);
    expect(PRICE_TABLE_2026_11_16_2.credits.fallback_voice).toBe(2);
  });

  test("a table missing a key fails", () => {
    const { explain: _omitted, ...credits } = PRICE_TABLE_2026_11_16_2.credits;
    const result = PriceTableSchema.safeParse({
      version: "x",
      credits,
    });
    expect(result.success).toBe(false);
  });

  test("a table with an extra key fails", () => {
    const result = PriceTableSchema.safeParse({
      version: "x",
      credits: { ...PRICE_TABLE_2026_11_16_2.credits, surprise: 1 },
    });
    expect(result.success).toBe(false);
  });

  test("every price key is present in the shipped table", () => {
    for (const key of PRICE_KEYS) {
      expect(PRICE_TABLE_2026_11_16_2.credits[key]).toBeGreaterThanOrEqual(1);
    }
  });
});
