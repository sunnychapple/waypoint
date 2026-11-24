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
  it("finds a link with its trailing full stop removed", () => {
    expect(findLinks("see https://example.org/a.")).toEqual([{ url: "https://example.org/a", host: "example.org" }]);
  });

  it("finds a www address and shows its host name", () => {
    expect(findLinks("www.example.com")).toEqual([{ url: "https://www.example.com/", host: "www.example.com" }]);
  });

  it("drops a closing bracket that has no opening one", () => {
    expect(findLinks("(https://example.org/x)")).toEqual([{ url: "https://example.org/x", host: "example.org" }]);
    expect(findLinks("https://example.org/lesson-12)")).toEqual([{ url: "https://example.org/lesson-12", host: "example.org" }]);
  });

  it("keeps a closing bracket that is balanced by one in the address", () => {
    expect(findLinks("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
      { url: "https://en.wikipedia.org/wiki/Foo_(bar)", host: "en.wikipedia.org" },
    ]);
  });

  it("strips trailing Japanese and ellipsis punctuation", () => {
    expect(findLinks("https://example.org/a。")).toEqual([{ url: "https://example.org/a", host: "example.org" }]);
    expect(findLinks("https://example.org/b、")).toEqual([{ url: "https://example.org/b", host: "example.org" }]);
    expect(findLinks("https://example.org/c…")).toEqual([{ url: "https://example.org/c", host: "example.org" }]);
  });

  it("finds an upper-case scheme", () => {
    expect(findLinks("HTTPS://X.COM")).toEqual([{ url: "https://x.com/", host: "x.com" }]);
  });

  it("shows the host of an address with user information, not the part before the @", () => {
    expect(findLinks("https://google.com@evil.com")).toEqual([{ url: "https://google.com@evil.com/", host: "evil.com" }]);
  });

  it("shows a non-ASCII host as punycode", () => {
    expect(findLinks("https://ex\u0430mple.com/login")).toEqual([{ url: "https://xn--exmple-4nf.com/login", host: "xn--exmple-4nf.com" }]);
  });

  it("does not treat a bare domain, a file name or a plain word as a link", () => {
    for (const text of ["index.html", "main.py", "example.org", "me@example.org", "e.g. this", "pi is 3.14", "10.30am", "a.m.", "ftp://example.org"]) {
      expect(findLinks(text)).toEqual([]);
    }
  });

  it("drops an address over 2000 characters and keeps one of exactly 2000", () => {
    expect(findLinks(`https://x.org/${"a".repeat(2000 - 14)}`)).toHaveLength(1);
    expect(findLinks(`https://x.org/${"a".repeat(2000 - 13)}`)).toEqual([]);
  });

  it("lists the same address once, whatever its case or a trailing slash", () => {
    expect(findLinks("https://example.org and https://EXAMPLE.org/ and https://example.org").map((link) => link.url)).toEqual([
      "https://example.org/",
    ]);
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
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('p1', 's1', 'page', 0, 0, 'p1.jpg', 'Read https://example.org/lesson')");
    expect(sessionLinks(db, "s1")).toEqual([
      { url: "https://example.org/lesson", host: "example.org", t: null, captureId: "p1", page: 1 },
    ]);
  });

  it("gives a transcript link that line's start time, and a photo link the photo's time", () => {
    line(4000, "Go to https://example.org");
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('ph', 's1', 'photo', 12000, 0, 'b.jpg', 'https://board.example.net')");
    expect(sessionLinks(db, "s1")).toEqual([
      { url: "https://example.org/", host: "example.org", t: 4000, captureId: null, page: null },
      { url: "https://board.example.net/", host: "board.example.net", t: 12000, captureId: "ph", page: null },
    ]);
  });

  it("lists an address on a page and in the transcript once, with the page", () => {
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES ('p1', 's1', 'page', 0, 0, 'p1.jpg', 'https://example.org')");
    line(4000, "https://example.org again");
    expect(sessionLinks(db, "s1").map((link) => [link.url, link.page])).toEqual([["https://example.org/", 1]]);
  });

  it("does not list an address on a hidden line, and lists the edited words of a shown line", () => {
    line(1000, "Hidden: https://example.org/secret");
    line(2000, "Shown line");
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, hidden, highlights, updated_at) VALUES ('s1:1000', 's1', 1000, NULL, 1, '[]', 1)");
    db.run("INSERT INTO line_marks (id, session_id, t_start, text, hidden, highlights, updated_at) VALUES ('s1:2000', 's1', 2000, 'See https://example.net', 0, '[]', 1)");
    expect(sessionLinks(db, "s1").map((link) => link.url)).toEqual(["https://example.net/"]);
  });
});
