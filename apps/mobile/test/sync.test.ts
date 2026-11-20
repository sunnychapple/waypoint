import { describe, expect, it } from "vitest";
import { savePart, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { createSpace, ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { applyChange, collectChanges, lastSeq, nextOutgoing, sent, setLastSeq, SyncChangeSchema } from "../src/core/sync/changes.ts";
import { createMemoryDb } from "./helpers/db.ts";

function device() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1_000 + n, newId: () => `id_${String(++n).padStart(16, "0")}` };
  ensureDefaultSpace(db, deps);
  const space = createSpace(db, deps, "Biology");
  db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES ('grp_0123456789abcdef', 'personal', 'owner', 1, 0)");
  db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, 'grp_0123456789abcdef')", [space.id]);
  db.run("DELETE FROM dirty");
  return { db, deps, space };
}
const G = "grp_0123456789abcdef";

describe("collecting changes", () => {
  it("rows in a synced space become one change each; other spaces are ignored", () => {
    const { db, deps, space } = device();
    const s = startRecordingSession(db, deps, space.id, true);
    saveSegment(db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    saveSegment(db, s.id, { tStart: 10, tEnd: 20, text: "divide" });
    const other = startRecordingSession(db, deps, ensureDefaultSpace(db, deps).id, true);
    saveSegment(db, other.id, { tStart: 0, tEnd: 1, text: "private" });
    expect(collectChanges(db, deps)).toBe(2);
    const out = nextOutgoing(db).map((o) => ({ kind: o.kind, body: SyncChangeSchema.parse(JSON.parse(o.body)) }));
    expect(out.map((o) => o.kind).sort()).toEqual(["segments", "sessions"]);
    const seg = out.find((o) => o.kind === "segments")?.body;
    expect(seg?.op === "segments" && seg.rows.map((r) => r.text)).toEqual(["cells", "divide"]);
    expect(JSON.stringify(out)).not.toContain("private");
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM dirty")?.n).toBe(0);
  });
  it("a deleted session keeps its group; sent entries leave the outbox", () => {
    const { db, deps, space } = device();
    const s = startRecordingSession(db, deps, space.id, true);
    collectChanges(db, deps);
    for (const o of nextOutgoing(db)) sent(db, o.id);
    db.run("DELETE FROM sessions WHERE id = ?", [s.id]);
    collectChanges(db, deps);
    const out = nextOutgoing(db);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("delete_sessions");
    expect(out[0]?.groupId).toBe(G);
  });
  it("a capture names its row for the blob upload", () => {
    const { db, deps, space } = device();
    const s = startRecordingSession(db, deps, space.id, true);
    savePart(db, deps, s.id, { index: 0, startMs: 0, durationMs: 5, file: "a.m4a" });
    collectChanges(db, deps);
    expect(nextOutgoing(db).find((o) => o.kind === "captures")?.blobCaptureId).not.toBeNull();
  });
});

describe("applying changes", () => {
  it("applies into the group's space, never marks rows dirty, and keeps the newest", () => {
    const a = device();
    const b = device();
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    collectChanges(a.db, a.deps);
    const changes = nextOutgoing(a.db).map((o) => SyncChangeSchema.parse(JSON.parse(o.body)));
    const session = changes.find((c) => c.op === "upsert");
    const segments = changes.find((c) => c.op === "segments");
    if (session === undefined || session.op !== "upsert" || segments === undefined) throw new Error("expected both changes");
    expect(applyChange(b.db, G, session, "dev_a")).toBe(true);
    expect(applyChange(b.db, G, segments, "dev_a")).toBe(true);
    expect(b.db.get<{ space_id: string; title: string }>("SELECT space_id, title FROM sessions WHERE id = ?", [s.id])).toEqual({ space_id: b.space.id, title: "New recording" });
    expect(b.db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = ?", [s.id])?.text).toBe("cells");
    expect(b.db.get<{ n: number }>("SELECT count(*) AS n FROM dirty")?.n).toBe(0);
    expect(applyChange(b.db, G, session, "dev_a")).toBe(false);
    expect(applyChange(b.db, G, { ...session, at: session.at + 5, row: { ...session.row, title: "Mitosis" } }, "dev_a")).toBe(true);
    expect(b.db.get<{ title: string }>("SELECT title FROM sessions WHERE id = ?", [s.id])?.title).toBe("Mitosis");
    expect(applyChange(b.db, "grp_unknown_0000000", session, "dev_a")).toBe(false);
  });
  it("last seq only moves forward", () => {
    const { db } = device();
    setLastSeq(db, G, 9, 1);
    setLastSeq(db, G, 4, 2);
    expect(lastSeq(db, G)).toBe(9);
  });
});
