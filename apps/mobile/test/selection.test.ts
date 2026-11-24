import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { editLine, lineMarks, toggleHighlight } from "../src/core/capture/marks.ts";
import {
  canExplain,
  compareRefs,
  explainedWords,
  isSelected,
  nextSelection,
  paragraphSelection,
  pickedText,
  refKey,
  wordsOf,
  type WordRef,
} from "../src/core/capture/selection.ts";
import { createMemoryDb } from "./helpers/db.ts";

const ref = (at: number, index: number): WordRef => ({ at, index });

describe("wordsOf", () => {
  it("splits on whitespace and drops empty words", () => {
    expect(wordsOf("  Cells,  divide \n now ")).toEqual(["Cells", "divide", "now"]);
    expect(wordsOf("   ")).toEqual([]);
    expect(wordsOf("")).toEqual([]);
  });

  it("does not count punctuation on its own, so \"so — we ... go\" is 3 words", () => {
    expect(wordsOf("so — we ... go")).toEqual(["so", "we", "go"]);
  });

  it("does not count a token over 100 characters", () => {
    expect(wordsOf(`short ${"a".repeat(101)} end`)).toEqual(["short", "end"]);
  });
});

describe("nextSelection", () => {
  it("selects one word on the first tap", () => {
    expect(nextSelection(null, ref(0, 2))).toEqual({ from: ref(0, 2), to: ref(0, 2) });
  });

  it("selects from the picked word to a later word, across lines", () => {
    const first = nextSelection(null, ref(0, 2));
    expect(nextSelection(first, ref(5_000, 1))).toEqual({ from: ref(0, 2), to: ref(5_000, 1) });
  });

  it("selects from an earlier word up to the picked word", () => {
    const first = nextSelection(null, ref(5_000, 1));
    expect(nextSelection(first, ref(0, 2))).toEqual({ from: ref(0, 2), to: ref(5_000, 1) });
  });

  it("clears the selection when the picked word is tapped again", () => {
    expect(nextSelection({ from: ref(0, 2), to: ref(0, 2) }, ref(0, 2))).toBeNull();
  });

  it("starts a new one-word selection after a range", () => {
    const range = { from: ref(0, 0), to: ref(0, 3) };
    expect(nextSelection(range, ref(1_000, 0))).toEqual({ from: ref(1_000, 0), to: ref(1_000, 0) });
  });
});

describe("isSelected and compareRefs", () => {
  const range = { from: ref(0, 2), to: ref(5_000, 1) };

  it("is true at both ends and inside, false just outside", () => {
    expect(isSelected(range, ref(0, 2))).toBe(true);
    expect(isSelected(range, ref(5_000, 1))).toBe(true);
    expect(isSelected(range, ref(0, 1))).toBe(false);
    expect(isSelected(range, ref(5_000, 2))).toBe(false);
    expect(isSelected(null, ref(0, 0))).toBe(false);
  });

  it("orders by line start, then word index", () => {
    expect(compareRefs(ref(0, 9), ref(1, 0))).toBeLessThan(0);
    expect(compareRefs(ref(1, 0), ref(1, 0))).toBe(0);
    expect(refKey(ref(1, 2))).toBe("1:2");
  });
});

describe("pickedText", () => {
  it("gives the words for words 0 to 1, with edge punctuation trimmed", () => {
    const picked = pickedText([{ at: 0, text: "Cells, divide. Then" }], { from: ref(0, 0), to: ref(0, 1) });
    expect(picked).toEqual({ text: "Cells divide", lines: [{ at: 0, from: 0, to: 1 }] });
  });

  it("counts words the way the renderer taps them: punctuation-only tokens take no index", () => {
    const lines = [{ at: 0, text: "so — we ... go" }];
    expect(pickedText(lines, { from: ref(0, 1), to: ref(0, 2) })).toEqual({ text: "we go", lines: [{ at: 0, from: 1, to: 2 }] });
    expect(paragraphSelection(lines)).toEqual({ from: ref(0, 0), to: ref(0, 2) });
    expect(explainedWords(lines, [{ id: "e5", t: 0, term: "go" }]).get("0:2")).toBe("e5");
  });

  it("joins two lines with one space, and the second line starts at word 0", () => {
    const lines = [
      { at: 0, text: "Mitosis splits" },
      { at: 5_000, text: "the nucleus here" },
    ];
    const picked = pickedText(lines, { from: ref(0, 1), to: ref(5_000, 1) });
    expect(picked.text).toBe("splits the nucleus");
    expect(picked.lines).toEqual([
      { at: 0, from: 1, to: 1 },
      { at: 5_000, from: 0, to: 1 },
    ]);
  });

  it("skips lines outside the range", () => {
    const lines = [
      { at: 0, text: "before here" },
      { at: 5_000, text: "inside" },
      { at: 10_000, text: "after here" },
    ];
    expect(pickedText(lines, { from: ref(5_000, 0), to: ref(5_000, 0) })).toEqual({ text: "inside", lines: [{ at: 5_000, from: 0, to: 0 }] });
  });

  it("stops at the last word of a line that is now shorter", () => {
    const picked = pickedText([{ at: 0, text: "one two" }], { from: ref(0, 0), to: ref(0, 5) });
    expect(picked).toEqual({ text: "one two", lines: [{ at: 0, from: 0, to: 1 }] });
  });
});

