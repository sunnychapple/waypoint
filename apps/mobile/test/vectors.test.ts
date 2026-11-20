import { describe, expect, it } from "vitest";
import { fuse, quantize, similarity } from "../src/core/search/vectors.ts";

describe("vectors", () => {
  it("two vectors pointing the same way have similarity about 1", () => {
    expect(similarity(quantize([1, 2, 3]), quantize([2, 4, 6]))).toBeCloseTo(1, 2);
  });

  it("opposite vectors have similarity about -1", () => {
    expect(similarity(quantize([1, 2, 3]), quantize([-1, -2, -3]))).toBeCloseTo(-1, 2);
  });

  it("orthogonal vectors have similarity about 0", () => {
    expect(similarity(quantize([1, 0, 0]), quantize([0, 1, 0]))).toBeCloseTo(0, 2);
  });

  it("quantize throws on a zero vector", () => {
    expect(() => quantize([0, 0, 0])).toThrow(RangeError);
  });

  it("similarity throws when lengths differ", () => {
    expect(() => similarity(quantize([1, 2, 3]), quantize([1, 2]))).toThrow(RangeError);
  });

  it("fuse merges two ranked lists by reciprocal rank", () => {
    expect(fuse([[1, 2, 3], [3, 1]])).toEqual([1, 3, 2]);
  });

  it("fuse breaks a tie by the smaller id, and uses k = 60", () => {
    expect(fuse([[2], [1]])).toEqual([1, 2]);
    // With k = 60, rank 5 in both lists (2/65) beats rank 1 in one list (1/61); with k = 1 it would not (2/6 < 1/2).
    expect(fuse([[1, 2, 3, 4, 5], [6, 7, 8, 9, 5]])).toEqual([5, 1, 6, 2, 7, 3, 8, 4, 9]);
  });
});
