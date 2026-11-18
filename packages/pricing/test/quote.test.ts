import { describe, expect, test } from "vitest";
import { PRICE_TABLE_2026_11_16_2 as table } from "../src/table.ts";
import { priceKeyFor, quoteCredits } from "../src/quote.ts";

describe("priceKeyFor", () => {
  test("maps research with depth to research_<depth>", () => {
    expect(priceKeyFor({ task: "research", depth: "deep" })).toBe("research_deep");
  });

  test("maps retranscribe and plain price keys to themselves", () => {
    expect(priceKeyFor({ task: "retranscribe" })).toBe("retranscribe");
    expect(priceKeyFor({ task: "explain" })).toBe("explain");
  });

  test("throws for research without depth", () => {
    expect(() => priceKeyFor({ task: "research" })).toThrow(
      "research tasks need a depth",
    );
  });

  test("throws for an unknown task", () => {
    expect(() => priceKeyFor({ task: "nope" })).toThrow("unknown task: nope");
  });

  test("throws for fallback_voice, which is not a task", () => {
    expect(() => priceKeyFor({ task: "fallback_voice" })).toThrow(
      "unknown task: fallback_voice",
    );
  });
});

describe("quoteCredits", () => {
  test("explain costs 1 credit", () => {
    expect(quoteCredits(table, { task: "explain" })).toBe(1);
  });

  test("research deep costs 125 credits", () => {
    expect(quoteCredits(table, { task: "research", depth: "deep" })).toBe(125);
  });

  test("retranscribe rounds minutes up", () => {
    expect(quoteCredits(table, { task: "retranscribe", minutes: 4.2 })).toBe(5);
  });

  test("overview with fallback voice adds 2 credits", () => {
    expect(
      quoteCredits(table, { task: "overview_script", fallback_voice: true }),
    ).toBe(42);
  });

  test("retranscribe without minutes throws", () => {
    expect(() => quoteCredits(table, { task: "retranscribe" })).toThrow(
      "retranscribe needs minutes > 0",
    );
  });

  test("retranscribe with zero minutes throws", () => {
    expect(() => quoteCredits(table, { task: "retranscribe", minutes: 0 })).toThrow(
      "retranscribe needs minutes > 0",
    );
  });

  test("an unknown task throws", () => {
    expect(() => quoteCredits(table, { task: "nope" })).toThrow("unknown task: nope");
  });
});
