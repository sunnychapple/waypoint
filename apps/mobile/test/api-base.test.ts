import { describe, expect, it, vi } from "vitest";

// api.ts builds the API client at import time; the native and client modules are stubbed so only the helper is real.
vi.mock("@clerk/expo", () => ({ getClerkInstance: () => ({ session: null }) }));
vi.mock("expo/fetch", () => ({ fetch: globalThis.fetch }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
vi.mock("@waypoint/api-client", () => ({ createApiClient: () => ({}) }));

const { apiBaseFrom } = await import("../src/platform/api.ts");

describe("apiBaseFrom", () => {
  it("keeps a host with no trailing slash as it is", () => {
    expect(apiBaseFrom("https://api.waypoint.app")).toBe("https://api.waypoint.app");
  });

  it("strips one or more trailing slashes", () => {
    expect(apiBaseFrom("https://api.waypoint.app/")).toBe("https://api.waypoint.app");
    expect(apiBaseFrom("https://api.waypoint.app///")).toBe("https://api.waypoint.app");
  });

  it("is empty when the variable is unset", () => {
    expect(apiBaseFrom(undefined)).toBe("");
    expect(apiBaseFrom("")).toBe("");
  });

  it("a link built from the stripped base has no double slash", () => {
    const base = apiBaseFrom("https://api.waypoint.app/");
    expect(`${base}/l/abc`).toBe("https://api.waypoint.app/l/abc");
  });
});
