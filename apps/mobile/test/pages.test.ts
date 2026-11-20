import { beforeEach, describe, expect, it } from "vitest";
import {
  addPages,
  listPages,
  movePage,
  pagesToRead,
  removePage,
  setPageText,
  startPagesSession,
  titleFromText,
  wordCount,
} from "../src/core/capture/pages.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;
let ids: number;
let spaceId: string;
const deps = () => ({ now: () => 1000, newId: () => `id-${++ids}` });

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  ids = 0;
  spaceId = ensureDefaultSpace(db, deps()).id;
});

function newSession(): string {
  return startPagesSession(db, deps(), spaceId, "Pages").id;
}

function positionsOf(sessionId: string): { file: string; position: number }[] {
  return listPages(db, sessionId).map((p) => ({ file: p.file, position: p.position }));
}

describe("pages", () => {
  it("keeps positions 0..n-1 in the right order after add, remove and move", () => {
    const session = newSession();
    const first = addPages(db, deps(), session, ["a.jpg", "b.jpg", "c.jpg"]);
    expect(positionsOf(session)).toEqual([
      { file: "a.jpg", position: 0 },
      { file: "b.jpg", position: 1 },
      { file: "c.jpg", position: 2 },
    ]);

    addPages(db, deps(), session, ["d.jpg"]);
    expect(positionsOf(session).map((p) => p.position)).toEqual([0, 1, 2, 3]);

    removePage(db, first[1] ?? "");
    expect(positionsOf(session)).toEqual([
      { file: "a.jpg", position: 0 },
      { file: "c.jpg", position: 1 },
      { file: "d.jpg", position: 2 },
    ]);

    movePage(db, first[2] ?? "", 0);
    expect(positionsOf(session)).toEqual([
      { file: "c.jpg", position: 0 },
      { file: "a.jpg", position: 1 },
      { file: "d.jpg", position: 2 },
    ]);
  });

  it("removePage returns the file of the removed page", () => {
    const session = newSession();
    const [captureId] = addPages(db, deps(), session, ["sessions/x/page-1.jpg"]);
    expect(removePage(db, captureId ?? "")).toBe("sessions/x/page-1.jpg");
    expect(listPages(db, session)).toEqual([]);
  });

  it("setPageText clears indexed_at on the session", () => {
    const session = newSession();
    const [captureId] = addPages(db, deps(), session, ["a.jpg"]);
    db.run("UPDATE sessions SET indexed_at = 500 WHERE id = ?", [session]);
    setPageText(db, captureId ?? "", "Practice 7.3", "[]");
    expect(db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = ?", [session])?.indexed_at).toBeNull();
    expect(listPages(db, session)[0]?.foundText).toBe("Practice 7.3");
  });

  it("pagesToRead returns unread pages oldest first, up to the limit, and never picks an empty text again", () => {
    const session = newSession();
    const [a, b] = addPages(db, deps(), session, ["a.jpg", "b.jpg", "c.jpg"]);
    setPageText(db, b ?? "", "", "[]");
    expect(pagesToRead(db, 10).map((p) => p.file)).toEqual(["a.jpg", "c.jpg"]);
    expect(pagesToRead(db, 1).map((p) => p.file)).toEqual(["a.jpg"]);
    setPageText(db, a ?? "", "text", "[]");
    expect(pagesToRead(db, 10).map((p) => p.file)).toEqual(["c.jpg"]);
  });

  it("wordCount counts the words in the texts that exist", () => {
    expect(wordCount(["one two  three", null, "", "four\nfive"])).toBe(5);
    expect(wordCount([])).toBe(0);
  });

  it("titleFromText takes the first line with three letters, cuts long lines at a word, and falls back", () => {
    expect(titleFromText("Practice 7.3 · Solve for x\n1. 3x + 7 = 22", "Pages")).toBe("Practice 7.3 · Solve for x");
    expect(titleFromText("12\nAlgebra review\nmore", "Pages")).toBe("Algebra review");
    const long = `${"word ".repeat(30)}end`;
    const cut = titleFromText(long, "Pages");
    expect(cut.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(`${cut} `)).toBe(true);
    expect(titleFromText(null, "Pages")).toBe("Pages");
  });

  it("titleFromText keeps a word that ends exactly at the 60th character, and cuts inside a word at the space before it", () => {
    expect(titleFromText(`${"a".repeat(55)} bbbb dd ee`, "Pages")).toBe(`${"a".repeat(55)} bbbb`);
    expect(titleFromText(`${"a".repeat(55)} bbbbbbbb`, "Pages")).toBe("a".repeat(55));
  });

  it("pagesToRead also returns photos taken during a recording", () => {
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('rec', ?, 'recording', 'Lecture', 'saved', 1)", [spaceId]);
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('ph', 'rec', 'photo', 5000, 0, 'board.jpg')");
    expect(pagesToRead(db, 10).map((p) => p.file)).toEqual(["board.jpg"]);
  });

  it("movePage clamps a position below 0 (here -1) to the first place and one past the end to the last", () => {
    const session = newSession();
    const [a, , c] = addPages(db, deps(), session, ["a.jpg", "b.jpg", "c.jpg"]);
    movePage(db, c ?? "", -1);
    expect(positionsOf(session).map((p) => p.file)).toEqual(["c.jpg", "a.jpg", "b.jpg"]);
    movePage(db, c ?? "", 99);
    expect(positionsOf(session).map((p) => p.file)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    movePage(db, a ?? "", 99);
    expect(positionsOf(session).map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it("titleFromText skips a line with only two letters, and cuts a 61-character word to 60", () => {
    expect(titleFromText("ab 12\nAbc def", "Pages")).toBe("Abc def");
    expect(titleFromText("x".repeat(61), "Pages")).toBe("x".repeat(60));
    expect(titleFromText("x".repeat(60), "Pages")).toBe("x".repeat(60));
  });
});
