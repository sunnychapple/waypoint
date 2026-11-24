import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import {
  addSpan,
  coversSpan,
  editLine,
  lineMarks,
  linesToName,
  removeSpan,
  SEVERAL,
  setHidden,
  setSpeaker,
  speakerNames,
  speakerRun,
  toggleHighlight,
} from "../src/core/capture/marks.ts";
import { studyLines } from "../src/core/capture/segments.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;
const deps = { now: () => 100 };

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('space-1', 'My notes', 1, 0, 0)");
  db.run(
    "INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at, recorded_ms, indexed_at) VALUES ('s1', 'space-1', 'recording', 'Biology', 'saved', 'done', 0, 0, 5)",
  );
  db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', 0, 900, 'Cells divide.', 'device')");
  db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', 1000, 1900, 'Teacher: phones away', 'device')");
  db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', 2000, 2900, 'Mitosis has four phases.', 'device')");
  db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', 0, 900, 'Cells divide cloud.', 'cloud')");
});

function indexedAt(): number | null {
  return db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = 's1'")?.indexed_at ?? null;
}

function segmentText(tStart: number): string | undefined {
  return db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = 's1' AND source = 'device' AND t_start = ?", [tStart])?.text;
}

describe("line marks", () => {
  it("editLine stores the person's words and leaves the heard segment unchanged", () => {
    editLine(db, deps, "s1", 0, "Cells divide in two.");
    expect(lineMarks(db, "s1")).toEqual([{ tStart: 0, text: "Cells divide in two.", hidden: false, speaker: null, highlights: [] }]);
    expect(segmentText(0)).toBe("Cells divide.");
    expect(indexedAt()).toBeNull();
  });

  it("editLine with the heard words (extra spaces allowed) or with null removes the row, which is Undo", () => {
    editLine(db, deps, "s1", 0, "Cells divide in two.");
    editLine(db, deps, "s1", 0, "  Cells   divide. ");
    expect(lineMarks(db, "s1")).toEqual([]);
    editLine(db, deps, "s1", 0, "Other words.");
    editLine(db, deps, "s1", 0, null);
    expect(db.all("SELECT id FROM line_marks")).toEqual([]);
  });

  it("editLine with only spaces hides the line and keeps no text change", () => {
    editLine(db, deps, "s1", 1000, "   ");
    expect(lineMarks(db, "s1")).toEqual([{ tStart: 1000, text: null, hidden: true, speaker: null, highlights: [] }]);
  });

  it("editLine on a time with no device line writes nothing, and text over 2,000 characters is cut", () => {
    editLine(db, deps, "s1", 5000, "Nothing here.");
    expect(lineMarks(db, "s1")).toEqual([]);
    editLine(db, deps, "s1", 0, "x".repeat(2500));
    expect(lineMarks(db, "s1")[0]?.text?.length).toBe(2000);
  });

  it("setHidden hides two lines and shows them again, deleting rows with nothing left", () => {
    setHidden(db, deps, "s1", [1000, 2000], true);
    expect(lineMarks(db, "s1").map((m) => [m.tStart, m.hidden])).toEqual([
      [1000, true],
      [2000, true],
    ]);
    expect(indexedAt()).toBeNull();
    setHidden(db, deps, "s1", [1000, 2000], false);
    expect(db.all("SELECT id FROM line_marks")).toEqual([]);
  });

  it("setSpeaker stores a cleaned name, stores SEVERAL as it is, ignores names with no letter or digit, and does not touch indexed_at", () => {
    setSpeaker(db, deps, "s1", [0], "  Ms   Lee ");
    expect(lineMarks(db, "s1")[0]?.speaker).toBe("Ms Lee");
    setSpeaker(db, deps, "s1", [1000], SEVERAL);
    expect(lineMarks(db, "s1")[1]?.speaker).toBe(SEVERAL);
    setSpeaker(db, deps, "s1", [2000], "  ");
    setSpeaker(db, deps, "s1", [2000], "**");
    expect(lineMarks(db, "s1").some((m) => m.tStart === 2000)).toBe(false);
    setSpeaker(db, deps, "s1", [0], null);
    expect(lineMarks(db, "s1").some((m) => m.tStart === 0)).toBe(false);
    expect(indexedAt()).toBe(5);
  });

  it("speakerNames lists this space's names, newest first, each once, without SEVERAL", () => {
    db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('space-2', 'Other', 0, 0, 0)");
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at, recorded_ms) VALUES ('s2', 'space-2', 'recording', 'Other', 'saved', 'done', 0, 0)");
    setSpeaker(db, { now: () => 1 }, "s1", [0], "Ms Lee");
    setSpeaker(db, { now: () => 2 }, "s1", [1000], "Mr Park");
    setSpeaker(db, { now: () => 3 }, "s1", [2000], SEVERAL);
    setSpeaker(db, { now: () => 4 }, "s1", [2000], "Ms Lee");
    setSpeaker(db, { now: () => 5 }, "s2", [0], "Elsewhere");
    expect(speakerNames(db, "space-1")).toEqual(["Ms Lee", "Mr Park"]);
  });

  it("addSpan and removeSpan keep spans sorted and merged", () => {
    expect(addSpan([[0, 1]], [2, 3])).toEqual([[0, 3]]);
    expect(addSpan([[5, 6]], [0, 1])).toEqual([
      [0, 1],
      [5, 6],
    ]);
    expect(removeSpan([[0, 5]], [2, 3])).toEqual([
      [0, 1],
      [4, 5],
    ]);
    expect(coversSpan([[0, 5]], [1, 4])).toBe(true);
    expect(coversSpan([[0, 1], [2, 5]], [1, 3])).toBe(false);
  });

  it("toggleHighlight highlights picks across two lines, removes them on a second toggle, and highlights partly highlighted picks in full", () => {
    const picks = [
      { at: 0, from: 0, to: 1 },
      { at: 1000, from: 1, to: 2 },
    ];
    expect(toggleHighlight(db, deps, "s1", picks)).toBe(true);
    expect(lineMarks(db, "s1").map((m) => m.highlights)).toEqual([[[0, 1]], [[1, 2]]]);
    expect(toggleHighlight(db, deps, "s1", picks)).toBe(false);
    expect(lineMarks(db, "s1")).toEqual([]);

    toggleHighlight(db, deps, "s1", [{ at: 0, from: 0, to: 0 }]);
    expect(toggleHighlight(db, deps, "s1", [{ at: 0, from: 0, to: 2 }])).toBe(true);
    expect(lineMarks(db, "s1")[0]?.highlights).toEqual([[0, 2]]);
  });

  it("clearing a line hides it, and Undo or a retyped line shows it again", () => {
    editLine(db, deps, "s1", 1000, "");
    expect(lineMarks(db, "s1")).toEqual([{ tStart: 1000, text: null, hidden: true, speaker: null, highlights: [] }]);
    expect(studyLines(db, "s1").some((line) => line.tStart === 1000)).toBe(false);
    editLine(db, deps, "s1", 1000, null);
    expect(lineMarks(db, "s1")).toEqual([]);
    expect(studyLines(db, "s1").find((line) => line.tStart === 1000)?.text).toBe("Teacher: phones away");
    editLine(db, deps, "s1", 1000, "");
    editLine(db, deps, "s1", 1000, "Phones away now.");
    expect(lineMarks(db, "s1")).toEqual([{ tStart: 1000, text: "Phones away now.", hidden: false, speaker: null, highlights: [] }]);
  });

  it("highlights after an edit are clamped to the shown words, and dropped when they start past the last word", () => {
    toggleHighlight(db, deps, "s1", [{ at: 2000, from: 1, to: 3 }]);
    editLine(db, deps, "s1", 2000, "Mitosis ends.");
    expect(lineMarks(db, "s1").find((m) => m.tStart === 2000)?.highlights).toEqual([[1, 1]]);
    editLine(db, deps, "s1", 2000, "Done");
    expect(lineMarks(db, "s1").find((m) => m.tStart === 2000)?.highlights).toEqual([]);
  });

  it("toggleHighlight puts reversed picks in order, and applies every pick on a line", () => {
    expect(toggleHighlight(db, deps, "s1", [{ at: 2000, from: 3, to: 1 }])).toBe(true);
    expect(lineMarks(db, "s1").find((m) => m.tStart === 2000)?.highlights).toEqual([[1, 3]]);
    toggleHighlight(db, deps, "s1", [{ at: 2000, from: 0, to: 0 }, { at: 2000, from: 2, to: 2 }]);
    expect(lineMarks(db, "s1").find((m) => m.tStart === 2000)?.highlights).toEqual([[0, 3]]);
    toggleHighlight(db, deps, "s1", [{ at: 1000, from: 0, to: 0 }, { at: 1000, from: 1, to: 1 }]);
    expect(lineMarks(db, "s1").find((m) => m.tStart === 1000)?.highlights).toEqual([[0, 1]]);
  });

  it("toggleHighlight ignores picks that are not whole numbers, returns false for no picks, and skips lines that are not in the transcript", () => {
    expect(toggleHighlight(db, deps, "s1", [{ at: 0, from: -1, to: 2 }, { at: 0, from: 0.5, to: 1 }, { at: 1000, from: 0, to: NaN }])).toBe(false);
    expect(toggleHighlight(db, deps, "s1", [])).toBe(false);
    expect(toggleHighlight(db, deps, "s1", [{ at: 5000, from: 0, to: 1 }])).toBe(false);
    expect(lineMarks(db, "s1")).toEqual([]);
  });

  it("parseSpans drops only the bad entries, then sorts and merges the rest", () => {
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, highlights, updated_at) VALUES ('s1:2000', 's1', 2000, NULL, '[[3,1],[\"x\",2],[5,6],[0,2],[1,3]]', 1)");
    expect(lineMarks(db, "s1").find((m) => m.tStart === 2000)?.highlights).toEqual([
      [0, 3],
      [5, 6],
    ]);
  });

  it("setHidden, setSpeaker and toggleHighlight write nothing for a line that is not a device line, or a start that is not a whole number", () => {
    setHidden(db, deps, "s1", [5000, 0.5], true);
    setSpeaker(db, deps, "s1", [5000], "Ms Lee");
    toggleHighlight(db, deps, "s1", [{ at: 0.5, from: 0, to: 1 }]);
    expect(lineMarks(db, "s1")).toEqual([]);
  });

  it("setting the same speaker or the same hidden state again writes nothing: no new updated_at, no dirty row, no re-index", () => {
    db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES ('grp_1', 'shared', 'owner', 1, 0)");
    db.run("INSERT INTO space_groups (space_id, group_id) VALUES ('space-1', 'grp_1')");
    setSpeaker(db, { now: () => 1 }, "s1", [0], "Ms Lee");
    const dirtyBefore = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM dirty")?.n;
    setSpeaker(db, { now: () => 2 }, "s1", [0], "Ms Lee");
    expect(db.get<{ updated_at: number }>("SELECT updated_at FROM line_marks WHERE id = 's1:0'")?.updated_at).toBe(1);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM dirty")?.n).toBe(dirtyBefore);

    setHidden(db, { now: () => 3 }, "s1", [1000], true);
    db.run("UPDATE sessions SET indexed_at = 7 WHERE id = 's1'");
    setHidden(db, { now: () => 4 }, "s1", [1000], true);
    expect(indexedAt()).toBe(7);
    expect(db.get<{ updated_at: number }>("SELECT updated_at FROM line_marks WHERE id = 's1:1000'")?.updated_at).toBe(3);
  });

  it("linesToName names the following lines up to the next named line, and speakerRun returns the run with the same name", () => {
    const lines = [
      { tStart: 0, speaker: null },
      { tStart: 1000, speaker: null },
      { tStart: 2000, speaker: "Ms Lee" },
      { tStart: 3000, speaker: null },
    ];
    expect(linesToName(lines, [0])).toEqual([0, 1000]);
    expect(speakerRun(lines, 3000)).toEqual([3000]);
    const named = [
      { tStart: 0, speaker: "Ms Lee" },
      { tStart: 1000, speaker: "Ms Lee" },
      { tStart: 2000, speaker: "Mr Park" },
    ];
    expect(speakerRun(named, 1000)).toEqual([0, 1000]);
    expect(speakerRun(named, 9999)).toEqual([9999]);
  });

  it("lineMarks reads highlights that are not valid spans as []", () => {
    // Migration 11 refuses text that is not JSON, so this is valid JSON with the wrong shape.
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, highlights, updated_at) VALUES ('s1:0', 's1', 0, 'x', '{\"bad\":true}', 1)");
    expect(lineMarks(db, "s1")[0]?.highlights).toEqual([]);
  });

  it("studyLines gives the edited text, leaves out hidden and empty lines, and ignores cloud segments", () => {
    editLine(db, deps, "s1", 0, "Cells divide in two.");
    setHidden(db, deps, "s1", [1000], true);
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, updated_at) VALUES ('s1:2000', 's1', 2000, '', 1)");
    expect(studyLines(db, "s1")).toEqual([{ tStart: 0, tEnd: 900, text: "Cells divide in two." }]);
  });
});

