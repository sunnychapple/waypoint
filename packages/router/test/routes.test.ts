import { describe, expect, test } from "vitest";
import { DEFAULT_ROUTES, RouteTableSchema } from "../src/index.ts";

describe("DEFAULT_ROUTES", () => {
  test("parses with RouteTableSchema", () => {
    expect(RouteTableSchema.parse(DEFAULT_ROUTES)).toEqual(DEFAULT_ROUTES);
  });

  test("fixed uses the contract task names and tiers", () => {
    expect(DEFAULT_ROUTES.fixed).toEqual({
      more_detail: "standard",
      double_check: "strong",
      read_link: "light",
      research: "standard",
      overview_script: "strong",
      video_slides: "strong",
      diagram: "strong",
      mini_app: "strong",
      practice: "standard",
    });
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

  test("rejects an empty model string", () => {
    const result = RouteTableSchema.safeParse({
      ...DEFAULT_ROUTES,
      tiers: { ...DEFAULT_ROUTES.tiers, strong: [{ model: "", retention: "zero" }] },
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

  test("rejects a typo in a fixed task name", () => {
    const { double_check: strong, ...rest } = DEFAULT_ROUTES.fixed;
    const result = RouteTableSchema.safeParse({
      ...DEFAULT_ROUTES,
      fixed: { ...rest, doble_check: strong },
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty fixed object", () => {
    const result = RouteTableSchema.safeParse({ ...DEFAULT_ROUTES, fixed: {} });
    expect(result.success).toBe(false);
  });

  test("rejects fixed without double_check", () => {
    const { double_check: _omitted, ...rest } = DEFAULT_ROUTES.fixed;
    const result = RouteTableSchema.safeParse({ ...DEFAULT_ROUTES, fixed: rest });
    expect(result.success).toBe(false);
  });

  test("rejects fixed that lists explain", () => {
    const result = RouteTableSchema.safeParse({
      ...DEFAULT_ROUTES,
      fixed: { ...DEFAULT_ROUTES.fixed, explain: "light" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects fixed that lists retranscribe", () => {
    const result = RouteTableSchema.safeParse({
      ...DEFAULT_ROUTES,
      fixed: { ...DEFAULT_ROUTES.fixed, retranscribe: "light" },
    });
    expect(result.success).toBe(false);
  });
});

describe("optional fixed tasks", () => {
  test("a table without problem_help parses, and one with it parses", () => {
    expect(RouteTableSchema.safeParse(DEFAULT_ROUTES).success).toBe(true);
    expect(RouteTableSchema.safeParse({ ...DEFAULT_ROUTES, fixed: { ...DEFAULT_ROUTES.fixed, problem_help: "strong" } }).success).toBe(true);
  });

  test("problem_help pointing at an unknown tier is rejected", () => {
    expect(RouteTableSchema.safeParse({ ...DEFAULT_ROUTES, fixed: { ...DEFAULT_ROUTES.fixed, problem_help: "huge" } }).success).toBe(false);
  });
});
