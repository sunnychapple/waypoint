import { PracticeSetResultSchema } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { startRecordingSession } from "../src/core/capture/recording.ts";
import { deleteSessionRow } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { getMade, madeForSession, saveMade } from "../src/core/made/made.ts";
import { answerKey, grade, score } from "../src/core/made/practice.ts";
import { createMemoryDb } from "./helpers/db.ts";

const PRACTICE = {
  v: 1,
  title: "Cells",
  questions: [
    { kind: "multiple_choice", prompt: "Powerhouse?", choices: ["Nucleus", "Mitochondria"], answer: 1, explanation: "It makes ATP." },
    { kind: "short_answer", prompt: "Unit of life?", answer: "The cell", explanation: "Everything is made of cells." },
    { kind: "short_answer", prompt: "Pi to 2 places?", answer: "3.14", explanation: "Pi." },
  ],
};

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1000, newId: () => `id_${++n}` };
  return { db, session: startRecordingSession(db, deps, ensureDefaultSpace(db, deps).id, true) };
}

describe("made", () => {
  it("saves a practice set and reads it back by session", () => {
    const { db, session } = setup();
    saveMade(db, "practice", { id: "job_1", sessionId: session.id }, JSON.stringify(PRACTICE), 5);
    const item = getMade(db, "job_1");
    expect(item?.kind).toBe("practice");
    expect(item?.title).toBe("Cells");
    expect(madeForSession(db, session.id)).toHaveLength(1);
  });
  it("a result that is not its contract throws; another kind's contract too", () => {
    const { db } = setup();
    expect(() => saveMade(db, "diagram", { id: "job_2", sessionId: null }, JSON.stringify(PRACTICE), 5)).toThrow();
    expect(getMade(db, "job_2")).toBeNull();
  });
  it("a stored row that no longer fits its contract is left out", () => {
    const { db, session } = setup();
    db.run("INSERT INTO made (id, session_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["bad_1", session.id, "practice", "Old", '{"v":1}', 5]);
    expect(getMade(db, "bad_1")).toBeNull();
    expect(madeForSession(db, session.id)).toEqual([]);
  });
  it("lists a session's items newest first", () => {
    const { db, session } = setup();
    saveMade(db, "practice", { id: "job_old", sessionId: session.id }, JSON.stringify(PRACTICE), 5);
    saveMade(db, "practice", { id: "job_new", sessionId: session.id }, JSON.stringify(PRACTICE), 9);
    expect(madeForSession(db, session.id).map((m) => m.id)).toEqual(["job_new", "job_old"]);
  });
  it("deleting the session deletes its items", () => {
    const { db, session } = setup();
    saveMade(db, "practice", { id: "job_1", sessionId: session.id }, JSON.stringify(PRACTICE), 5);
    deleteSessionRow(db, session.id);
    expect(getMade(db, "job_1")).toBeNull();
  });
});

describe("practice grading", () => {
  const set = PracticeSetResultSchema.parse(PRACTICE);
  const mc = set.questions[0]!;
  const short = set.questions[1]!;
  const pi = set.questions[2]!;
  it("multiple choice by index; short answers by key", () => {
    expect(grade(mc, 1)).toBe("right");
    expect(grade(mc, 0)).toBe("wrong");
    expect(grade(short, " cell! ")).toBe("right");
    expect(grade(short, "a cell")).toBe("right");
    expect(grade(short, "cells")).toBe("check");
    expect(grade(short, "  ")).toBe("wrong");
    expect(grade(pi, "3.14")).toBe("right");
    expect(score(["right", "check", "wrong"])).toEqual({ right: 1, total: 3 });
  });
  it("answerKey", () => {
    expect(answerKey("The Mitochondria.")).toBe("mitochondria");
    expect(answerKey("well-known")).toBe("well known");
    expect(answerKey("Pi is 3.14.")).toBe("pi is 3.14");
  });
});
