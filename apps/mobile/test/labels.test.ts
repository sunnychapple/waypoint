import { describe, expect, it } from "vitest";
import { dateLine, greeting, sessionsLabel, usedLabel } from "../src/core/capture/labels.ts";

const UTC_PLUS_10 = 600;
const at = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) - UTC_PLUS_10 * 60_000;

describe("labels", () => {
  it("usedLabel says today, yesterday or nothing by calendar day in the given offset, across midnight", () => {
    const now = at(2026, 11, 19, 0, 30);
    expect(usedLabel(at(2026, 11, 19, 0, 10), now, UTC_PLUS_10)).toBe("Used today");
    expect(usedLabel(at(2026, 11, 18, 23, 50), now, UTC_PLUS_10)).toBe("Used yesterday");
    expect(usedLabel(at(2026, 11, 17, 23, 50), now, UTC_PLUS_10)).toBeNull();
    expect(usedLabel(at(2026, 11, 18, 23, 50), now, 0)).toBe("Used today");
  });

  it("sessionsLabel is singular for one and plural otherwise", () => {
    expect(sessionsLabel(1)).toBe("1 session");
    expect(sessionsLabel(3)).toBe("3 sessions");
  });

  it("greeting changes at 5, 12 and 18 o'clock", () => {
    expect([4, 5, 11, 12, 17, 18].map(greeting)).toEqual([
      "Good evening",
      "Good morning",
      "Good morning",
      "Good afternoon",
      "Good afternoon",
      "Good evening",
    ]);
  });

  it("dateLine gives the weekday and month-day in caps for 2026-11-19", () => {
    expect(dateLine(Date.UTC(2026, 10, 19, 12, 0), 0)).toBe("THURSDAY, NOV 19");
  });

  it("dateLine uses the offset: 23:30 UTC on Nov 18 is already Nov 19 in UTC+10", () => {
    expect(dateLine(Date.UTC(2026, 10, 18, 23, 30), UTC_PLUS_10)).toBe("THURSDAY, NOV 19");
  });

  it("usedLabel gives nothing for a time in the future", () => {
    const now = at(2026, 11, 19, 12, 0);
    expect(usedLabel(at(2026, 11, 20, 12, 0), now, UTC_PLUS_10)).toBeNull();
  });
});
