import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { VIEWER_CSP } from "../src/links/viewer.ts";

// (vitest runs from apps/api.) /viewer.html is served straight from static assets, so its headers come from apps/viewer/static/_headers.
describe("viewer _headers", () => {
  const text = readFileSync("../viewer/static/_headers", "utf8");
  test("gives /viewer.html the same CSP as /l/:id", () => {
    const section = text.split(/\n(?=\/)/).find((s) => s.startsWith("/viewer.html")) ?? "";
    expect(section).toContain(`Content-Security-Policy: ${VIEWER_CSP}`);
    expect(section).toContain("X-Content-Type-Options: nosniff");
  });
  test("nosniffs the viewer assets", () => {
    expect(text).toMatch(/\/viewer\/\*\n\s+X-Content-Type-Options: nosniff/);
  });
});