describe("canExplain", () => {
  it("refuses empty text and text over 100 characters", () => {
    expect(canExplain("")).toBe(false);
    expect(canExplain("a".repeat(100))).toBe(true);
    expect(canExplain("a".repeat(101))).toBe(false);
  });
});

describe("paragraphSelection", () => {
  it("runs from the first word of the first line to the last word of the last", () => {
    const lines = [
      { at: 0, text: "one two" },
      { at: 5_000, text: "three four five" },
    ];
    expect(paragraphSelection(lines)).toEqual({ from: ref(0, 0), to: ref(5_000, 2) });
  });

  it("skips a line with no words", () => {
    const lines = [
      { at: 0, text: "one" },
      { at: 5_000, text: "   " },
      { at: 9_000, text: "two" },
    ];
    expect(paragraphSelection(lines)).toEqual({ from: ref(0, 0), to: ref(9_000, 0) });
  });

  it("returns null when there are no words", () => {
    expect(paragraphSelection([{ at: 0, text: "" }])).toBeNull();
  });
});

describe("explainedWords", () => {
  const lines = [
    { at: 0, text: "Mitosis, is cell division." },
    { at: 5_000, text: "Mitosis again here" },
  ];

  it("marks the word in the line it was asked from, not the same word in another line", () => {
    const marked = explainedWords(lines, [{ id: "e1", t: 0, term: "mitosis" }]);
    expect([...marked.keys()]).toEqual(["0:0"]);
    expect(marked.get("0:0")).toBe("e1");
  });

  it("marks a phrase that runs into the next line in both lines", () => {
    const marked = explainedWords(
      [
        { at: 0, text: "cell division" },
        { at: 5_000, text: "happens fast" },
      ],
      [{ id: "e2", t: 0, term: "division happens" }],
    );
    expect([...marked.keys()].sort()).toEqual(["0:1", "5000:0"]);
  });

  it("ignores case and punctuation when matching", () => {
    const marked = explainedWords(lines, [{ id: "e3", t: 0, term: "MITOSIS." }]);
    expect(marked.has("0:0")).toBe(true);
  });

  it("does not mark a term that is no longer in its line", () => {
    expect(explainedWords(lines, [{ id: "e4", t: 0, term: "meiosis" }]).size).toBe(0);
  });
});

describe("marks use the same word count", () => {
  let db: SqlDb;
  const deps = { now: () => 100 };

  beforeEach(() => {
    db = createMemoryDb();
    migrate(db);
    db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('space-1', 'My notes', 1, 0, 0)");
    db.run(
      "INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at, recorded_ms, indexed_at) VALUES ('s1', 'space-1', 'recording', 'Biology', 'saved', 'done', 0, 0, 5)",
    );
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', 0, 900, 'so — we ... go', 'device')");
  });

  it("clamps a highlight to the words of an edited line, counting punctuation-only tokens as no word", () => {
    toggleHighlight(db, deps, "s1", [{ at: 0, from: 0, to: 2 }]);
    editLine(db, deps, "s1", 0, "so — we ... ok");
    expect(lineMarks(db, "s1")[0]?.highlights).toEqual([[0, 2]]);
    editLine(db, deps, "s1", 0, "so — ok ... go");
    expect(lineMarks(db, "s1")[0]?.highlights).toEqual([[0, 2]]);
    editLine(db, deps, "s1", 0, "so — ok");
    expect(lineMarks(db, "s1")[0]?.highlights).toEqual([[0, 1]]);
  });
});