describe("hiding a line and the summary", () => {
  it("hiding a line clears the summary the app made, so it is made again without the line", () => {
    db.run("UPDATE sessions SET summary = 'Cells divide and mitosis has phases.', summary_auto = 1 WHERE id = 's1'");
    setHidden(db, deps, "s1", [2000], true);
    expect(db.get<{ summary: string | null }>("SELECT summary FROM sessions WHERE id = 's1'")?.summary).toBeNull();
  });

  it("clearing a line or editing its words clears a summary the app made, but not one the person typed", () => {
    const summary = () => db.get<{ summary: string | null }>("SELECT summary FROM sessions WHERE id = 's1'")?.summary;
    db.run("UPDATE sessions SET summary = 'Cells divide and mitosis has phases.', summary_auto = 1 WHERE id = 's1'");
    editLine(db, deps, "s1", 1000, "");
    expect(summary()).toBeNull();
    db.run("UPDATE sessions SET summary = 'Cells divide and mitosis has phases.', summary_auto = 1 WHERE id = 's1'");
    editLine(db, deps, "s1", 2000, "Mitosis has four stages.");
    expect(summary()).toBeNull();
    db.run("UPDATE sessions SET summary = 'My own words.', summary_auto = 0 WHERE id = 's1'");
    editLine(db, deps, "s1", 2000, "Mitosis has five stages.");
    expect(summary()).toBe("My own words.");
    editLine(db, deps, "s1", 1000, "");
    expect(summary()).toBe("My own words.");
  });

  it("hiding a line keeps a summary the person typed", () => {
    db.run("UPDATE sessions SET summary = 'My own words.', summary_auto = 0 WHERE id = 's1'");
    setHidden(db, deps, "s1", [2000], true);
    expect(db.get<{ summary: string | null }>("SELECT summary FROM sessions WHERE id = 's1'")?.summary).toBe("My own words.");
  });
});
