import { describe, expect, it } from "vitest";
import { groupBlocks, parseLines, type Line } from "../src/core/pages/blocks.ts";

function line(text: string, x: number, y: number, width = 0.4, height = 0.03): Line {
  return { text, x, y, width, height };
}

describe("groupBlocks", () => {
  it("splits the T2 page into 5 blocks, with problem 4 as one three-line block", () => {
    const page = [
      line("Worksheet 4: Equations", 0.1, 0.05, 0.6),
      line("1. 3x + 7 = 22", 0.1, 0.12),
      line("2. 2(x − 4) = 10", 0.1, 0.17),
      line("3. x ÷ 5 + 3 = 9", 0.1, 0.22),
      line("4. A train leaves at 9:40 and", 0.1, 0.27),
      line("travels 150 km at 60 km/h.", 0.1, 0.32),
      line("When does it arrive?", 0.1, 0.37),
    ];
    const blocks = groupBlocks(page);
    expect(blocks).toHaveLength(5);
    expect(blocks[4]?.lines).toBe(3);
    expect(blocks[4]?.text).toBe("4. A train leaves at 9:40 and travels 150 km at 60 km/h. When does it arrive?");
  });

  it("a big vertical gap splits a paragraph", () => {
    const blocks = groupBlocks([
      line("First part of a paragraph.", 0.1, 0.1),
      line("still the same paragraph.", 0.1, 0.14),
      line("New paragraph after a gap.", 0.1, 0.3),
    ]);
    expect(blocks.map((b) => b.lines)).toEqual([2, 1]);
  });

  it('"a) ..." starts a block', () => {
    const blocks = groupBlocks([line("Part one continues", 0.1, 0.1), line("a) First option", 0.1, 0.14)]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.text).toBe("a) First option");
  });

  it("the block box is the union of its lines' boxes", () => {
    const [block] = groupBlocks([line("one", 0.1, 0.1, 0.2), line("two", 0.05, 0.14, 0.4)]);
    expect(block?.x).toBeCloseTo(0.05);
    expect(block?.y).toBeCloseTo(0.1);
    expect(block?.width).toBeCloseTo(0.4);
    expect(block?.height).toBeCloseTo(0.07);
  });

  it("a line indented more than 0.15 from the block's first line starts a new block", () => {
    const blocks = groupBlocks([line("Solve:", 0.1, 0.1), line("x + 1 = 2", 0.4, 0.15)]);
    expect(blocks.map((b) => b.text)).toEqual(["Solve:", "x + 1 = 2"]);
  });

  it("a line on the same row at another x stays in the block", () => {
    const blocks = groupBlocks([line("Name:", 0.1, 0.1, 0.2), line("Date:", 0.5, 0.105, 0.2)]);
    expect(blocks.map((b) => b.text)).toEqual(["Name: Date:"]);
  });

  it("the gap limit uses the median line height, not the tallest line", () => {
    const blocks = groupBlocks([line("one", 0.1, 0.1), line("two", 0.1, 0.18), line("TITLE", 0.1, 0.5, 0.4, 0.1)]);
    expect(blocks.map((b) => b.text)).toEqual(["one", "two", "TITLE"]);
  });

  it("empty input gives no blocks", () => {
    expect(groupBlocks([])).toEqual([]);
  });
});

describe("parseLines", () => {
  it('"nope" gives no lines', () => {
    expect(parseLines("nope")).toEqual([]);
  });

  it("drops an item whose x is out of range", () => {
    const json = JSON.stringify([
      { text: "ok", x: 0.1, y: 0.1, width: 0.2, height: 0.03 },
      { text: "bad", x: 2, y: 0.1, width: 0.2, height: 0.03 },
    ]);
    const lines = parseLines(json);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe("ok");
  });
});
