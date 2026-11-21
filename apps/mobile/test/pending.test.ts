import { beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import { PENDING_GIVE_UP_MS, pendingCopy, pendingText, skippedCopy } from "../src/core/study/pending.ts";
import { createMemoryDb } from "./helpers/db.ts";

let db: SqlDb;

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  const home = ensureDefaultSpace(db, { now: () => 1, newId: () => "space" });
  createSession(db, { now: () => 1, newId: () => "pages" }, { spaceId: home.id, kind: "pages", title: "Pages", state: "saved" });
  createSession(db, { now: () => 1, newId: () => "rec" }, { spaceId: home.id, kind: "recording", title: "Lecture", state: "saved" });
});

function addPage(id: string, session: string, text: string | null): void {
  db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text) VALUES (?, ?, 'page', 0, ?, ?, ?)", [
    id,
    session,
    0,
    `${id}.jpg`,
    text,
  ]);
}

function setTranscript(session: string, state: string): void {
  db.run("UPDATE sessions SET transcript = ? WHERE id = ?", [state, session]);
}

describe("pending text", () => {
  it("nothing is pending for a session with no pages and no transcript waiting", () => {
    expect(pendingText(db, "pages")).toBeNull();
  });

  it("a page not read yet is pending", () => {
    addPage("p1", "pages", null);
    expect(pendingText(db, "pages")).toBe("pages");
  });

  it("a page whose read failed (empty text) counts as read", () => {
    addPage("p1", "pages", "");
    addPage("p2", "pages", "Some words");
    expect(pendingText(db, "pages")).toBeNull();
  });

  it("a waiting transcript is pending, and a live or done one is not", () => {
    setTranscript("rec", "waiting");
    expect(pendingText(db, "rec")).toBe("transcript");
    setTranscript("rec", "live");
    expect(pendingText(db, "rec")).toBeNull();
    setTranscript("rec", "done");
    expect(pendingText(db, "rec")).toBeNull();
  });

  it("unread pages come before a waiting transcript", () => {
    addPage("p1", "rec", null);
    setTranscript("rec", "waiting");
    expect(pendingText(db, "rec")).toBe("pages");
  });

  it("only this session's captures count", () => {
    addPage("p1", "rec", null);
    expect(pendingText(db, "pages")).toBeNull();
    expect(pendingText(db, "rec")).toBe("pages");
  });

  it("gives the copy for each kind of wait", () => {
    expect(pendingCopy("pages")).toBe("Reading your pages…");
    expect(pendingCopy("transcript")).toBe("Finishing the transcript…");
  });
});

describe("skipped copy", () => {
  it("says what could not be read when the wait ran out", () => {
    expect(skippedCopy("pages")).toBe("Some pages couldn't be read.");
    expect(skippedCopy("transcript")).toMatch(/transcript/);
    expect(PENDING_GIVE_UP_MS).toBe(60_000);
  });

  it("a failed transcript is not waiting", () => {
    setTranscript("rec", "failed");
    expect(pendingText(db, "rec")).toBeNull();
  });
});
