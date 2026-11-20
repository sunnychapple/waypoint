import { describe, expect, it } from "vitest";
import { answerBlocks, inlineParts, openableUrl } from "../src/core/research/answer.ts";

describe("research answer", () => {
  it("never keeps an image or link URL, and keeps citations for known sources", () => {
    expect(inlineParts("Cells ![x](https://evil.test/?notes=abc) divide [1][7] see [the page](https://www.nih.gov/a) **now**", new Set([1]))).toEqual([
      { kind: "text", text: "Cells (image: x) divide " },
      { kind: "cite", n: 1 },
      { kind: "text", text: "[7] see the page (www.nih.gov) now" },
    ]);
  });
  it("blocks: headings, bullets, paragraphs joined across lines", () => {
    const md = "# Mitosis\nCells split\ninto two. [2]\n\n- one\n2. two\n```\ncode\n```\n> quoted";
    expect(answerBlocks(md, [2]).map((b) => [b.kind, b.parts.map((p) => (p.kind === "text" ? p.text : `#${p.n}`)).join("")])).toEqual([
      ["heading", "Mitosis"],
      ["paragraph", "Cells split into two. #2"],
      ["bullet", "one"],
      ["bullet", "two"],
      ["paragraph", "code"],
      ["paragraph", "quoted"],
    ]);
  });
  it("emphasis is dropped, words with underscores are kept", () => {
    expect(inlineParts("an *important* snake_case word", new Set())).toEqual([{ kind: "text", text: "an important snake_case word" }]);
  });
  it("openableUrl", () => {
    expect(openableUrl("https://a.test/x")).toBe("https://a.test/x");
    expect(openableUrl("javascript:alert(1)")).toBeNull();
    expect(openableUrl("data:text/html,x")).toBeNull();
  });
});
