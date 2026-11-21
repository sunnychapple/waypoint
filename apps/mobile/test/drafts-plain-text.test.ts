import { describe, expect, it } from "vitest";
import { cleanCards, cleanHelp, parseCardLines, parseHelpLines } from "../src/core/study/drafts.ts";

describe("parseCardLines", () => {
  it("reads labeled cards with and without bold labels, and lower case labels", () => {
    const text = "FRONT: Mitosis\nBACK: Cell division.\n\n**FRONT:** Meiosis\n**BACK:** Cell division for sex cells.\n\nfront: Osmosis\nback: Water moves across a membrane.";
    expect(parseCardLines(text)).toEqual([
      { kind: "term", front: "Mitosis", back: "Cell division." },
      { kind: "term", front: "Meiosis", back: "Cell division for sex cells." },
      { kind: "term", front: "Osmosis", back: "Water moves across a membrane." },
    ]);
  });

  it("drops a FRONT that has no BACK before the next FRONT", () => {
    const text = "FRONT: Orphan\n\nFRONT: Kept\nBACK: Has a back.";
    expect(parseCardLines(text)).toEqual([{ kind: "term", front: "Kept", back: "Has a back." }]);
  });

  it("joins a multi-line back and stops it at a blank line", () => {
    const text = "FRONT: Rain\nBACK: Water that falls\nfrom clouds.\n\nNot part of the back.\n\nFRONT: Snow\nBACK: Frozen water.";
    expect(parseCardLines(text)).toEqual([
      { kind: "term", front: "Rain", back: "Water that falls from clouds." },
      { kind: "term", front: "Snow", back: "Frozen water." },
    ]);
  });

  it("reads the bold block form, with --- and - separators", () => {
    const text = "**Mitosis**\nCell division that makes two identical cells.\n---\n**Osmosis**\nWater moves across a membrane.\n-\n**Lonely**\n\nNo back here, so ignored.\n\nProse that is not bold.\nStill prose.";
    expect(parseCardLines(text)).toEqual([
      { kind: "term", front: "Mitosis", back: "Cell division that makes two identical cells." },
      { kind: "term", front: "Osmosis", back: "Water moves across a membrane." },
    ]);
  });

  it("returns none for prose with no cards", () => {
    expect(parseCardLines("Sorry.")).toEqual([]);
  });
});

describe("parseHelpLines", () => {
  it("reads numbered and bold labels, multi-line detail, and the last answer", () => {
    const text = "**STEP 1:** Find the total\nDO: Add the two prices\nand keep the cents.\nSTEP 2: Find the change\nDO: Subtract the total from 20.\nANSWER: 3.50\nANSWER: 4.25";
    expect(parseHelpLines(text)).toEqual({
      steps: [
        { title: "Find the total", detail: "Add the two prices and keep the cents." },
        { title: "Find the change", detail: "Subtract the total from 20." },
      ],
      answer: "4.25",
    });
  });

  it("returns null with no answer, or with no steps", () => {
    expect(parseHelpLines("STEP: a\nDO: b")).toBeNull();
    expect(parseHelpLines("ANSWER: 4")).toBeNull();
    expect(cleanHelp({ plainText: "STEP: a\nDO: b" })).toBeNull();
    expect(cleanHelp({ plainText: "ANSWER: 4" })).toBeNull();
  });
});

describe("cleanCards on plain text", () => {
  it("returns none for prose", () => {
    expect(cleanCards([{ plainText: "Sorry." }], 5)).toEqual([]);
  });

  it("applies the limit and removes duplicate fronts", () => {
    const text = "FRONT: One\nBACK: a\n\nFRONT: one!\nBACK: b\n\nFRONT: Two\nBACK: c\n\nFRONT: Three\nBACK: d";
    expect(cleanCards([{ plainText: text }], 2)).toEqual([
      { kind: "term", front: "One", back: "a" },
      { kind: "term", front: "Two", back: "c" },
    ]);
  });
});

describe("typed replies are unchanged", () => {
  it("cleanCards still reads typed cards", () => {
    expect(cleanCards([{ kind: "problem", front: "3x = 6", back: "x = 2" }], 5)).toEqual([
      { kind: "problem", front: "3x = 6", back: "x = 2" },
    ]);
  });

  it("cleanHelp still reads typed help", () => {
    expect(cleanHelp({ steps: [{ title: "Divide", detail: "Divide both sides." }], answer: "2" })).toEqual({
      steps: [{ title: "Divide", detail: "Divide both sides." }],
      answer: "2",
    });
  });
});
