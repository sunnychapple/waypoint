import { describe, expect, it } from "vitest";
import { createSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { HelpDraft } from "../src/core/study/drafts.ts";
import { pagesWithLines, problemContext, problemOf, showAnswer, showNextStep, startHelp, typedProblemOf } from "../src/core/study/help.ts";
import type { Block } from "../src/core/pages/blocks.ts";
import { createMemoryDb } from "./helpers/db.ts";

const block = (text: string): Block => ({ text, x: 0, y: 0, width: 1, height: 0.1, lines: 1 });
const draft: HelpDraft = {
  steps: [
    { title: "Set up", detail: "Write the equation." },
    { title: "Solve", detail: "Divide both sides by 3." },
  ],
  answer: "x = 2",
};

describe("problemContext", () => {
  it("keeps a short page as it is, with whitespace collapsed", () => {
    const page = "Worksheet\n\n1. Solve 3x = 6.\n2. Sketch a graph.";
    expect(problemContext(page, block("1. Solve 3x = 6."))).toBe("Worksheet 1. Solve 3x = 6. 2. Sketch a graph.");
  });

  it("keeps the problem whole and fits a long page to the limit", () => {
    const page = `${"Intro words. ".repeat(40)}1. Solve 3x = 6. ${"Closing words. ".repeat(40)}`;
    const out = problemContext(page, block("1. Solve 3x = 6."), 120);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain("1. Solve 3x = 6.");
  });

  it("returns the problem alone when it is not on the page", () => {
    expect(problemContext("Worksheet", block("1. Solve 3x = 6."))).toBe("1. Solve 3x = 6.");
  });
});

describe("help steps", () => {
  it("starts with step 1 shown and no answer", () => {
    expect(startHelp(draft)).toEqual({ steps: draft.steps, answer: "x = 2", shown: 1, answerShown: false });
  });

  it("the answer cannot be shown before every step", () => {
    const state = startHelp(draft);
    expect(showAnswer(state)).toBe(state);
  });

  it("next step stops at the last step", () => {
    const state = showNextStep(showNextStep(showNextStep(startHelp(draft))));
    expect(state.shown).toBe(2);
    expect(showAnswer(state).answerShown).toBe(true);
  });
});

describe("pages and problems from the database", () => {
  const line = (text: string, y: number) => ({ text, x: 0.1, y, width: 0.5, height: 0.04 });
  function setup() {
    const db = createMemoryDb();
    migrate(db);
    const space = ensureDefaultSpace(db, { now: () => 1, newId: () => "space" });
    createSession(db, { now: () => 1, newId: () => "s1" }, { spaceId: space.id, kind: "pages", title: "Worksheet", state: "saved" });
    const add = (id: string, position: number, text: string | null, lines: object[] | null) =>
      db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text, found_lines) VALUES (?, 's1', 'page', 0, ?, ?, ?, ?)", [
        id, position, `${id}.jpg`, text, lines === null ? null : JSON.stringify(lines),
      ]);
    add("p2", 1, "1. Solve 3x = 6.\n2. Solve 2x = 8.", [line("1. Solve 3x = 6.", 0.1), line("2. Solve 2x = 8.", 0.2)]);
    add("p1", 0, null, null);
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('ph', 's1', 'photo', 0, 0, 'ph.jpg')");
    return db;
  }

  it("pagesWithLines lists only the session's pages, in page order", () => {
    expect(pagesWithLines(setup(), "s1").map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("problemOf returns the block at the index with its page as context", () => {
    expect(problemOf(setup(), "p2", 1)).toEqual({ text: "2. Solve 2x = 8.", context: "1. Solve 3x = 6. 2. Solve 2x = 8." });
  });

  it("problemOf is null for a page with no text, an index past the last block, or a photo", () => {
    const db = setup();
    expect(problemOf(db, "p1", 0)).toBeNull();
    expect(problemOf(db, "p2", 2)).toBeNull();
    expect(problemOf(db, "ph", 0)).toBeNull();
  });
});

describe("a problem typed in by the student", () => {
  function setup(found: string | null) {
    const db = createMemoryDb();
    migrate(db);
    const space = ensureDefaultSpace(db, { now: () => 1, newId: () => "space" });
    createSession(db, { now: () => 1, newId: () => "s1" }, { spaceId: space.id, kind: "pages", title: "Worksheet", state: "saved" });
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('p1', 's1', 'page', 0, 0, 'p1.jpg', ?)", [found]);
    return db;
  }

  it("uses the typed text as the problem, with the page text as context", () => {
    const db = setup("Worksheet\n\nSolve 3x = 6.");
    expect(typedProblemOf(db, "p1", "  Solve\n 3x = 6.  ")).toEqual({ text: "Solve 3x = 6.", context: "Worksheet Solve 3x = 6." });
  });

  it("with no text on the page, the context is the typed problem alone", () => {
    expect(typedProblemOf(setup(""), "p1", "What is 2 + 2?")).toEqual({ text: "What is 2 + 2?", context: "What is 2 + 2?" });
  });

  it("is null for blank text or a page that is not there", () => {
    const db = setup("Worksheet");
    expect(typedProblemOf(db, "p1", "   ")).toBeNull();
    expect(typedProblemOf(db, "missing", "Solve 3x = 6.")).toBeNull();
  });
});
