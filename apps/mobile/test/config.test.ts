import { describe, expect, it } from "vitest";
import { creditsLabel, isStale, needsUpdate, parseCachedConfig, parseVersion, priceOf, CONFIG_MAX_AGE_MS } from "../src/core/config/config.ts";

const CONFIG = { prices: { version: "2026-11-16.2", credits: { explain: 1, more_detail: 3 } }, routes_version: "r1", flags: {}, min_native: { ios: "0.2.0" }, voice_pack: { version: "1", url: "https://x.test/p", sha256: "a".repeat(64), size: 1 } };

describe("config", () => {
  it("versions", () => {
    expect(parseVersion("1.4")).toEqual([1, 4, 0]);
    expect(parseVersion(" 1.4.2 ")).toEqual([1, 4, 2]);
    for (const bad of ["1", "1.4.2.1", "v1.4", "", "1.a"]) expect(parseVersion(bad)).toBeNull();
    expect(needsUpdate("0.1.0", "0.2.0")).toBe(true);
    expect(needsUpdate("0.2.0", "0.2")).toBe(false);
    expect(needsUpdate("1.10.0", "1.9.9")).toBe(false);
    expect(needsUpdate("1.9.9", "1.10.0")).toBe(true);
    expect(needsUpdate(null, "9.9.9")).toBe(false);
    expect(needsUpdate("1.0.0", "soon")).toBe(false);
  });
  it("stale", () => {
    expect(isStale(null, 5)).toBe(true);
    expect(isStale(1000, 1000 + CONFIG_MAX_AGE_MS - 1)).toBe(false);
    expect(isStale(1000, 1000 + CONFIG_MAX_AGE_MS)).toBe(true);
    expect(isStale(1000, 999)).toBe(true);
    expect(isStale(Number.NaN, 1)).toBe(true);
    expect(isStale(Number("garbage"), Date.now())).toBe(true);
  });
  it("cache, price, label", () => {
    expect(parseCachedConfig(JSON.stringify(CONFIG))).toEqual(CONFIG);
    expect(parseCachedConfig("{")).toBeNull();
    expect(parseCachedConfig(JSON.stringify({ ...CONFIG, extra: 1 }))).toBeNull();
    expect(parseCachedConfig(null)).toBeNull();
    const c = parseCachedConfig(JSON.stringify(CONFIG));
    expect(priceOf(c, "more_detail")).toBe(3);
    expect(priceOf(c, "toString")).toBeNull();
    expect(priceOf(null, "explain")).toBeNull();
    expect(creditsLabel(1)).toBe("1 credit");
    expect(creditsLabel(3)).toBe("3 credits");
    expect(creditsLabel(20000)).toBe("20,000 credits");
  });
});
