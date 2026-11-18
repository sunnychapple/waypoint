import { describe, expect, test } from "vitest";
import { PRICE_TABLE_2026_11_16_2 as table } from "../src/table.ts";
import { priceKeyFor, quoteCredits, type QuoteInput } from "../src/quote.ts";

// A quote request body is untyped at runtime, so tests feed bad values through it.
function fromBody(text: string): QuoteInput {
  return JSON.parse(text);
}

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

  test("throws for research with a depth that is not a price key", () => {
    expect(() => priceKeyFor(fromBody('{"task":"research","depth":"huge"}'))).toThrow(
      "unknown task: research",
    );
  });

  test("throws for inherited names such as toString", () => {
    expect(() => priceKeyFor({ task: "toString" })).toThrow("unknown task: toString");
    expect(() => priceKeyFor({ task: "constructor" })).toThrow(
      "unknown task: constructor",
    );
    expect(() => priceKeyFor(fromBody('{"task":"research","depth":"toString"}'))).toThrow(
      "unknown task: research",
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

  test("retranscribe rounds a tiny positive duration up to 1 minute", () => {
    expect(quoteCredits(table, { task: "retranscribe", minutes: 0.0001 })).toBe(1);
  });

  test("overview with fallback voice adds 2 credits", () => {
    expect(
      quoteCredits(table, { task: "overview_script", fallback_voice: true }),
    ).toBe(42);
  });

  test("video slides with fallback voice adds 2 credits", () => {
    expect(
      quoteCredits(table, { task: "video_slides", fallback_voice: true }),
    ).toBe(52);
  });

  test("quotes every task at its section 7 price", () => {
    const cases: [QuoteInput, number][] = [
      [{ task: "explain" }, 1],
      [{ task: "double_check" }, 4],
      [{ task: "more_detail" }, 3],
      [{ task: "research", depth: "quick" }, 15],
      [{ task: "research", depth: "standard" }, 45],
      [{ task: "research", depth: "deep" }, 125],
      [{ task: "overview_script" }, 40],
      [{ task: "video_slides" }, 50],
      [{ task: "diagram" }, 18],
      [{ task: "mini_app" }, 40],
      [{ task: "practice" }, 8],
      [{ task: "retranscribe", minutes: 3 }, 3],
    ];
    for (const [input, expected] of cases) {
      expect(quoteCredits(table, input)).toBe(expected);
    }
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

  test("retranscribe with negative minutes throws RangeError", () => {
    expect(() => quoteCredits(table, { task: "retranscribe", minutes: -1 })).toThrow(
      RangeError,
    );
  });

  test("retranscribe with NaN, Infinity or -Infinity minutes throws RangeError", () => {
    for (const minutes of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => quoteCredits(table, { task: "retranscribe", minutes })).toThrow(
        RangeError,
      );
    }
  });

  test("retranscribe accepts 600 minutes and rejects more", () => {
    expect(quoteCredits(table, { task: "retranscribe", minutes: 600 })).toBe(600);
    expect(() => quoteCredits(table, { task: "retranscribe", minutes: 600.5 })).toThrow(
      RangeError,
    );
    expect(() => quoteCredits(table, { task: "retranscribe", minutes: 601 })).toThrow(
      RangeError,
    );
  });

  test("fallback voice on a task other than an overview throws", () => {
    expect(() => quoteCredits(table, { task: "explain", fallback_voice: true })).toThrow(
      "fallback_voice is only for overviews",
    );
    expect(() =>
      quoteCredits(table, { task: "research", depth: "deep", fallback_voice: true }),
    ).toThrow("fallback_voice is only for overviews");
    expect(() =>
      quoteCredits(table, { task: "retranscribe", minutes: 2, fallback_voice: true }),
    ).toThrow("fallback_voice is only for overviews");
  });

  test("an unknown task throws", () => {
    expect(() => quoteCredits(table, { task: "nope" })).toThrow("unknown task: nope");
  });
});
