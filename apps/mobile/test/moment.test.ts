import { describe, expect, it } from "vitest";
import { momentFromParam, nearestSegmentIndex } from "../src/core/capture/moment.ts";

describe("nearestSegmentIndex", () => {
  it("picks the latest line that starts at or before the moment", () => {
    expect(nearestSegmentIndex([0, 5000, 12000], 6000)).toBe(1);
    expect(nearestSegmentIndex([0, 5000, 12000], 12000)).toBe(2);
    expect(nearestSegmentIndex([0, 5000, 12000], 999_999)).toBe(2);
  });

  it("falls back to the first line after the moment when none starts before it", () => {
    expect(nearestSegmentIndex([5000, 9000], 1000)).toBe(0);
    expect(nearestSegmentIndex([5000, 9000], 4999)).toBe(0);
  });

  it("returns -1 when there are no lines", () => {
    expect(nearestSegmentIndex([], 100)).toBe(-1);
  });

  it("does not depend on the order of the starts", () => {
    expect(nearestSegmentIndex([12000, 0, 5000], 6000)).toBe(2);
    expect(nearestSegmentIndex([9000, 5000], 1000)).toBe(1);
  });
});

describe("momentFromParam", () => {
  it("reads milliseconds and rejects anything else", () => {
    expect(momentFromParam("42000")).toBe(42000);
    expect(momentFromParam("0")).toBe(0);
    expect(momentFromParam(undefined)).toBeNull();
    expect(momentFromParam("")).toBeNull();
    expect(momentFromParam("   ")).toBeNull();
    expect(momentFromParam("abc")).toBeNull();
    expect(momentFromParam("-5")).toBeNull();
  });
});
