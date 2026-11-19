import { describe, expect, test } from "vitest";
import { ConfigResponseSchema } from "../src/config.ts";

const good = {
  prices: { version: "2026-11-16.2", credits: { explain: 1, research_deep: 125 } },
  routes_version: "2026-11-16.1",
  flags: { new_export: true },
  min_native: { ios: "1.4.0" },
  voice_pack: {
    version: "2026-11-01",
    url: "https://packs.example.com/voices.zip",
    sha256: "ab".repeat(32),
    size: 1024,
  },
};

describe("ConfigResponseSchema", () => {
  test("accepts a good response", () => {
    expect(ConfigResponseSchema.safeParse(good).success).toBe(true);
  });

  test("rejects extra keys at the top level", () => {
    expect(ConfigResponseSchema.safeParse({ ...good, router: {} }).success).toBe(false);
  });

  test("rejects a voice pack sha256 that is not lowercase hex", () => {
    const voice_pack = { ...good.voice_pack, sha256: "AB".repeat(32) };
    expect(ConfigResponseSchema.safeParse({ ...good, voice_pack }).success).toBe(false);
  });

  test("rejects a voice pack size of 0", () => {
    const voice_pack = { ...good.voice_pack, size: 0 };
    expect(ConfigResponseSchema.safeParse({ ...good, voice_pack }).success).toBe(false);
  });
});
