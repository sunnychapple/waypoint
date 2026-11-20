import { describe, expect, it } from "vitest";
import { extraOutcome, isSyncLimit, limitUntil, sendingPaused, syncLimitCopy } from "../src/core/sync/limit.ts";

const DAY = 86_400_000;
const NOW = 20_400 * DAY + 18 * 3_600_000;

describe("the daily sync limit", () => {
  it("is a 429 with the server's message, nothing else", () => {
    expect(isSyncLimit(429, "daily sync limit reached")).toBe(true);
    expect(isSyncLimit(429, "too many requests")).toBe(false);
    expect(isSyncLimit(409, "daily sync limit reached")).toBe(false);
  });

  it("waits retry_after seconds, or an hour without one", () => {
    expect(limitUntil(NOW, 21_600)).toBe(NOW + 21_600_000);
    expect(limitUntil(NOW, null)).toBe(NOW + 3_600_000);
  });

  it("pauses sending only while the stored time is ahead", () => {
    expect(sendingPaused(String(NOW + 1), NOW)).toBe(true);
    expect(sendingPaused(String(NOW), NOW)).toBe(false);
    expect(sendingPaused(null, NOW)).toBe(false);
  });

  it("says what was synced today and what more costs", () => {
    expect(syncLimitCopy("7:00 PM")).toEqual({
      title: "You've synced 200 MB today",
      body: "Add 1 GB more for today for 100 credits, or wait until 7:00 PM, when sync starts again. Your notes stay on this iPhone meanwhile.",
      buy: "Add 1 GB · 100 credits",
      priceChanged: "The price of more sync has changed, and nothing was charged. Update Waypoint to see the new price.",
    });
  });
});

describe("buying more sync for today", () => {
  it("counts a request that already finished as bought, so it is never paid again", () => {
    expect(extraOutcome(409, "request already finished")).toBe("bought");
  });

  it("drops the key when the server says it can never buy", () => {
    expect(extraOutcome(409, "price changed")).toBe("price_changed");
    expect(extraOutcome(500, "purchase not completed, nothing was charged: try again with a new Idempotency-Key")).toBe("new_key");
  });

  it("keeps the key for out of credits, a request still in progress, and any other server error", () => {
    expect(extraOutcome(402, "not enough credits")).toBe("same_key");
    expect(extraOutcome(409, "request in progress")).toBe("same_key");
    expect(extraOutcome(500, "something went wrong")).toBe("same_key");
  });
});
