import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
});

function addSpace(id = "s1", name = "Physics", isDefault = 0) {
  db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES (?, ?, ?, 1, 1)", [
    id,
    name,
    isDefault,
  ]);
}

function addSession(id = "x1", spaceId = "s1") {
  db.run(
    "INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES (?, ?, 'recording', 'Lecture', 'saved', 1)",
    [id, spaceId],
  );
}

describe("schema", () => {
  it("creates every table and index from section 5 and the card", () => {
    const names = db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'")
      .map((r) => r.name);
    for (const name of [
      "spaces", "sessions", "segments", "captures", "flags", "cards", "reviews",
      "chunks", "chunks_fts", "search_index", "settings",
      "spaces_one_default", "sessions_space", "captures_session", "cards_due",
      "chunks_session", "search_index_model",
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it("rejects a session kind other than recording or pages", () => {
    addSpace();
    expect(() =>
      db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('x', 's1', 'video', 't', 'saved', 1)"),
    ).toThrow();
  });

  it("rejects a session state of 'other'", () => {
    addSpace();
    expect(() =>
      db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('x', 's1', 'recording', 't', 'other', 1)"),
    ).toThrow();
  });

  it("rejects a transcript state of 'x'", () => {
    addSpace();
    expect(() =>
      db.run("INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at) VALUES ('x', 's1', 'recording', 't', 'saved', 'x', 1)"),
    ).toThrow();
  });

  it("rejects a segment whose t_end is before t_start", () => {
    addSpace();
    addSession();
    expect(() =>
      db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('x1', 500, 100, 'hi', 'device')"),
    ).toThrow();
  });

  it("rejects a review rating of 0", () => {
    addSpace();
    addSession();
    db.run("INSERT INTO cards (id, session_id, kind, front, back, made_by, created_at, due_at, fsrs) VALUES ('c1', 'x1', 'term', 'f', 'b', 'device_model', 1, 1, '{}')");
    expect(() =>
      db.run("INSERT INTO reviews (card_id, rating, reviewed_at, due_before, due_after) VALUES ('c1', 0, 1, 1, 1)"),
    ).toThrow();
  });

  it("rejects a review rating of 5", () => {
    addSpace();
    addSession();
    db.run("INSERT INTO cards (id, session_id, kind, front, back, made_by, created_at, due_at, fsrs) VALUES ('c1', 'x1', 'term', 'f', 'b', 'device_model', 1, 1, '{}')");
    expect(() =>
      db.run("INSERT INTO reviews (card_id, rating, reviewed_at, due_before, due_after) VALUES ('c1', 5, 1, 1, 1)"),
    ).toThrow();
  });

  it("rejects a space name of 61 characters", () => {
    expect(() => addSpace("s2", "a".repeat(61))).toThrow();
  });

  it("rejects a second default space", () => {
    addSpace("s1", "My notes", 1);
    expect(() => addSpace("s2", "Other", 1)).toThrow();
  });

  it("rejects the same segment (session, source, t_start) twice", () => {
    addSpace();
    addSession();
    const insert = "INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('x1', 0, 10, 'hi', 'device')";
    db.run(insert);
    expect(() => db.run(insert)).toThrow();
  });

  it("deleting a session removes its rows and its search rows", () => {
    addSpace();
    addSession();
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('x1', 0, 10, 'hi', 'device')");
    db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('p1', 'x1', 'page', 0, 'p1.jpg')");
    db.run("INSERT INTO flags (id, session_id, t) VALUES ('f1', 'x1', 0)");
    db.run("INSERT INTO cards (id, session_id, kind, front, back, capture_id, made_by, created_at, due_at, fsrs) VALUES ('c1', 'x1', 'term', 'f', 'b', 'p1', 'device_model', 1, 1, '{}')");
    db.run("INSERT INTO reviews (card_id, rating, reviewed_at, due_before, due_after) VALUES ('c1', 3, 1, 1, 1)");
    db.run("INSERT INTO chunks (session_id, source, t_start, t_end, text) VALUES ('x1', 'transcript', 0, 10, 'photosynthesis happens')");
    db.run("INSERT INTO search_index (chunk_id, model_version, dim, scale, vector) VALUES (1, 'v1', 2, 1.0, x'0102')");

    db.run("DELETE FROM sessions WHERE id = 'x1'");

    for (const table of ["segments", "captures", "flags", "cards", "reviews", "chunks", "search_index"]) {
      expect(db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)?.n, table).toBe(0);
    }
    expect(db.all("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'photosynthesis'")).toEqual([]);
  });

  it("deleting a capture sets the capture_id of its cards to NULL", () => {
    addSpace();
    addSession();
    db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('p1', 'x1', 'page', 0, 'p1.jpg')");
    db.run("INSERT INTO cards (id, session_id, kind, front, back, capture_id, made_by, created_at, due_at, fsrs) VALUES ('c1', 'x1', 'term', 'f', 'b', 'p1', 'device_model', 1, 1, '{}')");
    db.run("DELETE FROM captures WHERE id = 'p1'");
    expect(db.get<{ capture_id: string | null }>("SELECT capture_id FROM cards WHERE id = 'c1'")?.capture_id).toBeNull();
  });

  it("rejects a negative recorded_ms, a negative segment start and a capture kind of 'video'", () => {
    addSpace();
    expect(() =>
      db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at, recorded_ms) VALUES ('x', 's1', 'recording', 't', 'saved', 1, -1)"),
    ).toThrow();
    addSession();
    expect(() => db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('x1', -1, 10, 'hi', 'device')")).toThrow();
    expect(() => db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('v1', 'x1', 'video', 0, 'v.mov')")).toThrow();
  });

  it("rejects a card made_by other than device_model or quiz_miss, and a search vector with dim 0", () => {
    addSpace();
    addSession();
    expect(() =>
      db.run("INSERT INTO cards (id, session_id, kind, front, back, made_by, created_at, due_at, fsrs) VALUES ('c1', 'x1', 'term', 'f', 'b', 'cloud', 1, 1, '{}')"),
    ).toThrow();
    db.run("INSERT INTO chunks (session_id, source, t_start, t_end, text) VALUES ('x1', 'transcript', 0, 10, 'hello')");
    expect(() => db.run("INSERT INTO search_index (chunk_id, model_version, dim, scale, vector) VALUES (1, 'v1', 0, 1.0, x'')")).toThrow();
  });

  it("deleting a capture deletes its chunks", () => {
    addSpace();
    addSession();
    db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('p1', 'x1', 'page', 0, 'p1.jpg')");
    db.run("INSERT INTO chunks (session_id, source, capture_id, t_start, t_end, text) VALUES ('x1', 'page', 'p1', 0, 0, 'page words')");
    db.run("DELETE FROM captures WHERE id = 'p1'");
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM chunks")?.n).toBe(0);
  });

  it("a search vector comes back from the BLOB byte for byte", () => {
    addSpace();
    addSession();
    db.run("INSERT INTO chunks (session_id, source, t_start, t_end, text) VALUES ('x1', 'transcript', 0, 10, 'hello')");
    const vector = new Uint8Array([0, 1, 127, 128, 255]);
    db.run("INSERT INTO search_index (chunk_id, model_version, dim, scale, vector) VALUES (1, 'v1', 5, 0.5, ?)", [vector]);
    const row = db.get<{ vector: Uint8Array }>("SELECT vector FROM search_index WHERE chunk_id = 1");
    expect(Array.from(row?.vector ?? [])).toEqual(Array.from(vector));
  });

  it("a chunk is found by a word typed without its accent", () => {
    addSpace();
    addSession();
    db.run("INSERT INTO chunks (session_id, source, t_start, t_end, text) VALUES ('x1', 'transcript', 0, 10, 'Café au lait')");
    const hits = db.all<{ rowid: number }>("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'cafe'");
    expect(hits.map((h) => h.rowid)).toEqual([1]);
  });

  it("creates line_marks, notes and notes_session (Next 1)", () => {
    const names = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["line_marks", "notes", "notes_session"]));
  });

  it("refuses a line mark with hidden = 2, and a second mark for the same line", () => {
    addSpace();
    addSession();
    expect(() => db.run("INSERT INTO line_marks (id, session_id, t_start, hidden, updated_at) VALUES ('x1:0', 'x1', 0, 2, 1)")).toThrow();
    db.run("INSERT INTO line_marks (id, session_id, t_start, updated_at) VALUES ('x1:0', 'x1', 0, 1)");
    expect(() => db.run("INSERT INTO line_marks (id, session_id, t_start, updated_at) VALUES ('x1:0b', 'x1', 0, 1)")).toThrow();
  });

  it("refuses a note with empty text", () => {
    addSpace();
    addSession();
    expect(() => db.run("INSERT INTO notes (id, session_id, t, text, created_at) VALUES ('n1', 'x1', 0, '', 1)")).toThrow();
  });

  it("deleting a session deletes its line marks and notes", () => {
    addSpace();
    addSession();
    db.run("INSERT INTO line_marks (id, session_id, t_start, updated_at) VALUES ('x1:0', 'x1', 0, 1)");
    db.run("INSERT INTO notes (id, session_id, t, text, created_at) VALUES ('n1', 'x1', 0, 'check', 1)");
    db.run("DELETE FROM sessions WHERE id = 'x1'");
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM line_marks")?.n).toBe(0);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM notes")?.n).toBe(0);
  });
});
