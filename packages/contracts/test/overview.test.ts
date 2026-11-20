import { describe, expect, test } from "vitest";
import { OverviewScriptDraftSchema, OverviewScriptResultSchema } from "../src/overview.ts";

const LINES = [
  { host: "A", text: "Osmosis moves water across a membrane." },
  { host: "B", text: "Why does the water move?" },
  { host: "A", text: "It moves toward the side with more solute." },
  { host: "B", text: "So the cell takes in water?" },
];
const DRAFT = { title: "Osmosis", lines: LINES };

describe("overview script schemas", () => {
  test("a draft with a title and four lines alternating A and B parses", () => {
    expect(OverviewScriptDraftSchema.parse(DRAFT)).toEqual(DRAFT);
  });

  test("a key the model added is dropped, at the top and inside a line", () => {
    const parsed = OverviewScriptDraftSchema.parse({ ...DRAFT, notes: "x", lines: LINES.map((line) => ({ ...line, extra: 1 })) });
    expect(parsed).toEqual(DRAFT);
    expect("notes" in parsed).toBe(false);
  });

  test("host C is rejected", () => {
    const lines = [{ host: "C", text: "Hello" }, ...LINES.slice(1)];
    expect(OverviewScriptDraftSchema.safeParse({ ...DRAFT, lines }).success).toBe(false);
  });

  test("three lines are rejected", () => {
    expect(OverviewScriptDraftSchema.safeParse({ ...DRAFT, lines: LINES.slice(0, 3) }).success).toBe(false);
  });

  test("a 1,201-character line is rejected", () => {
    const lines = [{ host: "A", text: "x".repeat(1201) }, ...LINES.slice(1)];
    expect(OverviewScriptDraftSchema.safeParse({ ...DRAFT, lines }).success).toBe(false);
  });

  test("an empty title is rejected", () => {
    expect(OverviewScriptDraftSchema.safeParse({ ...DRAFT, title: "" }).success).toBe(false);
  });

  test("the result needs v: 1; v: 2 and no v are rejected", () => {
    expect(OverviewScriptResultSchema.parse({ v: 1, ...DRAFT })).toEqual({ v: 1, ...DRAFT });
    expect(OverviewScriptResultSchema.safeParse({ v: 2, ...DRAFT }).success).toBe(false);
    expect(OverviewScriptResultSchema.safeParse(DRAFT).success).toBe(false);
  });
});
