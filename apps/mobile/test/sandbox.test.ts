import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATE_HTML } from "../src/core/made/gate.ts";
import { MERMAID_SCRIPT, SANDBOX_CSP, diagramPage, miniAppPage, scriptJson } from "../src/core/made/sandbox.ts";

describe("sandbox pages", () => {
  it("the CSP comes before the model's HTML", () => {
    const page = miniAppPage("<script>fetch('x')</script>");
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page.indexOf(SANDBOX_CSP)).toBeLessThan(page.indexOf("fetch("));
  });
  it("scriptJson never contains <", () => {
    const s = scriptJson("</script><script>alert(1) ");
    expect(s.includes("<")).toBe(false);
    expect(JSON.parse(s)).toBe("</script><script>alert(1) ");
  });
  it("diagram page", () => {
    const page = diagramPage("graph TD; A-->B </script>", false);
    expect(page).toContain('securityLevel:"strict"');
    expect(page.split(MERMAID_SCRIPT)).toHaveLength(2);
    expect(page.match(/<\/script>/g)).toHaveLength(2);
  });
});

describe("the bundled Mermaid", () => {
  it("is mermaid@12.3.0's dist/mermaid.min.js, unchanged", () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), "../modules/waypoint-sandbox/ios/Resources/mermaid.min.js");
    expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe("336df803d87a38b70a01e736e666c8f7601d2ce42f5e47c8fafe5d721074b9a3");
  });
});

describe("the gate page", () => {
  it("GATE_HTML is gate.html, unchanged", () => {
    const file = join(dirname(fileURLToPath(import.meta.url)), "../modules/waypoint-sandbox/gate/gate.html");
    expect(GATE_HTML).toBe(readFileSync(file, "utf8"));
  });
});
