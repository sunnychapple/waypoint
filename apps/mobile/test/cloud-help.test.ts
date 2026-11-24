import { JOB_PROBLEM_MAX_CHARS, JOB_TEXT_MAX_CHARS } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { createSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { cloudHelpDraft, cloudHelpRequest, getCloudHelp, helpWhere, saveCloudHelp } from "../src/core/study/cloudHelp.ts";
import { createMemoryDb } from "./helpers/db.ts";

const STEP = { step: "Read what the question asks.", why: "The goal tells you which facts matter." };
const READABLE = { v: 1, readable: true, steps: [STEP, { step: "Use the facts given.", why: "Nothing else is needed." }], answer: "The answer." };
const UNREADABLE = { v: 1, readable: false, reason: "The question is cut off." };

function setup() {
  const db = createMemoryDb();
  migrate(db);
  const space = ensureDefaultSpace(db, { now: () => 1, newId: () => "space" });
  createSession(db, { now: () => 1, newId: () => "s1" }, { spaceId: space.id, kind: "pages", title: "Worksheet", state: "saved" });
  db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('p1', 's1', 'page', 0, 0, 'p1.jpg', 'Exercise 4.')");
  return db;
}

const job = (detail: object) => ({ id: "job1", sessionId: "s1", detail: JSON.stringify(detail) });

describe("cloudHelpRequest", () => {
  it("sends the problem and its page text, trimmed", () => {
    expect(cloudHelpRequest({ text: " Exercise 4. ", context: " Page. Exercise 4. More. " })).toEqual({
      type: "problem_help",
      problem: "Exercise 4.",
      text: "Page. Exercise 4. More.",
    });
  });

  it("cuts each part to the server's cap", () => {
    const request = cloudHelpRequest({ text: "a".repeat(JOB_PROBLEM_MAX_CHARS + 10), context: "b".repeat(JOB_TEXT_MAX_CHARS.problem_help + 10) });
    expect(request.problem).toHaveLength(JOB_PROBLEM_MAX_CHARS);
    expect(request.text).toHaveLength(JOB_TEXT_MAX_CHARS.problem_help);
  });
});

describe("helpWhere", () => {
  it("reads the page, the block and the problem", () => {
    expect(helpWhere(JSON.stringify({ captureId: "p1", block: 2, problem: "Exercise 4." }))).toEqual({ captureId: "p1", block: 2, problem: "Exercise 4." });
  });

  it("a typed problem has block null; a bad block becomes null", () => {
    expect(helpWhere(JSON.stringify({ captureId: "p1", block: null, problem: "Typed" }))?.block).toBeNull();
    expect(helpWhere(JSON.stringify({ captureId: "p1", block: -1, problem: "Typed" }))?.block).toBeNull();
  });

  it("is null for bad JSON, no page or no problem", () => {
    expect(helpWhere("{")).toBeNull();
    expect(helpWhere(JSON.stringify({ problem: "x" }))).toBeNull();
    expect(helpWhere(JSON.stringify({ captureId: "p1" }))).toBeNull();
  });
});

describe("saving and reading cloud help", () => {
  it("saves a readable result with its page and problem, and reads it back", () => {
    const db = setup();
    saveCloudHelp(db, job({ captureId: "p1", block: 0, problem: "Exercise 4." }), JSON.stringify(READABLE), 50);
    expect(getCloudHelp(db, "job1")).toEqual({ id: "job1", sessionId: "s1", captureId: "p1", problem: "Exercise 4.", result: READABLE, createdAt: 50 });
  });

  it("saves an unreadable result", () => {
    const db = setup();
    saveCloudHelp(db, job({ captureId: "p1", block: 0, problem: "Exercise 4." }), JSON.stringify(UNREADABLE), 50);
    expect(getCloudHelp(db, "job1")?.result).toEqual(UNREADABLE);
  });

  it("keeps the answer without its page when the page is gone", () => {
    const db = setup();
    saveCloudHelp(db, job({ captureId: "gone", block: 0, problem: "Exercise 4." }), JSON.stringify(READABLE), 50);
    expect(getCloudHelp(db, "job1")?.captureId).toBeNull();
  });

  it("throws for a result that is not the contract, and saves nothing", () => {
    const db = setup();
    expect(() => saveCloudHelp(db, job({ captureId: "p1", block: 0, problem: "x" }), JSON.stringify({ v: 1, readable: true, steps: [] }), 50)).toThrow();
    expect(() => saveCloudHelp(db, job({ captureId: "p1", block: 0, problem: "x" }), "not json", 50)).toThrow();
    expect(getCloudHelp(db, "job1")).toBeNull();
  });

  it("deleting the session deletes its answers", () => {
    const db = setup();
    saveCloudHelp(db, job({ captureId: "p1", block: 0, problem: "Exercise 4." }), JSON.stringify(READABLE), 50);
    db.run("DELETE FROM sessions WHERE id = 's1'");
    expect(getCloudHelp(db, "job1")).toBeNull();
  });
});

describe("cloudHelpDraft", () => {
  it("turns each step into a title with its why as the detail", () => {
    expect(cloudHelpDraft({ v: 1, readable: true, steps: [STEP], answer: "The answer." })).toEqual({
      steps: [{ title: STEP.step, detail: STEP.why }],
      answer: "The answer.",
    });
  });

  it("is null when the cloud could not read the problem", () => {
    expect(cloudHelpDraft({ v: 1, readable: false, reason: "Too blurry." })).toBeNull();
  });
});
