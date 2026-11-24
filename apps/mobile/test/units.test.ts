import { beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { studyUnits } from "../src/core/study/units.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  const home = ensureDefaultSpace(db, { now: () => 1, newId: () => "space" });
  createSession(db, { now: () => 1, newId: () => "pages" }, { spaceId: home.id, kind: "pages", title: "Pages", state: "saved" });
  createSession(db, { now: () => 1, newId: () => "rec" }, { spaceId: home.id, kind: "recording", title: "Lecture", state: "saved" });
});

function addPage(id: string, position: number, text: string | null): void {
  db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES (?, 'pages', 'page', 0, ?, ?, ?)", [id, position, `${id}.jpg`, text]);
}

function addSegment(tStart: number, text: string): void {
  db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('rec', ?, ?, ?, 'device')", [tStart, tStart + 1000, text]);
}

describe("study units", () => {
  it("a pages session gives one unit per page with text, in page order, with the capture id", () => {
    addPage("p2", 1, "Second page");
    addPage("p1", 0, "First page");
    addPage("p3", 2, null);
    addPage("p4", 3, "   ");
    expect(studyUnits(db, "pages")).toEqual([
      { text: "First page", captureId: "p1", t: null },
      { text: "Second page", captureId: "p2", t: null },
    ]);
  });

  it("a recording's device segments group into units of about 1,200 characters, each with the time of its first segment", () => {
    const words = "word ".repeat(140).trim();
    addSegment(0, words);
    addSegment(5000, words);
    addSegment(9000, "Short last bit.");
    const units = studyUnits(db, "rec");
    expect(units.map((u) => [u.t, u.captureId])).toEqual([
      [0, null],
      [5000, null],
    ]);
    expect(units[0]?.text.length).toBeLessThanOrEqual(1200);
    expect(units[1]?.text).toBe(`${words} Short last bit.`);
  });

  it("text read from photos is added as its own units, with the photo's capture id and time", () => {
    addSegment(0, "Spoken words.");
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('photo-1', 'rec', 'photo', 42000, 0, 'photo.jpg', 'Board text')", []);
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('photo-2', 'rec', 'photo', 50000, 1, 'photo2.jpg', NULL)", []);
    expect(studyUnits(db, "rec")).toEqual([
      { text: "Spoken words.", captureId: null, t: 0 },
      { text: "Board text", captureId: "photo-1", t: 42000 },
    ]);
  });

  it("an empty session gives no units", () => {
    expect(studyUnits(db, "pages")).toEqual([]);
    expect(studyUnits(db, "rec")).toEqual([]);
    expect(studyUnits(db, "no-such-session")).toEqual([]);
  });

  it("pages come in page order, not id order", () => {
    addPage("a", 1, "Second page");
    addPage("b", 0, "First page");
    expect(studyUnits(db, "pages").map((u) => u.captureId)).toEqual(["b", "a"]);
  });

  it("a cloud transcript segment is not used", () => {
    addSegment(0, "Spoken words.");
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('rec', 0, 1000, 'Cloud words.', 'cloud')");
    expect(studyUnits(db, "rec").map((u) => u.text)).toEqual(["Spoken words."]);
  });
});

describe("study units with the person's edits (Next 1)", () => {
  it("an edited line's words are in the unit, and a hidden line's words are not", () => {
    addSegment(0, "Spoken words.");
    addSegment(1000, "Teacher: phones away");
    addSegment(2000, "Hidden side talk.");
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, hidden, speaker, highlights, updated_at) VALUES ('rec:0', 'rec', 0, 'Spoken words, edited.', 0, NULL, '[]', 1)");
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, hidden, speaker, highlights, updated_at) VALUES ('rec:2000', 'rec', 2000, NULL, 1, NULL, '[]', 1)");
    const text = studyUnits(db, "rec").map((u) => u.text).join(" ");
    expect(text).toContain("Spoken words, edited.");
    expect(text).toContain("Teacher: phones away");
    expect(text).not.toContain("Hidden side talk.");
    expect(text).not.toContain("Spoken words.");
  });

  it("a session with only cloud segments is studied from their text", () => {
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('cloud', 'space', 'recording', 'Cloud', 'saved', 0)");
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('cloud', 0, 1000, 'Cloud words.', 'cloud')");
    expect(studyUnits(db, "cloud").map((u) => u.text)).toEqual(["Cloud words."]);
  });
});
