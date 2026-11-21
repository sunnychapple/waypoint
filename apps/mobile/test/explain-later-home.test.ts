import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { countSavedExplanations, addToThread, getExplanation, saveExplanation, saveExplanationNow, startExplanation, type ThreadItem } from "../src/core/explain/explanations.ts";
import { lineAt, type SegmentLine } from "../src/core/capture/segments.ts";
import { countOpenFlags, markAnswered, openFlags, phraseForFlag } from "../src/core/explain/later.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1_000, newId: () => `id_${++n}` };
  const space = ensureDefaultSpace(db, deps);
  db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('s1', ?, 'recording', 'Bio', 'saved', 0)", [space.id]);
  db.run("INSERT INTO flags (id, session_id, t, question) VALUES ('f1', 's1', 42000, 'What does \"osmosis\" mean?')", []);
  return { db, deps };
}
const item = (kind: ThreadItem["kind"], text: string): ThreadItem => ({ kind, text, at: 1, retention: "standard", sentId: `k_${text}` });

describe("saved answers on Home", () => {
  it("counts only saved explanations", () => {
    const { db, deps } = setup();
    expect(countSavedExplanations(db)).toBe(0);
    const a = startExplanation(db, deps, "s1", 0, "osmosis");
    addToThread(db, a.id, item("explain", "water moves"));
    expect(countSavedExplanations(db)).toBe(0);
    saveExplanation(db, deps, a.id);
    expect(countSavedExplanations(db)).toBe(1);
  });
});

describe("answer from a flag is saved with the flag marked answered", () => {
  it("save after the first answer keeps the thread and the term", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 42000, "osmosis");
    const updated = addToThread(db, e.id, item("explain", "water moves across a membrane"));
    markAnswered(db, "f1");
    saveExplanation(db, deps, e.id);
    expect(countOpenFlags(db)).toBe(0);
    expect(getExplanation(db, e.id)).toMatchObject({ saved: true, thread: updated.thread });
    expect(db.all("SELECT term, meaning FROM terms")).toEqual([{ term: "osmosis", meaning: "water moves across a membrane" }]);
  });
  it("a saved thread keeps accepting follow-ups in the same explanation", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "osmosis");
    addToThread(db, e.id, item("explain", "first"));
    saveExplanation(db, deps, e.id);
    addToThread(db, e.id, item("more_detail", "more"));
    const loaded = getExplanation(db, e.id);
    expect(loaded?.saved).toBe(true);
    expect(loaded?.thread.map((i) => i.kind)).toEqual(["explain", "more_detail"]);
  });
});

describe("saveExplanationNow", () => {
  it("rolls back the thread item, the answered flag and the save together", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "osmosis");
    expect(() =>
      db.transaction(() => {
        addToThread(db, e.id, item("more_detail", "x"));
        markAnswered(db, "f1");
        saveExplanationNow(db, deps, e.id); // no explain item yet: throws
      }),
    ).toThrow("nothing to save yet");
    expect(getExplanation(db, e.id)?.thread).toEqual([]);
    expect(countOpenFlags(db)).toBe(1);
  });
});

describe("Get the answer for a flag with no word", () => {
  const addLine = (db: ReturnType<typeof setup>["db"], tStart: number, tEnd: number, text: string, source = "device") =>
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', ?, ?, ?, ?)", [tStart, tEnd, text, source]);
  const plainFlag = (db: ReturnType<typeof setup>["db"], t: number) => {
    db.run("INSERT INTO flags (id, session_id, t, question) VALUES ('plain', 's1', ?, '')", [t]);
    return openFlags(db).find((f) => f.id === "plain")!;
  };

  it("uses the transcript line at the flag's time, collapsed", () => {
    const { db } = setup();
    addLine(db, 40_000, 44_000, "Osmosis  moves water\nacross a membrane");
    expect(phraseForFlag(db, plainFlag(db, 42_000))).toBe("Osmosis moves water across a membrane");
  });
  it("a moment at the end of a line still finds it", () => {
    const { db } = setup();
    addLine(db, 40_000, 44_000, "end of line");
    expect(phraseForFlag(db, plainFlag(db, 44_000))).toBe("end of line");
  });
  it("null when no transcript line covers the time (still being transcribed)", () => {
    const { db } = setup();
    addLine(db, 0, 10_000, "earlier");
    expect(phraseForFlag(db, plainFlag(db, 42_000))).toBeNull();
  });
  it("null when the only line at that time is empty", () => {
    const { db } = setup();
    addLine(db, 40_000, 44_000, "   ");
    expect(phraseForFlag(db, plainFlag(db, 42_000))).toBeNull();
  });
  it("ignores cloud lines", () => {
    const { db } = setup();
    addLine(db, 40_000, 44_000, "cloud only", "cloud");
    expect(phraseForFlag(db, plainFlag(db, 42_000))).toBeNull();
  });
  it("cuts a long line to the 100-character word limit", () => {
    const { db } = setup();
    addLine(db, 40_000, 44_000, "a".repeat(150));
    expect(phraseForFlag(db, plainFlag(db, 42_000))).toBe("a".repeat(100));
  });
});

describe("lineAt", () => {
  const lines: SegmentLine[] = [
    { tStart: 0, tEnd: 1_000, text: "one" },
    { tStart: 2_000, tEnd: 3_000, text: "   " },
    { tStart: 3_000, tEnd: 4_000, text: "two" },
  ];
  it("finds the line containing t, skipping blank lines", () => {
    expect(lineAt(lines, 500)?.text).toBe("one");
    expect(lineAt(lines, 3_000)?.text).toBe("two");
  });
  it("null in a gap or past the end", () => {
    expect(lineAt(lines, 1_500)).toBeNull();
    expect(lineAt(lines, 2_500)).toBeNull();
    expect(lineAt([], 0)).toBeNull();
  });
});
