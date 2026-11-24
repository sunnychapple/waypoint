import { beforeEach, describe, expect, it } from "vitest";
import { addNote, deleteNote, getNote, notesForSession, updateNote } from "../src/core/capture/notes.ts";
import { migrate } from "../src/core/db/migrate.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;
let n = 0;
const deps = { now: () => 100, newId: () => `note-${++n}` };

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES ('space-1', 'My notes', 1, 0, 0)");
  db.run(
    "INSERT INTO sessions (id, space_id, kind, title, state, transcript, started_at, recorded_ms) VALUES ('s1', 'space-1', 'recording', 'Biology', 'saved', 'done', 0, 0)",
  );
});

describe("notes", () => {
  it("addNote returns an id, and notesForSession lists notes in t order with the quote collapsed and cut to 300 characters", () => {
    const later = addNote(db, deps, "s1", 5000, "Check this", "  a   quote ");
    const first = addNote(db, deps, "s1", 1000, "Early", "x".repeat(400));
    expect(later).toBe("note-1");
    expect(first).toBe("note-2");
    const notes = notesForSession(db, "s1");
    expect(notes.map((note) => note.id)).toEqual(["note-2", "note-1"]);
    expect(notes[1]?.quote).toBe("a quote");
    expect(notes[0]?.quote).toHaveLength(300);
  });

  it("addNote with only spaces returns null and writes nothing, and a negative t is stored as 0", () => {
    expect(addNote(db, deps, "s1", 10, "   ")).toBeNull();
    expect(notesForSession(db, "s1")).toEqual([]);
    const id = addNote(db, deps, "s1", -50, "Before start");
    expect(id).not.toBeNull();
    expect(getNote(db, id ?? "")?.t).toBe(0);
  });

  it("updateNote changes the text, and updating to empty deletes the note", () => {
    const id = addNote(db, deps, "s1", 0, "First");
    expect(id).not.toBeNull();
    updateNote(db, id ?? "", "  Second  ");
    expect(getNote(db, id ?? "")?.text).toBe("Second");
    updateNote(db, id ?? "", "   ");
    expect(getNote(db, id ?? "")).toBeNull();
  });

  it("getNote returns null for a missing id, and deleteNote removes a note", () => {
    expect(getNote(db, "missing")).toBeNull();
    const id = addNote(db, deps, "s1", 0, "Gone");
    deleteNote(db, id ?? "");
    expect(notesForSession(db, "s1")).toEqual([]);
  });
});
