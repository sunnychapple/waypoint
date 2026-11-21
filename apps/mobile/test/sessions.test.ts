import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { createSpace, ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import {
  createSession,
  deleteSessionRow,
  getSession,
  latestSession,
  moveSession,
  recentSessions,
  renameSession,
  sessionsInSpace,
} from "../src/core/capture/sessions.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;
let ids: number;
const deps = (now = 1000) => ({ now: () => now, newId: () => `id-${++ids}` });

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  ids = 0;
});

function insertSession(id: string, spaceId: string, state: string, startedAt: number): void {
  db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES (?, ?, 'recording', 't', ?, ?)", [
    id,
    spaceId,
    state,
    startedAt,
  ]);
}

describe("sessions", () => {
  it("createSession stores the row and getSession reads it back, or returns null for an unknown id", () => {
    const home = ensureDefaultSpace(db, deps());
    const created = createSession(db, deps(500), { spaceId: home.id, kind: "recording", title: "Lecture 6", state: "recording" });
    expect(created).toMatchObject({ spaceId: home.id, kind: "recording", title: "Lecture 6", state: "recording", startedAt: 500, recordedMs: 0 });
    expect(getSession(db, created.id)).toEqual(created);
    expect(getSession(db, "missing")).toBeNull();
  });

  it("latestSession skips recording sessions and picks the newest saved or interrupted one", () => {
    const home = ensureDefaultSpace(db, deps());
    insertSession("old", home.id, "saved", 1000);
    insertSession("new", home.id, "saved", 2000);
    insertSession("live", home.id, "recording", 3000);
    expect(latestSession(db)?.id).toBe("new");
  });

  it("summary counts pages, photos, flags and cards for each session", () => {
    const home = ensureDefaultSpace(db, deps());
    insertSession("s1", home.id, "saved", 1000);
    db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('p1', 's1', 'page', 0, 'a.jpg')");
    db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('p2', 's1', 'page', 1, 'b.jpg')");
    db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('ph', 's1', 'photo', 2, 'c.jpg')");
    db.run("INSERT INTO flags (id, session_id, t) VALUES ('f1', 's1', 0)");
    db.run("INSERT INTO flags (id, session_id, t) VALUES ('f2', 's1', 1)");
    db.run("INSERT INTO flags (id, session_id, t) VALUES ('f3', 's1', 2)");
    db.run(
      "INSERT INTO cards (id, session_id, kind, front, back, made_by, created_at, due_at, fsrs) VALUES ('k1', 's1', 'term', 'f', 'b', 'device_model', 1, 1, '{}')",
    );
    expect(latestSession(db)).toMatchObject({ spaceName: "My notes", pages: 2, photos: 1, flags: 3, cards: 1 });
  });

  it("sessionsInSpace lists saved and interrupted sessions in that space, newest first", () => {
    const home = ensureDefaultSpace(db, deps());
    const other = createSpace(db, deps(), "Biology");
    insertSession("a", home.id, "saved", 100);
    insertSession("b", home.id, "interrupted", 300);
    insertSession("c", home.id, "recording", 400);
    insertSession("d", other.id, "saved", 500);
    insertSession("e", home.id, "saved", 200);
    expect(sessionsInSpace(db, home.id).map((s) => s.id)).toEqual(["b", "e", "a"]);
  });

  it("renameSession trims the title and accepts 1 to 80 characters only", () => {
    const home = ensureDefaultSpace(db, deps());
    const s = createSession(db, deps(), { spaceId: home.id, kind: "pages", title: "Old", state: "saved" });
    renameSession(db, s.id, "  Biology notes  ");
    expect(getSession(db, s.id)?.title).toBe("Biology notes");
    renameSession(db, s.id, "a".repeat(80));
    expect(getSession(db, s.id)?.title).toBe("a".repeat(80));
    expect(() => renameSession(db, s.id, "   ")).toThrow(RangeError);
    expect(() => renameSession(db, s.id, "a".repeat(81))).toThrow(RangeError);
    expect(getSession(db, s.id)?.title).toBe("a".repeat(80));
  });

  it("moveSession changes the session's space and marks that space as used now", () => {
    const home = ensureDefaultSpace(db, deps());
    const math = createSpace(db, deps(100), "Math");
    const s = createSession(db, deps(), { spaceId: home.id, kind: "recording", title: "Lecture", state: "saved" });
    moveSession(db, s.id, math.id, 500);
    expect(getSession(db, s.id)?.spaceId).toBe(math.id);
    expect(db.get<{ last_used_at: number }>("SELECT last_used_at FROM spaces WHERE id = ?", [math.id])?.last_used_at).toBe(500);
  });

  it("deleteSessionRow removes the session and its captures, flags, cards and segments", () => {
    const home = ensureDefaultSpace(db, deps());
    const s = createSession(db, deps(), { spaceId: home.id, kind: "recording", title: "Lecture", state: "saved" });
    db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('p1', ?, 'page', 0, 'a.jpg')", [s.id]);
    db.run("INSERT INTO flags (id, session_id, t) VALUES ('f1', ?, 0)", [s.id]);
    db.run(
      "INSERT INTO cards (id, session_id, kind, front, back, made_by, created_at, due_at, fsrs) VALUES ('k1', ?, 'term', 'f', 'b', 'device_model', 1, 1, '{}')",
      [s.id],
    );
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES (?, 0, 10, 'hi', 'device')", [s.id]);
    deleteSessionRow(db, s.id);
    expect(getSession(db, s.id)).toBeNull();
    for (const table of ["captures", "flags", "cards", "segments"]) {
      expect(db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)?.n, table).toBe(0);
    }
  });
});

describe("recentSessions", () => {
  it("skips the newest finished sessions, newest first, and only finished ones", () => {
    const space = ensureDefaultSpace(db, deps());
    insertSession("a", space.id, "saved", 10);
    insertSession("b", space.id, "recording", 50);
    insertSession("c", space.id, "interrupted", 40);
    insertSession("d", space.id, "saved", 30);
    insertSession("e", space.id, "saved", 20);
    insertSession("f", space.id, "saved", 5);
    // Newest first: c (40), d (30), e (20), a (10), f (5). The newest one is skipped.
    expect(recentSessions(db, 1, 2).map((s) => s.id)).toEqual(["d", "e"]);
    expect(recentSessions(db, 1, 5).map((s) => s.id)).toEqual(["d", "e", "a", "f"]);
    expect(recentSessions(db, 0, 1).map((s) => s.id)).toEqual(["c"]);
    expect(recentSessions(db, 9, 5)).toEqual([]);
  });
});
