import { beforeEach, describe, expect, it } from "vitest";
import { findLinks, sessionLinks, sessionMedia } from "../src/core/capture/media.ts";
import { migrate } from "../src/core/db/migrate.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('space-1', 'My notes', 1, 0, 0)");
  db.run(
    "INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at, recorded_ms) VALUES ('s1', 'space-1', 'recording', 'Biology', 'saved', 'done', 0, 0)",
  );
});

function line(tStart: number, text: string): void {
  db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', ?, ?, ?, 'device')", [tStart, tStart + 1000, text]);
}

describe("findLinks", () => {
  it("finds a link with its trailing full stop removed, and shows it without the scheme", () => {
    expect(findLinks("see https://example.org/a.")).toEqual([{ url: "https://example.org/a", shown: "example.org/a", host: "example.org" }]);
  });

  it("adds https:// to a bare www address and shows the host without www", () => {
    expect(findLinks("www.example.com")).toEqual([{ url: "https://www.example.com", shown: "www.example.com", host: "example.com" }]);
  });

  it("drops a closing bracket from the address", () => {
    expect(findLinks("example.org/lesson-12)")).toEqual([{ url: "https://example.org/lesson-12", shown: "example.org/lesson-12", host: "example.org" }]);
    expect(findLinks("(https://example.org/x)")).toEqual([{ url: "https://example.org/x", shown: "example.org/x", host: "example.org" }]);
  });

  it("finds no link in an email address, plain words or numbers", () => {
    for (const text of ["me@example.org", "e.g. this", "pi is 3.14", "the end.The next", "10.30am", "a.m."]) {
      expect(findLinks(text)).toEqual([]);
    }
  });

  it("lists the same address once", () => {
    expect(findLinks("example.org and https://example.org").map((link) => link.url)).toEqual(["https://example.org"]);
  });
});

describe("sessionMedia", () => {
  it("lists pages by position with numbers from 1, then photos by time", () => {
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('ph2', 's1', 'photo', 9000, 0, 'b.jpg')");
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('ph1', 's1', 'photo', 2000, 0, 'a.jpg')");
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('p2', 's1', 'page', 0, 1, 'p2.jpg')");
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('p1', 's1', 'page', 0, 0, 'p1.jpg')");
    expect(sessionMedia(db, "s1")).toEqual([
      { id: "p1", kind: "page", file: "p1.jpg", t: 0, page: 1 },
      { id: "p2", kind: "page", file: "p2.jpg", t: 0, page: 2 },
      { id: "ph1", kind: "photo", file: "a.jpg", t: 2000, page: null },
      { id: "ph2", kind: "photo", file: "b.jpg", t: 9000, page: null },
    ]);
  });
});

describe("sessionLinks", () => {
  it("gives a page link its page number and capture id", () => {
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('p1', 's1', 'page', 0, 0, 'p1.jpg', 'Read example.org/lesson')");
    expect(sessionLinks(db, "s1")).toEqual([
      { url: "https://example.org/lesson", shown: "example.org/lesson", host: "example.org", t: null, captureId: "p1", page: 1 },
    ]);
  });

  it("gives a transcript link that line's start time, and a photo link the photo's time", () => {
    line(4000, "Go to example.org");
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('ph', 's1', 'photo', 12000, 0, 'b.jpg', 'board.example.net')");
    expect(sessionLinks(db, "s1")).toEqual([
      { url: "https://example.org", shown: "example.org", host: "example.org", t: 4000, captureId: null, page: null },
      { url: "https://board.example.net", shown: "board.example.net", host: "board.example.net", t: 12000, captureId: "ph", page: null },
    ]);
  });

  it("lists an address on a page and in the transcript once, with the page", () => {
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('p1', 's1', 'page', 0, 0, 'p1.jpg', 'example.org')");
    line(4000, "example.org again");
    expect(sessionLinks(db, "s1").map((link) => [link.url, link.page])).toEqual([["https://example.org", 1]]);
  });

  it("does not list an address on a hidden line, and lists the edited words of a shown line", () => {
    line(1000, "Hidden: example.org/secret");
    line(2000, "Shown line");
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, hidden, highlights, updated_at) VALUES ('s1:1000', 's1', 1000, NULL, 1, '[]', 1)");
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, hidden, highlights, updated_at) VALUES ('s1:2000', 's1', 2000, 'See example.net', 0, '[]', 1)");
    expect(sessionLinks(db, "s1").map((link) => link.url)).toEqual(["https://example.net"]);
  });
});
