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

  it("treats a --- line as the end of a labeled card", () => {
    expect(parseCardLines("**Front:** A\n**Back:** B\n---\n**Front:** C\n**Back:** D\n---\nsome commentary")).toEqual([
      { kind: "term", front: "A", back: "B" },
      { kind: "term", front: "C", back: "D" },
    ]);
  });

  it("keeps ** inside math", () => {
    expect(parseCardLines("**FRONT:** Evaluate 2**3\n**BACK:** 2**3 = 8")).toEqual([{ kind: "term", front: "Evaluate 2**3", back: "2**3 = 8" }]);
  });

  it.each(["(a+b)**2", "x**(n+1)", "2**-1", "2 ** 3", "3 * 4 ** 2", "x**2 + y**2"])("keeps the power in %s", (math) => {
    expect(parseCardLines(`**FRONT:** ${math}\n**BACK:** ${math}`)).toEqual([{ kind: "term", front: math, back: math }]);
  });

  it("still removes real bold, including a label glued to its value", () => {
    expect(parseCardLines("**Front:**Mitosis\n**Back:** **Cell** division")).toEqual([{ kind: "term", front: "Mitosis", back: "Cell division" }]);
  });

  it.each(["***", "___"])("treats a %s line as a break", (rule) => {
    expect(parseCardLines(`FRONT: a\nBACK: b\n${rule}\nFRONT: c\nBACK: d`)).toEqual([
      { kind: "term", front: "a", back: "b" },
      { kind: "term", front: "c", back: "d" },
    ]);
  });

  it("reads a multi-line front and labels on their own line", () => {
    expect(parseCardLines("FRONT: What is\nmitosis?\nBACK: Cell division")).toEqual([{ kind: "term", front: "What is mitosis?", back: "Cell division" }]);
    expect(parseCardLines("**Front:**\nMitosis\n**Back:**\nCell division")).toEqual([{ kind: "term", front: "Mitosis", back: "Cell division" }]);
  });

  it("reads numbered and bulleted labels and CRLF, and keeps a numbered line in a back", () => {
    expect(parseCardLines("1. **Front:** A\r\n   **Back:** B\r\n\r\n- **Front:** C\r\n- **Back:** D")).toEqual([
      { kind: "term", front: "A", back: "B" },
      { kind: "term", front: "C", back: "D" },
    ]);
    expect(parseCardLines("FRONT: Solve\nBACK: Do these:\n1) 3x = 6")[0]?.back).toBe("Do these: 1) 3x = 6");
  });

  it("reads a numbered bold block without the number on the front", () => {
    expect(parseCardLines("1. **Mitosis**\nCell division.")).toEqual([{ kind: "term", front: "Mitosis", back: "Cell division." }]);
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

  it("ends a step at ---, keeps ** in the answer, and keeps a closing remark out of the answer", () => {
    expect(parseHelpLines("STEP: a\nDO: b\n---\nSTEP: c\nDO: d\n---\nANSWER: 2**3 = 8\nHope this helps!")).toEqual({
      steps: [{ title: "a", detail: "b" }, { title: "c", detail: "d" }],
      answer: "2**3 = 8",
    });
  });

  it("reads bulleted labels, an answer on the next line, and keeps a step with no DO", () => {
    expect(parseHelpLines("1. **STEP:** a\n   **DO:** b\nSTEP: c\nSTEP: d\nDO: e\nANSWER:\n42")).toEqual({
      steps: [{ title: "a", detail: "b" }, { title: "c", detail: "c" }, { title: "d", detail: "e" }],
      answer: "42",
    });
  });

  it("keeps a real answer when an empty ANSWER follows it", () => {
    expect(parseHelpLines("STEP: a\nDO: b\nANSWER: 7\nANSWER:\nHope this helps!")?.answer).toBe("7");
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
