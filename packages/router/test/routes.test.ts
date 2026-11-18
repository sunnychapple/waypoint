import { describe, expect, test } from "vitest";
import { DEFAULT_ROUTES, RouteTableSchema } from "../src/index.ts";

describe("DEFAULT_ROUTES", () => {
  test("parses with RouteTableSchema", () => {
    expect(RouteTableSchema.parse(DEFAULT_ROUTES)).toEqual(DEFAULT_ROUTES);
  });

  test("has the planning version and one entry per tier, all standard", () => {
    expect(DEFAULT_ROUTES.version).toBe("2026-11-16.1");
    expect(DEFAULT_ROUTES.tiers.light).toEqual([
      { model: "workers-ai/glm-4.7-flash", retention: "standard" },
    ]);
    expect(DEFAULT_ROUTES.tiers.standard).toEqual([
      { model: "workers-ai/deepseek-v4.1-flash", retention: "standard" },
    ]);
    expect(DEFAULT_ROUTES.tiers.strong).toEqual([
      { model: "workers-ai/kimi-k2.6", retention: "standard" },
    ]);
  });
});

describe("RouteTableSchema", () => {
  test("rejects a tier with no entries", () => {
    const result = RouteTableSchema.safeParse({
      ...DEFAULT_ROUTES,
      tiers: { ...DEFAULT_ROUTES.tiers, light: [] },
    });
    expect(result.success).toBe(false);
  });

  test("rejects a fixed task pointing at an unknown tier", () => {
    const result = RouteTableSchema.safeParse({
      ...DEFAULT_ROUTES,
      fixed: { explain: "huge" },
    });
    expect(result.success).toBe(false);
  });
});
