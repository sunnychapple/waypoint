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

  test("every price in the shipped table equals architecture section 7", () => {
    expect(PRICE_TABLE_2026_11_16_2.credits).toEqual({
      explain: 1,
      double_check: 4,
      more_detail: 3,
      research_quick: 15,
      research_standard: 45,
      research_deep: 125,
      overview_script: 40,
      video_slides: 50,
      diagram: 18,
      mini_app: 40,
      practice: 8,
      retranscribe: 1,
      fallback_voice: 2,
    });
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

  test("a table with a credit of 0, 1.5 or an empty version fails", () => {
    expect(
      PriceTableSchema.safeParse({
        version: "x",
        credits: { ...PRICE_TABLE_2026_11_16_2.credits, explain: 0 },
      }).success,
    ).toBe(false);
    expect(
      PriceTableSchema.safeParse({
        version: "x",
        credits: { ...PRICE_TABLE_2026_11_16_2.credits, diagram: 1.5 },
      }).success,
    ).toBe(false);
    expect(
      PriceTableSchema.safeParse({
        version: "",
        credits: PRICE_TABLE_2026_11_16_2.credits,
      }).success,
    ).toBe(false);
  });

  test("every price key is present in the shipped table", () => {
    for (const key of PRICE_KEYS) {
      expect(PRICE_TABLE_2026_11_16_2.credits[key]).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("optional price keys", () => {
  test("a table with problem_help parses; one with problem_help 0 fails", () => {
    expect(PriceTableSchema.safeParse({ ...PRICE_TABLE_2026_11_16_2, credits: { ...PRICE_TABLE_2026_11_16_2.credits, problem_help: 5 } }).success).toBe(true);
    expect(PriceTableSchema.safeParse({ ...PRICE_TABLE_2026_11_16_2, credits: { ...PRICE_TABLE_2026_11_16_2.credits, problem_help: 0 } }).success).toBe(false);
  });

  test("the shipped table has no problem_help, so the live KV table stays valid", () => {
    expect(Object.hasOwn(PRICE_TABLE_2026_11_16_2.credits, "problem_help")).toBe(false);
  });
});
