import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { addToThread, getExplanation, saveExplanation, shownAnswer, startExplanation, unsaveExplanation, verdictOf, type ThreadItem } from "../src/core/explain/explanations.ts";
import { TASK_LABELS, sentFields } from "../src/core/explain/sent.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1_000, newId: () => `id_${++n}` };
  const space = ensureDefaultSpace(db, deps);
  db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('s1', ?, 'recording', 'Bio', 'saved', 0)", [space.id]);
  return { db, deps };
}
const item = (kind: ThreadItem["kind"], text: string): ThreadItem => ({ kind, text, at: 1, retention: "standard", sentId: `k_${text}` });

describe("thread", () => {
  it("save adds one term with the first answer; unsave removes it", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "osmosis");
    expect(() => saveExplanation(db, deps, e.id)).toThrow("nothing to save yet");
    addToThread(db, e.id, item("explain", "first"));
    addToThread(db, e.id, item("more_detail", "more"));
    saveExplanation(db, deps, e.id);
    saveExplanation(db, deps, e.id);
    expect(getExplanation(db, e.id)?.saved).toBe(true);
    expect(db.all("SELECT term, meaning FROM terms")).toEqual([{ term: "osmosis", meaning: "first" }]);
    unsaveExplanation(db, e.id);
    expect(getExplanation(db, e.id)?.saved).toBe(false);
    expect(db.all("SELECT * FROM terms")).toEqual([]);
  });
  it("shownAnswer is the latest explain item", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "x");
    expect(shownAnswer(e)).toBeNull();
    addToThread(db, e.id, item("explain", "a"));
    addToThread(db, e.id, item("double_check", "Correct"));
    const after = addToThread(db, e.id, item("explain", "b"));
    expect(shownAnswer(after)).toBe("b");
  });
  it("verdictOf", () => {
    expect(verdictOf("Correct\nIt is right.")).toBe("correct");
    expect(verdictOf("Partly correct.\nBut…")).toBe("partly");
    expect(verdictOf("**Not correct**\n...")).toBe("not");
    expect(verdictOf("Maybe")).toBeNull();
    expect(verdictOf("")).toBeNull();
  });
});

describe("sent", () => {
  it("sentFields labels known fields and keeps unknown ones", () => {
    expect(sentFields(JSON.stringify({ word: "w", transcript: "t", answer: "a" }))).toEqual([
      { label: "Word", text: "w" },
      { label: "Transcript", text: "t" },
      { label: "Explanation", text: "a" },
    ]);
    expect(sentFields(JSON.stringify({ minutes: 4 }))).toEqual([{ label: "minutes", text: "4" }]);
    expect(sentFields("not json")).toEqual([{ label: "Sent", text: "not json" }]);
    expect(sentFields("[1]")).toEqual([{ label: "Sent", text: "[1]" }]);
  });
  it("every task has a label", () => {
    expect(Object.keys(TASK_LABELS)).toHaveLength(11);
  });
});
