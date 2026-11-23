import { describe, expect, it } from "vitest";
import { isAtEnd } from "../src/core/capture/follow.ts";

describe("isAtEnd", () => {
  it("is true at the very end of the list", () => {
    expect(isAtEnd({ contentHeight: 1000, offsetY: 600, viewHeight: 400 })).toBe(true);
  });

  it("is true within the margin, 39 from the end", () => {
    expect(isAtEnd({ contentHeight: 1000, offsetY: 561, viewHeight: 400 })).toBe(true);
  });

  it("is false 40 from the end", () => {
    expect(isAtEnd({ contentHeight: 1000, offsetY: 560, viewHeight: 400 })).toBe(false);
  });

  it("is true when the content is shorter than the view", () => {
    expect(isAtEnd({ contentHeight: 200, offsetY: 0, viewHeight: 400 })).toBe(true);
  });
});
