import { SharedItemSchema } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { addPages, setPageText } from "../src/core/capture/pages.ts";
import { startRecordingSession, saveSegment } from "../src/core/capture/recording.ts";
import { deleteSessionRow, renameSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { expiryFor, linkUrl, linksForSession, markRevoked, recordLink, sharedItem } from "../src/core/share/links.ts";
import { utf8Length } from "../src/core/explain/sent.ts";
import { createMemoryDb } from "./helpers/db.ts";

// A device with one recording session titled "Cells", started at 1,000 ms.
function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1_000, newId: () => `id_${String(++n).padStart(16, "0")}` };
  const space = ensureDefaultSpace(db, deps);
  const session = startRecordingSession(db, deps, space.id, true);
  renameSession(db, session.id, "Cells");
  return { db, deps, session };
}

describe("sharedItem", () => {
  it("a session becomes a SharedItem that passes SharedItemSchema, with its transcript and page text", () => {
    const { db, deps, session } = setup();
    saveSegment(db, session.id, { tStart: 0, tEnd: 10, text: "cells divide" });
    saveSegment(db, session.id, { tStart: 10, tEnd: 20, text: "by mitosis" });
    const [page] = addPages(db, deps, session.id, ["p1.jpg"]);
    setPageText(db, page ?? "", "Mitosis", "[]");
    const out = sharedItem(db, session.id);
    expect(out?.cut).toBe(false);
    expect(SharedItemSchema.parse(out?.item)).toEqual({
      v: 1,
      kind: "session",
      title: "Cells",
      created_at: 1_000,
      transcript: [
        { t: 0, text: "cells divide" },
        { t: 10, text: "by mitosis" },
      ],
      pages: [{ text: "Mitosis" }],
    });
  });
  it("a long transcript is cut from the end, the item stays within the limit, and the cut is reported", () => {
    const { db, session } = setup();
    for (let i = 0; i < 40; i += 1) saveSegment(db, session.id, { tStart: i * 10, tEnd: i * 10 + 5, text: `line ${i} ${"x".repeat(200)}` });
    const out = sharedItem(db, session.id, 4_000);
    expect(out?.cut).toBe(true);
    expect(utf8Length(JSON.stringify(out?.item))).toBeLessThanOrEqual(4_000);
    const kept = out?.item.transcript.length ?? 0;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(40);
    expect(out?.item.transcript[0]?.text.startsWith("line 0 ")).toBe(true);
  });
  it("a session that is not there gives null", () => {
    const { db } = setup();
    expect(sharedItem(db, "missing")).toBeNull();
  });
});

describe("links", () => {
  it("the key goes only after #k=, so the part before the fragment has no key", () => {
    const id = "abcdefghijklmnopqrstuv";
    const url = linkUrl("https://api.example.test/", id, "KEY_123");
    expect(url).toBe(`https://api.example.test/l/${id}#k=KEY_123`);
    expect(url.slice(0, url.indexOf("#"))).not.toContain("KEY_123");
  });
  it("a recorded link is listed for its session, newest first, with its URL and passcode flag", () => {
    const { db, session } = setup();
    recordLink(db, { id: "link_a", sessionId: session.id, groupId: "grp_1", url: "https://x/l/a#k=1", hasPasscode: false, expiresAt: null, createdAt: 5 });
    recordLink(db, { id: "link_b", sessionId: session.id, groupId: "grp_1", url: "https://x/l/b#k=2", hasPasscode: true, expiresAt: 9, createdAt: 6 });
    expect(linksForSession(db, session.id).map((l) => [l.id, l.hasPasscode, l.expiresAt])).toEqual([
      ["link_b", true, 9],
      ["link_a", false, null],
    ]);
    expect(linksForSession(db, "other")).toEqual([]);
  });
  it("markRevoked sets revoked_at, and a second call keeps the first time", () => {
    const { db, session } = setup();
    recordLink(db, { id: "link_a", sessionId: session.id, groupId: "grp_1", url: "u", hasPasscode: false, expiresAt: null, createdAt: 5 });
    markRevoked(db, "link_a", 100);
    markRevoked(db, "link_a", 200);
    expect(linksForSession(db, session.id)[0]?.revokedAt).toBe(100);
  });
  it("deleting the session keeps the link row with session_id null, so it can still be revoked", () => {
    const { db, session } = setup();
    recordLink(db, { id: "link_a", sessionId: session.id, groupId: "grp_1", url: "u", hasPasscode: false, expiresAt: null, createdAt: 5 });
    deleteSessionRow(db, session.id);
    const row = db.get<{ session_id: string | null }>("SELECT session_id FROM links WHERE id = ?", ["link_a"]);
    expect(row).toEqual({ session_id: null });
    markRevoked(db, "link_a", 300);
    expect(db.get<{ revoked_at: number }>("SELECT revoked_at FROM links WHERE id = ?", ["link_a"])?.revoked_at).toBe(300);
  });
  it("expiryFor gives no time for none, a day, a week, or a month later", () => {
    const now = Date.UTC(2026, 10, 20);
    expect(expiryFor("none", now)).toBeNull();
    expect(expiryFor("day", now)).toBe(now + 86_400_000);
    expect(expiryFor("week", now)).toBe(now + 7 * 86_400_000);
    expect(expiryFor("month", now)).toBe(Date.UTC(2026, 11, 20));
  });
});
