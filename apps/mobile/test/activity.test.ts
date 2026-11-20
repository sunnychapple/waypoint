import { describe, expect, it } from "vitest";
import { activityLine, sentKeyOf, sizeLabel, zeroRetentionShown } from "../src/core/cloud/activity.ts";

describe("activity", () => {
  it("sentKeyOf takes the Idempotency-Key from the hold id", () => {
    expect(sentKeyOf("explain:0b7c3c1e-1111-4111-8111-111111111111:9f1d2c3b-2222-4222-8222-222222222222")).toBe("9f1d2c3b-2222-4222-8222-222222222222");
    expect(sentKeyOf("explain:u1:short")).toBeNull();
    expect(sentKeyOf("no-colon-at-all-1234567890")).toBeNull();
  });
  it("sizeLabel", () => {
    expect(sizeLabel(0)).toBe("<1 KB");
    expect(sizeLabel(999)).toBe("<1 KB");
    expect(sizeLabel(1_499)).toBe("1 KB");
    expect(sizeLabel(1_250_000)).toBe("1.3 MB");
  });
  it("activityLine", () => {
    const item = { id: "a", task: "more_detail" as const, bytes_sent: 2_400, credits: 3, route: "standard", retention: "zero" as const, at: Date.UTC(2026, 10, 19, 15) };
    expect(activityLine(item, 0)).toEqual({ title: "More detail", detail: "Nov 19 · 3 credits · 2 KB sent", retention: "zero" });
    expect(activityLine({ ...item, credits: 0 }, 0).detail).toContain("Not charged");
  });
  it("zeroRetentionShown only for Plus with the switch on", () => {
    expect(zeroRetentionShown("1", "plus")).toBe(true);
    expect(zeroRetentionShown("1", "own")).toBe(false);
    expect(zeroRetentionShown("0", "plus")).toBe(false);
    expect(zeroRetentionShown(null, null)).toBe(false);
  });
});
