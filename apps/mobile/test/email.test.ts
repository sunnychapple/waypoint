import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../src/core/auth/email.ts";

describe("normalizeEmail", () => {
  it("trims and lower-cases a valid address", () => {
    expect(normalizeEmail(" Zack@Example.COM ")).toBe("zack@example.com");
  });

  it("returns null for an address with no domain part", () => {
    expect(normalizeEmail("zack@")).toBeNull();
  });

  it("returns null for an address with no local part", () => {
    expect(normalizeEmail("@x.io")).toBeNull();
  });

  it("returns null for an address with a space inside", () => {
    expect(normalizeEmail("a b@c.io")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(normalizeEmail("")).toBeNull();
  });

  it("returns null for an address longer than 254 characters", () => {
    const longAddress = `${"a".repeat(250)}@x.io`;
    expect(longAddress.length).toBe(255);
    expect(normalizeEmail(longAddress)).toBeNull();
  });
});
