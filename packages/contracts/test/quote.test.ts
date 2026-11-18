import { describe, expect, test } from "vitest";
import { QuoteRequestSchema, QuoteResponseSchema } from "../src/quote.ts";

function messagesFor(input: unknown): string[] {
  const result = QuoteRequestSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.message);
}

describe("QuoteRequestSchema", () => {
  test("accepts the spec example", () => {
    expect(QuoteRequestSchema.safeParse({ task: "overview_script", minutes: 4 }).success).toBe(true);
  });

  test("accepts plain tasks and research with a depth", () => {
    expect(QuoteRequestSchema.safeParse({ task: "explain" }).success).toBe(true);
    expect(QuoteRequestSchema.safeParse({ task: "research", depth: "deep" }).success).toBe(true);
  });

  test("accepts fallback_voice on overview_script and video_slides", () => {
    expect(
      QuoteRequestSchema.safeParse({ task: "overview_script", minutes: 4, fallback_voice: true }).success,
    ).toBe(true);
    expect(QuoteRequestSchema.safeParse({ task: "video_slides", fallback_voice: true }).success).toBe(true);
  });

  test("rejects read_link, unknown tasks and extra keys", () => {
    expect(QuoteRequestSchema.safeParse({ task: "read_link" }).success).toBe(false);
    expect(QuoteRequestSchema.safeParse({ task: "nope" }).success).toBe(false);
    expect(QuoteRequestSchema.safeParse({ task: "explain", extra: 1 }).success).toBe(false);
  });

  test("rejects minutes that are not greater than 0", () => {
    expect(QuoteRequestSchema.safeParse({ task: "retranscribe", minutes: 0 }).success).toBe(false);
    expect(QuoteRequestSchema.safeParse({ task: "retranscribe", minutes: -2 }).success).toBe(false);
  });

  test("research requires depth", () => {
    expect(messagesFor({ task: "research" })).toContain("research requires depth");
  });

  test("a task other than research rejects depth", () => {
    expect(messagesFor({ task: "explain", depth: "quick" })).toContain("depth is only allowed for research");
  });

  test("retranscribe requires minutes", () => {
    expect(messagesFor({ task: "retranscribe" })).toContain("retranscribe requires minutes");
  });

  test("fallback_voice true is rejected for tasks other than overview_script and video_slides", () => {
    expect(messagesFor({ task: "explain", fallback_voice: true })).toContain(
      "fallback_voice is only allowed for overview_script and video_slides",
    );
    expect(messagesFor({ task: "retranscribe", minutes: 2, fallback_voice: true })).toContain(
      "fallback_voice is only allowed for overview_script and video_slides",
    );
  });

  test("fallback_voice false is allowed on any task", () => {
    expect(QuoteRequestSchema.safeParse({ task: "explain", fallback_voice: false }).success).toBe(true);
  });

  test("minutes is rejected for tasks other than overview_script and retranscribe", () => {
    expect(messagesFor({ task: "explain", minutes: 3 })).toContain(
      "minutes is only allowed for overview_script and retranscribe",
    );
    expect(messagesFor({ task: "research", depth: "quick", minutes: 3 })).toContain(
      "minutes is only allowed for overview_script and retranscribe",
    );
    expect(messagesFor({ task: "video_slides", minutes: 3 })).toContain(
      "minutes is only allowed for overview_script and retranscribe",
    );
    expect(messagesFor({ task: "diagram", minutes: 3 })).toContain(
      "minutes is only allowed for overview_script and retranscribe",
    );
  });

  test("retranscribe accepts minutes", () => {
    expect(QuoteRequestSchema.safeParse({ task: "retranscribe", minutes: 4 }).success).toBe(true);
  });

  test("minutes accepts 600 and rejects anything above 600", () => {
    expect(QuoteRequestSchema.safeParse({ task: "retranscribe", minutes: 600 }).success).toBe(true);
    expect(QuoteRequestSchema.safeParse({ task: "retranscribe", minutes: 600.5 }).success).toBe(false);
    expect(QuoteRequestSchema.safeParse({ task: "overview_script", minutes: 601 }).success).toBe(false);
  });

  test("fallback_voice false is accepted on retranscribe", () => {
    expect(
      QuoteRequestSchema.safeParse({ task: "retranscribe", minutes: 2, fallback_voice: false }).success,
    ).toBe(true);
  });
});

describe("QuoteResponseSchema", () => {
  const example = {
    credits: 40,
    price_table: "2026-11-16.2",
    retention: "standard",
    balance_after: 1960,
    expires_in: 300,
  };

  test("accepts the spec example", () => {
    expect(QuoteResponseSchema.safeParse(example).success).toBe(true);
  });

  test("accepts credits 1 and balance_after 0", () => {
    expect(QuoteResponseSchema.safeParse({ ...example, credits: 1, balance_after: 0 }).success).toBe(true);
  });

  test("rejects fractional credits and expires_in 0", () => {
    expect(QuoteResponseSchema.safeParse({ ...example, credits: 1.5 }).success).toBe(false);
    expect(QuoteResponseSchema.safeParse({ ...example, expires_in: 0 }).success).toBe(false);
  });

  test("rejects zero credits, a negative balance and an unknown retention", () => {
    expect(QuoteResponseSchema.safeParse({ ...example, credits: 0 }).success).toBe(false);
    expect(QuoteResponseSchema.safeParse({ ...example, balance_after: -1 }).success).toBe(false);
    expect(QuoteResponseSchema.safeParse({ ...example, retention: "forever" }).success).toBe(false);
  });
});
