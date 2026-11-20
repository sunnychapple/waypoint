import { describe, expect, it } from "vitest";
import { savePart, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { getResearch, notesForResearch, researchForSession, saveResearch } from "../src/core/research/research.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1000, newId: () => `id_${++n}` };
  const session = startRecordingSession(db, deps, ensureDefaultSpace(db, deps).id, true);
  return { db, session };
}
const RESULT = JSON.stringify({ v: 1, answer: "Cells divide [1].", sources: [{ n: 1, url: "https://a.test", title: "A" }] });

describe("research", () => {
  it("saves and reads a result with its question", () => {
    const { db, session } = setup();
    saveResearch(db, { id: "job_1", sessionId: session.id, detail: '{"question":"Why?","depth":"deep"}' }, RESULT, 5);
    expect(getResearch(db, "job_1")).toEqual({ id: "job_1", sessionId: session.id, question: "Why?", depth: "deep", answer: "Cells divide [1].", sources: [{ n: 1, url: "https://a.test", title: "A" }], createdAt: 5 });
    expect(researchForSession(db, session.id)).toHaveLength(1);
  });
  it("a result that is not the contract throws, and nothing is saved", () => {
    const { db } = setup();
    expect(() => saveResearch(db, { id: "job_2", sessionId: null, detail: "{}" }, '{"v":1}', 5)).toThrow();
    expect(getResearch(db, "job_2")).toBeNull();
  });
  it("deleting the session deletes its research", () => {
    const { db, session } = setup();
    saveResearch(db, { id: "job_1", sessionId: session.id, detail: "{}" }, RESULT, 5);
    db.run("DELETE FROM sessions WHERE id = ?", [session.id]);
    expect(getResearch(db, "job_1")).toBeNull();
  });
  it("notesForResearch: transcript then pages, cut at a word", () => {
    const { db, session } = setup();
    saveSegment(db, session.id, { tStart: 0, tEnd: 1, text: "alpha beta" });
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('c1', ?, 'page', 0, 0, 'p.jpg', 'gamma delta')", [session.id]);
    expect(notesForResearch(db, session.id)).toBe("alpha beta gamma delta");
    expect(notesForResearch(db, session.id, 13)).toBe("alpha beta");
  });
});
