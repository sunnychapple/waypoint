import { describe, expect, it } from "vitest";
import { bytesEqual, concat, context, fromBase64Url, fromHex, toBase64Url, toHex, u16 } from "../src/index.ts";

describe("base64url", () => {
  it("round-trips 0 to 66 bytes without padding", () => {
    for (let n = 0; n <= 66; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(text)).toEqual(bytes);
    }
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });

  it("rejects padding, the standard alphabet, bad lengths and non-canonical text", () => {
    for (const bad of ["AA==", "+/8", "A", "AB$", "AB "]) expect(() => fromBase64Url(bad), bad).toThrow(RangeError);
    expect(() => fromBase64Url("AB")).toThrow(RangeError); // canonical form of [0x00] is "AA"
  });
});

describe("hex, u16, concat, bytesEqual", () => {
  it("work", () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
    expect(fromHex("000fff")).toEqual(new Uint8Array([0, 15, 255]));
    expect(() => fromHex("0F")).toThrow(RangeError);
    expect(() => fromHex("abc")).toThrow(RangeError);
    expect(u16(258)).toEqual(new Uint8Array([1, 2]));
    expect(() => u16(65536)).toThrow(RangeError);
    expect(() => u16(-1)).toThrow(RangeError);
    expect(concat(new Uint8Array([1]), new Uint8Array(0), new Uint8Array([2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false);
  });
});

describe("context", () => {
  it("is the label, a zero byte, then length-prefixed UTF-8 fields", () => {
    expect(toHex(context("x"))).toBe(toHex(new TextEncoder().encode("waypoint/v1/x")) + "00");
    expect(toHex(context("x", "", "ab"))).toBe(toHex(new TextEncoder().encode("waypoint/v1/x")) + "00" + "0000" + "00026162");
  });

  it("moving a byte between fields changes the result", () => {
    expect(toHex(context("x", "ab", "c"))).not.toBe(toHex(context("x", "a", "bc")));
  });

  it("rejects labels outside [a-z0-9-]{1,32}", () => {
    for (const bad of ["", "A", "a/b", "a".repeat(33)]) expect(() => context(bad)).toThrow(RangeError);
  });
});
