import { describe, expect, it } from "vitest";
import { formatClock, formatOffset } from "../src/core/format.ts";

describe("formatClock", () => {
  it("formats milliseconds as HH:MM:SS, clamps negatives to zero and does not cap hours", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(2_537_000)).toBe("00:42:17");
    expect(formatClock(-5)).toBe("00:00:00");
    expect(formatClock(999)).toBe("00:00:00");
    expect(formatClock(360_000_000)).toBe("100:00:00");
  });
});

describe("formatOffset", () => {
  it("formats transcript offsets as M:SS under an hour and H:MM:SS from an hour on", () => {
    expect(formatOffset(0)).toBe("0:00");
    expect(formatOffset(2_537_000)).toBe("42:17");
    expect(formatOffset(3_725_000)).toBe("1:02:05");
  });
});
