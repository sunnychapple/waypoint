import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addFlag, addPhoto, finishRecording, nameRecording, savePart, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { addPages, startPagesSession } from "../src/core/capture/pages.ts";
import { moveSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { setSetting } from "../src/core/db/settings.ts";
import { askLater } from "../src/core/explain/later.ts";
import { createSpace, ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { saveCards } from "../src/core/study/cards.ts";
import {
  applyChange,
  applyPulled,
  collectChanges,
  lastSeq,
  markMoved,
  HISTORY_FROM_SLACK_MS,
  MAX_CHANGE_BYTES,
  MAX_PENDING,
  nextOutgoing,
  sent,
  setLastSeq,
  type SyncChange,
  SYNC_COLUMNS,
  SyncChangeSchema,
} from "../src/core/sync/changes.ts";
import { createMemoryDb } from "./helpers/db.ts";

const G = "grp_0123456789abcdef";

// Each device has its own ids and device id. random: real UUIDs and a clock that stands still (the phone's case).
function device(name: string, options: { random?: boolean; synced?: boolean } = {}) {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = {
    now: () => (options.random === true ? 5_000 : 1_000 + n),
    newId: () => (options.random === true ? randomUUID() : `${name}_${String(++n).padStart(16, "0")}`),
    deviceId: `dev_${name}`,
  };
  ensureDefaultSpace(db, deps);
  const space = createSpace(db, deps, "Biology");
  if (options.synced !== false) {
    db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES (?, 'personal', 'owner', 1, 0)", [G]);
    db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, ?)", [space.id, G]);
  }
  db.run("DELETE FROM dirty");
  return { db, deps, space };
}
type Device = ReturnType<typeof device>;

// Collects, empties the outbox and returns what it held, in order.
function send(d: Device): SyncChange[] {
  collectChanges(d.db, d.deps);
  const out = nextOutgoing(d.db, 1_000);
  for (const o of out) sent(d.db, o.id);
  return out.map((o) => SyncChangeSchema.parse(JSON.parse(o.body)));
}
function count(d: Device, table: string): number {
  return d.db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)?.n ?? -1;
}
function title(d: Device, id: string): string | undefined {
  return d.db.get<{ title: string }>("SELECT title FROM sessions WHERE id = ?", [id])?.title;
}
function one<T extends SyncChange["op"]>(changes: SyncChange[], op: T, table?: string): Extract<SyncChange, { op: T }> {
  const found = changes.find((c) => c.op === op && (table === undefined || ("table" in c && c.table === table)));
  if (found === undefined) throw new Error(`no ${op} ${table ?? ""}`);
  return found as Extract<SyncChange, { op: T }>;
}

describe("collecting changes", () => {
  it("rows in a synced space become one change each; other spaces are ignored", () => {
    const a = device("a");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    saveSegment(a.db, s.id, { tStart: 10, tEnd: 20, text: "divide" });
    const other = startRecordingSession(a.db, a.deps, ensureDefaultSpace(a.db, a.deps).id, true);
    saveSegment(a.db, other.id, { tStart: 0, tEnd: 1, text: "private" });
    expect(collectChanges(a.db, a.deps)).toBe(2);
    const out = nextOutgoing(a.db).map((o) => ({ kind: o.kind, body: SyncChangeSchema.parse(JSON.parse(o.body)) }));
    expect(out.map((o) => o.kind)).toEqual(["sessions", "segments"]);
    const seg = one(out.map((o) => o.body), "segments");
    expect(seg.rows.map((r) => r.text)).toEqual(["cells", "divide"]);
    expect(JSON.stringify(out)).not.toContain("private");
    expect(count(a, "dirty")).toBe(0);
  });
  it("parents go first, in the order queued, with real ids and one clock reading", () => {
    const a = device("a", { random: true });
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    addFlag(a.db, a.deps, s.id, 5);
    const photo = addPhoto(a.db, a.deps, s.id, 6, "p.jpg");
    saveCards(a.db, a.deps, s.id, [{ kind: "term", front: "Mitosis", back: "Division", captureId: photo, t: 6 }], "device_model");
    finishRecording(a.db, s.id, 9_000, 8_000);
    expect(send(a).map((c) => (c.op === "segments" ? "segments" : c.table))).toEqual(["sessions", "captures", "flags", "cards", "segments"]);
  });
  it("every watched insert, update and delete is queued; local-only columns are not", () => {
    const a = device("a");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    saveCards(a.db, a.deps, s.id, [{ kind: "term", front: "Mitosis", back: "Division", captureId: null, t: 0 }], "device_model");
    send(a);
    addFlag(a.db, a.deps, s.id, 5);
    expect(send(a).map((c) => c.op === "upsert" && c.table)).toEqual(["flags"]);
    a.db.run("UPDATE cards SET front = 'Meiosis'");
    const card = one(send(a), "upsert", "cards");
    expect(card.row.front).toBe("Meiosis");
    a.db.run("DELETE FROM cards");
    expect(send(a).map((c) => c.op === "delete" && c.table)).toEqual(["cards"]);
    a.db.run("DELETE FROM segments");
    expect(one(send(a), "segments").rows).toEqual([]);
    a.db.run("UPDATE sessions SET indexed_at = 5");
    expect(send(a)).toEqual([]);
    a.db.run("UPDATE sessions SET summary = 'S'");
    const summary = one(send(a), "upsert", "sessions");
    expect(summary.row).toMatchObject({ summary: "S", summary_auto: 1, title_auto: 1 });
  });
  it("a deleted session keeps its group; sent entries leave the outbox", () => {
    const a = device("a");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    send(a);
    a.db.run("DELETE FROM sessions WHERE id = ?", [s.id]);
    collectChanges(a.db, a.deps);
    const out = nextOutgoing(a.db);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("delete_sessions");
    expect(out[0]?.groupId).toBe(G);
  });
  it("the outbox can be read for one group only", () => {
    const a = device("a");
    const other = "grp_fedcba9876543210";
    a.db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES (?, 'personal', 'owner', 1, 0)", [other]);
    a.db.run("INSERT INTO outbox (id, group_id, kind, body, created_at) VALUES ('x1', ?, 'sessions', '{}', 1)", [other]);
    a.db.run("INSERT INTO outbox (id, group_id, kind, body, created_at) VALUES ('g1', ?, 'sessions', '{}', 2)", [G]);
    expect(nextOutgoing(a.db, 50, G).map((o) => o.id)).toEqual(["g1"]);
    expect(nextOutgoing(a.db, 50, "grp_none")).toEqual([]);
    expect(nextOutgoing(a.db, 50).map((o) => o.id)).toEqual(["x1", "g1"]);
  });
  it("a capture names its row for the blob upload", () => {
    const a = device("a");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    savePart(a.db, a.deps, s.id, { index: 0, startMs: 0, durationMs: 5, file: "a.m4a" });
    collectChanges(a.db, a.deps);
    expect(nextOutgoing(a.db).find((o) => o.kind === "captures")?.blobCaptureId).not.toBeNull();
  });
  it("nothing is recorded while no space syncs", () => {
    const a = device("a", { synced: false });
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    for (let i = 0; i < 500; i += 1) saveSegment(a.db, s.id, { tStart: i * 10, tEnd: i * 10 + 5, text: "words" });
    expect(count(a, "dirty")).toBe(0);
  });
  it("a long transcript goes in 10-minute pieces under the room's limit; an oversized row stays home", () => {
    const a = device("a");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    a.db.transaction(() => {
      for (let i = 0; i < 12_000; i += 1) saveSegment(a.db, s.id, { tStart: i * 5_000, tEnd: i * 5_000 + 4_000, text: "the cell divides into two" });
    });
    const out = nextOutgoing((collectChanges(a.db, a.deps), a.db), 1_000);
    const pieces = out.filter((o) => o.kind === "segments");
    expect(pieces).toHaveLength(100);
    expect(Math.max(...pieces.map((o) => new TextEncoder().encode(o.body).length))).toBeLessThan(20_000);
    for (const o of out) sent(a.db, o.id);
    addFlag(a.db, a.deps, s.id, 1);
    a.db.run("UPDATE flags SET question = ?", ["x".repeat(MAX_CHANGE_BYTES + 1)]);
    addFlag(a.db, a.deps, s.id, 2);
    expect(send(a).map((c) => c.op === "upsert" && c.row.question)).toEqual([""]);
  });
});

describe("moving a session (M30b)", () => {
  it("a moved session goes to the new space's group, and a delete goes to the old group", () => {
    const a = device("a");
    const other = createSpace(a.db, a.deps, "Chemistry");
    const G2 = "grp_fedcba9876543210";
    a.db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES (?, 'personal', 'owner', 1, 0)", [G2]);
    a.db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, ?)", [other.id, G2]);
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    addFlag(a.db, a.deps, s.id, 5);
    send(a);
    moveSession(a.db, s.id, other.id, 2_000);
    markMoved(a.db, s.id, G);
    collectChanges(a.db, a.deps);
    expect(nextOutgoing(a.db).map((o) => [o.kind, o.groupId])).toEqual([
      ["sessions", G2],
      ["flags", G2],
      ["segments", G2],
      ["delete_sessions", G],
    ]);
  });
  it("a session in a space that does not sync moves with no delete, and nothing is sent", () => {
    const a = device("a", { synced: false });
    const other = createSpace(a.db, a.deps, "Chemistry");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    moveSession(a.db, s.id, other.id, 2_000);
    markMoved(a.db, s.id, null);
    expect(collectChanges(a.db, a.deps)).toBe(0);
    expect(count(a, "dirty")).toBe(0);
  });
});

// Maps a new space on d to group id (a second group on the same iPhone, or the only one).
function join(d: Device, groupId: string, name: string, kind: "personal" | "shared" = "shared", role = "editor") {
  const space = createSpace(d.db, d.deps, name);
  d.db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES (?, ?, ?, 1, 0)", [groupId, kind, role]);
  d.db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, ?)", [space.id, groupId]);
  d.db.run("DELETE FROM dirty");
  return space;
}
type Sent = { change: SyncChange; groupId: string };
function sendAll(d: Device): Sent[] {
  collectChanges(d.db, d.deps);
  const out = nextOutgoing(d.db, 1_000);
  for (const o of out) sent(d.db, o.id);
  return out.map((o) => ({ change: SyncChangeSchema.parse(JSON.parse(o.body)), groupId: o.groupId }));
}
// Applies each group's changes in the given group order, as M29b's pull does (one group at a time).
function pull(d: Device, changes: Sent[], order: string[], from = "dev_a") {
  for (const g of order) for (const c of changes.filter((x) => x.groupId === g)) applyChange(d.db, g, c.change, from);
}
function where(d: Device, id: string): string | null {
  return d.db.get<{ space_id: string }>("SELECT space_id FROM sessions WHERE id = ?", [id])?.space_id ?? null;
}

describe("moving a session between synced spaces (M30b probes)", () => {
  const G2 = "grp_fedcba9876543210";
  const G3 = "grp_3333333333333333";
  // a has Biology (G) and Chemistry (G2); a session with a segment, a flag and a photo is made and sent everywhere.
  function setup() {
    const a = device("a");
    const aY = join(a, G2, "Chemistry");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    addFlag(a.db, a.deps, s.id, 5);
    const photo = addPhoto(a.db, a.deps, s.id, 6, "p.jpg");
    const first = sendAll(a);
    return { a, aY, s, photo, first };
  }
  function moveOn(a: Device, sessionId: string, to: string) {
    const from = where(a, sessionId);
    const old = a.db.get<{ group_id: string }>("SELECT group_id FROM space_groups WHERE space_id = ?", [from])?.group_id ?? null;
    moveSession(a.db, sessionId, to, 2_000);
    markMoved(a.db, sessionId, old);
  }

  it("the delete is a millisecond older than the upserts and names the new group", () => {
    const { a, aY, s } = setup();
    moveOn(a, s.id, aY.id);
    const out = sendAll(a);
    const del = out.find((o) => o.change.op === "delete");
    const up = out.find((o) => o.change.op === "upsert" && o.change.table === "sessions");
    expect(del?.groupId).toBe(G);
    expect(del?.change).toMatchObject({ table: "sessions", row_id: s.id, moved_to: G2 });
    expect(up?.groupId).toBe(G2);
    expect((up?.change.at ?? 0) - (del?.change.at ?? 0)).toBe(1);
    // a's own echoes change nothing.
    pull(a, out, [G, G2]);
    expect(where(a, s.id)).toBe(aY.id);
    expect(count(a, "flags")).toBe(1);
  });

  for (const order of [[G, G2], [G2, G]]) {
    it(`a device in both groups keeps the moved session, its rows and its files (pulled ${order[0] === G ? "old" : "new"} group first)`, () => {
      const { a, aY, s, first } = setup();
      const b = device("b");
      const bY = join(b, G2, "Chem");
      pull(b, first, [G]);
      b.db.run("UPDATE captures SET file = 'b.jpg'");
      expect(where(b, s.id)).toBe(b.space.id);
      a.db.run("UPDATE sessions SET title = 'Moved'");
      moveOn(a, s.id, aY.id);
      pull(b, sendAll(a), order);
      expect(where(b, s.id)).toBe(bY.id);
      expect(title(b, s.id)).toBe("Moved");
      expect([count(b, "flags"), count(b, "captures"), count(b, "segments")]).toEqual([1, 1, 1]);
      expect(b.db.get<{ file: string }>("SELECT file FROM captures")?.file).toBe("b.jpg");
      expect(count(b, "sync_pending")).toBe(0);
    });
  }

  it("a device only in the old group drops it; one only in the new group gets it", () => {
    const { a, aY, s, first } = setup();
    const c = device("c");
    pull(c, first, [G]);
    const d = device("d", { synced: false });
    const dY = join(d, G2, "Chem");
    a.db.run("UPDATE sessions SET title = 'Moved'");
    moveOn(a, s.id, aY.id);
    const out = sendAll(a);
    pull(c, out, [G]);
    expect([count(c, "sessions"), count(c, "flags")]).toEqual([0, 0]);
    pull(d, out, [G2]);
    expect(where(d, s.id)).toBe(dY.id);
    expect([title(d, s.id), count(d, "flags"), count(d, "captures"), count(d, "segments")]).toEqual(["Moved", 1, 1, 1]);
  });

  it("moved twice before sending: both old groups get a delete naming the last group", () => {
    const { a, aY, s, first } = setup();
    const aZ = join(a, G3, "Physics");
    moveOn(a, s.id, aY.id);
    moveOn(a, s.id, aZ.id);
    const out = sendAll(a);
    const deletes = out.filter((o) => o.change.op === "delete").map((o) => [o.groupId, o.change.op === "delete" ? o.change.moved_to : null]);
    expect(deletes).toEqual([[G, G3], [G2, G3]]);
    expect(out.filter((o) => o.change.op !== "delete").every((o) => o.groupId === G3)).toBe(true);
    const c = device("c");
    pull(c, first, [G]);
    pull(c, out, [G]);
    expect(count(c, "sessions")).toBe(0);
    for (const order of [[G, G3], [G3, G], [G2, G3, G]]) {
      const b = device("b");
      const bZ = join(b, G3, "Phys");
      join(b, G2, "Chem");
      pull(b, first, [G]);
      pull(b, out, order);
      expect(where(b, s.id)).toBe(bZ.id);
      expect(count(b, "flags")).toBe(1);
    }
  });

  it("moved then deleted before sending: both groups get a plain delete", () => {
    const { a, aY, s, first } = setup();
    moveOn(a, s.id, aY.id);
    a.db.run("DELETE FROM sessions WHERE id = ?", [s.id]);
    const out = sendAll(a);
    const deletes = out.filter((o) => o.change.op === "delete" && o.change.table === "sessions");
    expect(deletes.map((o) => o.groupId).sort()).toEqual([G, G2].sort());
    expect(deletes.every((o) => o.change.op === "delete" && o.change.moved_to === undefined)).toBe(true);
    const b = device("b");
    join(b, G2, "Chem");
    pull(b, first, [G]);
    pull(b, out, [G2, G]);
    expect(count(b, "sessions")).toBe(0);
  });

  it("moved away and back before sending: no delete for the group it is in", () => {
    const { a, aY, s } = setup();
    moveOn(a, s.id, aY.id);
    moveOn(a, s.id, a.space.id);
    const out = sendAll(a);
    expect(out.filter((o) => o.change.op === "delete").map((o) => o.groupId)).toEqual([G2]);
    expect(out.filter((o) => o.change.op !== "delete").every((o) => o.groupId === G)).toBe(true);
  });

  it("a move into a private space is a plain delete; the other device drops it", () => {
    const { a, s, first } = setup();
    moveOn(a, s.id, ensureDefaultSpace(a.db, a.deps).id);
    const out = sendAll(a);
    expect(out.map((o) => [o.groupId, o.change.op])).toEqual([[G, "delete"]]);
    expect(out[0]?.change).not.toHaveProperty("moved_to");
  });

  it("another group can never pull a session out of its space: its upsert only waits", () => {
    const { s, first } = setup();
    const b = device("b");
    const bY = join(b, G2, "Chem");
    pull(b, first, [G]);
    const up = first.find((o) => o.change.op === "upsert" && o.change.table === "sessions")?.change;
    if (up?.op !== "upsert") throw new Error("no session upsert");
    const evil = { ...up, at: 4_000_000_000_000, row: { ...up.row, title: "Mine now" } };
    expect(applyChange(b.db, G2, evil, "dev_x")).toBe("deferred");
    expect([where(b, s.id), title(b, s.id)]).toEqual([b.space.id, "New recording"]);
    expect(count(b, "sync_pending")).toBe(1);
    // A delete whose moved_to names a group this iPhone does not map deletes, as a plain delete does; nothing moves.
    const del: SyncChange = { v: 1, id: "del_000000000000001", at: 3_000, op: "delete", table: "sessions", row_id: s.id, moved_to: "grp_not_mine_00000" };
    expect(applyChange(b.db, G, del, "dev_c")).toBe("applied");
    expect([count(b, "sessions"), where(b, s.id) === bY.id]).toEqual([0, false]);
  });
});

describe("applying changes", () => {
  it("applies into the group's space, never marks rows dirty, and keeps the newest", () => {
    const a = device("a");
    const b = device("b");
    expect(a.space.id).not.toBe(b.space.id);
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    const changes = send(a);
    const session = one(changes, "upsert", "sessions");
    expect(applyChange(b.db, G, session, "dev_a")).toBe("applied");
    b.db.run("UPDATE sessions SET indexed_at = 5 WHERE id = ?", [s.id]);
    expect(applyChange(b.db, G, one(changes, "segments"), "dev_a")).toBe("applied");
    // New words from another phone go back through this phone's search index.
    expect(b.db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = ?", [s.id])?.indexed_at).toBeNull();
    expect(b.db.get("SELECT space_id, title FROM sessions WHERE id = ?", [s.id])).toEqual({ space_id: b.space.id, title: "New recording" });
    expect(b.db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = ?", [s.id])?.text).toBe("cells");
    expect(count(b, "dirty")).toBe(0);
    expect(applyChange(b.db, G, session, "dev_a")).toBe("older");
    expect(applyChange(b.db, G, { ...session, at: session.at + 5, row: { ...session.row, title: "Mitosis" } }, "dev_a")).toBe("applied");
    expect(title(b, s.id)).toBe("Mitosis");
    expect(applyChange(b.db, "grp_unknown_0000000", session, "dev_a")).toBe("rejected");
  });
  it("a summary and which title the app made travel with a session; a change without them keeps this phone's", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    const session = one(send(a), "upsert", "sessions");
    expect(applyChange(b.db, G, session, "dev_a")).toBe("applied");
    b.db.run("UPDATE sessions SET summary = 'Kept', summary_auto = 0, title_auto = 1 WHERE id = ?", [s.id]);
    // An app version before migration 13 sends no summary or title_auto: this phone keeps its own.
    const without = (at: number, title: string) => {
      const row = Object.fromEntries(Object.entries(session.row).filter(([k]) => k !== "title_auto" && k !== "summary" && k !== "summary_auto"));
      return { ...session, at, row: { ...row, title } };
    };
    const kept = "SELECT summary, summary_auto, title_auto FROM sessions WHERE id = ?";
    expect(applyChange(b.db, G, without(session.at + 5, "New recording"), "dev_a")).toBe("applied");
    expect(b.db.get(kept, [s.id])).toEqual({ summary: "Kept", summary_auto: 0, title_auto: 1 });
    expect(applyChange(b.db, G, without(session.at + 10, "Mitosis"), "dev_a")).toBe("applied");
    expect(b.db.get(kept, [s.id])).toEqual({ summary: "Kept", summary_auto: 0, title_auto: 0 });
    expect(title(b, s.id)).toBe("Mitosis");
  });
  it("a title typed on this phone wins over a title the app made on another phone, and goes back out", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    const session = one(send(a), "upsert", "sessions");
    expect(applyChange(b.db, G, session, "dev_a")).toBe("applied");
    b.db.run("UPDATE sessions SET title = 'Mitosis', title_auto = 0 WHERE id = ?", [s.id]);
    b.db.run("DELETE FROM dirty");
    const made = { ...session, at: session.at + 5, row: { ...session.row, title: "Cell cycle", title_auto: 1 } };
    expect(applyChange(b.db, G, made, "dev_a")).toBe("applied");
    expect(b.db.get("SELECT title, title_auto FROM sessions WHERE id = ?", [s.id])).toEqual({ title: "Mitosis", title_auto: 0 });
    expect(b.db.get("SELECT table_name, row_id, deleted, group_id FROM dirty")).toEqual({ table_name: "sessions", row_id: s.id, deleted: 0, group_id: null });
    // The typed title goes back with a clock newer than the made one, so the other phones take it.
    const back = one(send(b), "upsert", "sessions");
    expect(back.row).toMatchObject({ title: "Mitosis", title_auto: 0 });
    expect(back.at).toBeGreaterThan(made.at);
  });
  it("a recording named by the app on one phone is named the same on another, even when it synced before Stop", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    expect(applyChange(b.db, G, one(send(a), "upsert", "sessions"), "dev_a")).toBe("applied");
    // A stops and the app names the recording. Its title_auto was 1 from the start, so B never holds it as typed.
    finishRecording(a.db, s.id, 9_000, 8_000);
    nameRecording(a.db, s.id);
    const named = one(send(a), "upsert", "sessions");
    expect(named.row).toMatchObject({ title_auto: 1 });
    expect(applyChange(b.db, G, named, "dev_a")).toBe("applied");
    expect(title(b, s.id)).toBe(title(a, s.id));
    expect(title(b, s.id)).not.toBe("New recording");
    expect(b.db.get("SELECT title_auto FROM sessions WHERE id = ?", [s.id])).toEqual({ title_auto: 1 });
    // B syncs back: A keeps the app title it made.
    for (const change of send(b).filter((c) => c.op === "upsert" && c.table === "sessions")) applyChange(a.db, G, change, "dev_b");
    expect(title(a, s.id)).not.toBe("New recording");
    expect(a.db.get("SELECT title_auto FROM sessions WHERE id = ?", [s.id])).toEqual({ title_auto: 1 });
  });
  it("a phone that holds the default name as typed (from before this fix) takes the app's title", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    expect(applyChange(b.db, G, one(send(a), "upsert", "sessions"), "dev_a")).toBe("applied");
    b.db.run("UPDATE sessions SET title_auto = 0 WHERE id = ?", [s.id]);
    finishRecording(a.db, s.id, 9_000, 8_000);
    nameRecording(a.db, s.id);
    expect(applyChange(b.db, G, one(send(a), "upsert", "sessions"), "dev_a")).toBe("applied");
    expect(title(b, s.id)).toBe(title(a, s.id));
    expect(b.db.get("SELECT title_auto FROM sessions WHERE id = ?", [s.id])).toEqual({ title_auto: 1 });
  });
  it("a received summary over 2,000 characters is cut to 2,000", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    const session = one(send(a), "upsert", "sessions");
    expect(applyChange(b.db, G, session, "dev_a")).toBe("applied");
    const long = { ...session, at: session.at + 5, row: { ...session.row, summary: "s".repeat(2_500), summary_auto: 1 } };
    expect(applyChange(b.db, G, long, "dev_a")).toBe("applied");
    expect(b.db.get<{ n: number }>("SELECT length(summary) AS n FROM sessions WHERE id = ?", [s.id])?.n).toBe(2_000);
  });
  it("a title_auto or summary_auto that is not 0 or 1 is stored as 1 (or the default), without throwing", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    const session = one(send(a), "upsert", "sessions");
    expect(applyChange(b.db, G, session, "dev_a")).toBe("applied");
    const odd = { ...session, at: session.at + 5, row: { ...session.row, title_auto: 5, summary_auto: 7 } };
    expect(applyChange(b.db, G, odd, "dev_a")).toBe("applied");
    expect(b.db.get("SELECT title_auto, summary_auto FROM sessions WHERE id = ?", [s.id])).toEqual({ title_auto: 1, summary_auto: 1 });
    const nulls = { ...session, at: session.at + 10, row: { ...session.row, title_auto: null, summary_auto: null, summary: 42 } };
    expect(applyChange(b.db, G, nulls, "dev_a")).toBe("applied");
    expect(b.db.get("SELECT title_auto, summary_auto, summary FROM sessions WHERE id = ?", [s.id])).toEqual({ title_auto: 0, summary_auto: 1, summary: null });
  });
  it("a row with only some of the three new columns keeps this phone's values for the rest", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    const session = one(send(a), "upsert", "sessions");
    expect(applyChange(b.db, G, session, "dev_a")).toBe("applied");
    b.db.run("UPDATE sessions SET summary = 'Kept' WHERE id = ?", [s.id]);
    const only = (at: number, extra: Record<string, string | number | null>) => {
      const row = Object.fromEntries(Object.entries(session.row).filter(([k]) => k !== "title_auto" && k !== "summary" && k !== "summary_auto"));
      return { ...session, at, row: { ...row, ...extra } };
    };
    expect(applyChange(b.db, G, only(session.at + 5, { summary_auto: 0 }), "dev_a")).toBe("applied");
    expect(b.db.get("SELECT summary, summary_auto, title_auto FROM sessions WHERE id = ?", [s.id])).toEqual({ summary: "Kept", summary_auto: 0, title_auto: 1 });
    expect(applyChange(b.db, G, only(session.at + 10, { summary: "Sent" }), "dev_a")).toBe("applied");
    expect(b.db.get("SELECT summary, summary_auto, title_auto FROM sessions WHERE id = ?", [s.id])).toEqual({ summary: "Sent", summary_auto: 0, title_auto: 1 });
    expect(applyChange(b.db, G, only(session.at + 15, { title_auto: 1 }), "dev_a")).toBe("applied");
    expect(b.db.get("SELECT summary, summary_auto, title_auto FROM sessions WHERE id = ?", [s.id])).toEqual({ summary: "Sent", summary_auto: 0, title_auto: 1 });
  });
  it("children that arrive before their session (or a card before its photo) wait, then land", () => {
    const a = device("a", { random: true });
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    addFlag(a.db, a.deps, s.id, 5);
    const photo = addPhoto(a.db, a.deps, s.id, 6, "p.jpg");
    saveCards(a.db, a.deps, s.id, [{ kind: "term", front: "Mitosis", back: "Division", captureId: photo, t: 6 }], "device_model");
    const changes = send(a).reverse();
    const results = changes.map((c) => applyChange(b.db, G, c, "dev_a"));
    expect(results).toEqual(["deferred", "deferred", "deferred", "deferred", "applied"]);
    expect(b.db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = ?", [s.id])?.text).toBe("cells");
    expect(count(b, "flags")).toBe(1);
    expect(b.db.get<{ capture_id: string }>("SELECT capture_id FROM cards")?.capture_id).toBe(photo);
    expect(count(b, "sync_pending")).toBe(0);
    expect(changes.map((c) => applyChange(b.db, G, c, "dev_a"))).toEqual(["older", "older", "older", "older", "older"]);
  });
  it("a member invited from now drops changes to a note started before they joined; a newer note lands", () => {
    const a = device("a");
    const b = device("b");
    const old = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, old.id, { tStart: 0, tEnd: 10, text: "before" });
    addFlag(a.db, a.deps, old.id, 5);
    const before = send(a);
    b.db.run("UPDATE groups SET history_from = ? WHERE id = ?", [old.startedAt + HISTORY_FROM_SLACK_MS + 1, G]);
    expect(before.map((c) => applyChange(b.db, G, c, "dev_a"))).toEqual(["older", "older", "older"]);
    expect(applyChange(b.db, G, { ...one(before, "upsert", "sessions"), at: 9_000, row: { ...one(before, "upsert", "sessions").row, title: "Renamed" } }, "dev_a")).toBe("older");
    expect(count(b, "sessions")).toBe(0);
    expect(count(b, "sync_pending")).toBe(0);
    const later = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, later.id, { tStart: 0, tEnd: 10, text: "after" });
    expect(send(a).map((c) => applyChange(b.db, G, c, "dev_a"))).toEqual(["applied", "applied"]);
    expect(b.db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = ?", [later.id])?.text).toBe("after");
  });
  it("an author whose clock is a little behind the join time still lands; one far behind is dropped", () => {
    const a = device("a");
    const b = device("b");
    const note = startRecordingSession(a.db, a.deps, a.space.id, true);
    const changes = send(a);
    const sessionChange = one(changes, "upsert", "sessions");
    b.db.run("UPDATE groups SET history_from = ? WHERE id = ?", [note.startedAt + HISTORY_FROM_SLACK_MS, G]);
    expect(applyChange(b.db, G, sessionChange, "dev_a")).toBe("applied");
    const c = device("c");
    c.db.run("UPDATE groups SET history_from = ? WHERE id = ?", [note.startedAt + HISTORY_FROM_SLACK_MS + 1, G]);
    expect(applyChange(c.db, G, sessionChange, "dev_a")).toBe("older");
  });
  it("a member invited with everything gets changes to notes from before they joined", () => {
    const a = device("a");
    const b = device("b");
    const old = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, old.id, { tStart: 0, tEnd: 10, text: "before" });
    expect(send(a).map((c) => applyChange(b.db, G, c, "dev_a"))).toEqual(["applied", "applied"]);
  });
  it("a child that arrives before its session: dropped for a from-now member (the card relies on the log order), kept waiting for everything", () => {
    const a = device("a");
    const b = device("b");
    const c = device("c");
    const later = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, later.id, { tStart: 0, tEnd: 10, text: "after" });
    const changes = send(a);
    const child = changes.find((x) => x.op === "segments");
    if (child === undefined) throw new Error("no segments");
    b.db.run("UPDATE groups SET history_from = ? WHERE id = ?", [later.startedAt - 1, G]);
    expect(applyChange(b.db, G, child, "dev_a")).toBe("older");
    expect(count(b, "sync_pending")).toBe(0);
    expect(applyChange(c.db, G, child, "dev_a")).toBe("deferred");
    expect(count(c, "sync_pending")).toBe(1);
    expect(applyChange(c.db, G, one(changes, "upsert", "sessions"), "dev_a")).toBe("applied");
    expect(count(c, "segments")).toBe(1);
  });
  it("children of a deleted session are dropped, not kept waiting", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    addFlag(a.db, a.deps, s.id, 5);
    const [session, flag] = send(a);
    if (session === undefined || flag === undefined) throw new Error("expected two changes");
    applyChange(b.db, G, session, "dev_a");
    a.db.run("DELETE FROM sessions");
    expect(applyChange(b.db, G, one(send(a), "delete"), "dev_a")).toBe("applied");
    expect(count(b, "sessions")).toBe(0);
    expect(applyChange(b.db, G, flag, "dev_a")).toBe("older");
    expect(applyChange(b.db, G, session, "dev_a")).toBe("older");
    expect(count(b, "sync_pending")).toBe(0);
  });
  it("its own changes coming back do not undo a newer local edit", () => {
    const a = device("a");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    a.db.run("UPDATE sessions SET title = 'X'");
    const echo = one(send(a), "upsert", "sessions");
    a.db.run("UPDATE sessions SET title = 'Y'");
    const sameTimeFromB = { ...echo, row: { ...echo.row, title: "B" } };
    const pulled = [{ change: echo, deviceId: "dev_a" }, { change: sameTimeFromB, deviceId: "dev_b" }];
    expect(applyPulled(a.db, G, pulled, a.deps)).toEqual({ applied: 0, older: 2, deferred: 0, rejected: 0 });
    expect(title(a, s.id)).toBe("Y");
    expect(one(send(a), "upsert", "sessions").row.title).toBe("Y");
  });
  it("a late older change from another device loses to a newer local edit", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    const created = one(send(a), "upsert", "sessions");
    applyChange(b.db, G, created, "dev_a");
    b.db.run("UPDATE sessions SET title = 'From B'");
    const fromB = one(send(b), "upsert", "sessions");
    a.db.run("UPDATE sessions SET title = 'From A'");
    const fromA = one(send(a), "upsert", "sessions");
    expect(applyChange(a.db, G, { ...fromB, at: fromA.at - 1 }, "dev_b")).toBe("older");
    expect(title(a, s.id)).toBe("From A");
  });
  it("equal times go to the larger device id, whatever the order", () => {
    const x = device("x");
    const s = startRecordingSession(x.db, x.deps, x.space.id, true);
    const base = one(send(x), "upsert", "sessions");
    const fromA = { ...base, at: 50_000, row: { ...base.row, title: "A" } };
    const fromB = { ...base, at: 50_000, row: { ...base.row, title: "B" } };
    const c = device("c");
    const d = device("d");
    applyChange(c.db, G, fromA, "dev_a");
    applyChange(c.db, G, fromB, "dev_b");
    applyChange(d.db, G, fromB, "dev_b");
    applyChange(d.db, G, fromA, "dev_a");
    expect([title(c, s.id), title(d, s.id)]).toEqual(["B", "B"]);
  });
  it("a bad change is rejected without throwing and leaves nothing behind", () => {
    const a = device("a");
    const b = device("b");
    startRecordingSession(a.db, a.deps, a.space.id, true);
    const session = one(send(a), "upsert", "sessions");
    expect(applyChange(b.db, G, { ...session, row: { ...session.row, state: "done" } }, "dev_a")).toBe("rejected");
    expect(applyChange(b.db, G, { ...session, row: { ...session.row, title: null } }, "dev_a")).toBe("rejected");
    expect(count(b, "sessions")).toBe(0);
    expect(count(b, "row_versions")).toBe(0);
    expect(b.db.get<{ applying: number }>("SELECT applying FROM sync_mode")?.applying).toBe(0);
    expect(applyChange(b.db, G, session, "dev_a")).toBe("applied");
  });
  it("changes cannot reach rows outside the group's space", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    addFlag(a.db, a.deps, s.id, 5);
    const changes = send(a);
    for (const c of changes) applyChange(b.db, G, c, "dev_a");
    const priv = startRecordingSession(b.db, b.deps, ensureDefaultSpace(b.db, b.deps).id, true);
    addFlag(b.db, b.deps, priv.id, 1);
    const privFlag = b.db.get<{ id: string }>("SELECT id FROM flags WHERE session_id = ?", [priv.id])?.id ?? "";
    const flag = one(changes, "upsert", "flags");
    const later = { ...flag, at: flag.at + 100 };
    expect(applyChange(b.db, G, { ...later, row: { ...flag.row, id: privFlag, question: "evil" } }, "dev_a")).toBe("rejected");
    expect(applyChange(b.db, G, { ...later, row: { ...flag.row, session_id: priv.id } }, "dev_a")).toBe("rejected");
    expect(applyChange(b.db, G, { v: 1, id: "del_000000000000000", at: 99_999, op: "delete", table: "sessions", row_id: priv.id }, "dev_a")).toBe("rejected");
    const session = one(changes, "upsert", "sessions");
    expect(applyChange(b.db, G, { ...session, at: session.at + 100, row: { ...session.row, id: priv.id } }, "dev_a")).toBe("rejected");
    expect(b.db.get("SELECT space_id, title FROM sessions WHERE id = ?", [priv.id])).toEqual({ space_id: ensureDefaultSpace(b.db, b.deps).id, title: "New recording" });
    expect(b.db.get<{ question: string }>("SELECT question FROM flags WHERE id = ?", [privFlag])?.question).toBe("");
  });
  it("a delete of a space is refused and changes nothing", () => {
    const b = device("b");
    const change: SyncChange = { v: 1, id: "dsp_000000000000000", at: 10, op: "delete", table: "spaces", row_id: b.space.id };
    expect(applyChange(b.db, G, change, "dev_a")).toBe("rejected");
    expect(count(b, "spaces")).toBe(2);
    expect(count(b, "row_versions")).toBe(0);
  });
  it("a space's name lands on the mapped space, cut to 60 characters", () => {
    const b = device("b");
    const change: SyncChange = { v: 1, id: "spc_000000000000000", at: 10, op: "upsert", table: "spaces", row: { id: "someone_elses_space", name: "n".repeat(100), created_at: 1 } };
    expect(applyChange(b.db, G, change, "dev_a")).toBe("applied");
    expect(b.db.get<{ name: string }>("SELECT name FROM spaces WHERE id = ?", [b.space.id])?.name).toBe("n".repeat(60));
    expect(applyChange(b.db, G, { ...change, at: 9, row: { ...change.row, id: "another_space_id", name: "Old" } }, "dev_c")).toBe("older");
  });
  it("an edit made after a received change is stamped later, even on a slow clock", () => {
    const a = device("a");
    const b = device("b");
    startRecordingSession(a.db, a.deps, a.space.id, true);
    const session = one(send(a), "upsert", "sessions");
    applyChange(b.db, G, { ...session, at: 900_000 }, "dev_a");
    b.db.run("UPDATE sessions SET title = 'Later'");
    expect(one(send(b), "upsert", "sessions").at).toBe(900_002);
  });
  it("a transcript piece replaces only its own 10 minutes", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "first" });
    saveSegment(a.db, s.id, { tStart: 600_000, tEnd: 600_010, text: "second" });
    const changes = send(a);
    for (const c of changes) applyChange(b.db, G, c, "dev_a");
    const second = changes.filter((c) => c.op === "segments")[1];
    if (second?.op !== "segments") throw new Error("expected two pieces");
    expect(second.bucket).toBe(1);
    const stray = { t_start: 5, t_end: 6, text: "stray" };
    expect(applyChange(b.db, G, { ...second, at: second.at + 1, rows: [stray, { t_start: 600_000, t_end: 600_020, text: "again" }] }, "dev_a")).toBe("applied");
    expect(b.db.all<{ text: string }>("SELECT text FROM segments ORDER BY t_start").map((r) => r.text)).toEqual(["first", "again"]);
  });
  it("while this phone records the session, a received bucket adds its words and keeps a local one", () => {
    for (const recordingHere of [true, false]) {
      const a = device("a");
      const b = device("b");
      const s = startRecordingSession(a.db, a.deps, a.space.id, true);
      saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "theirs" });
      const changes = send(a);
      for (const c of changes) if (c.op !== "segments") applyChange(b.db, G, c, "dev_a");
      if (recordingHere) setSetting(b.db, `recording_here:${s.id}`, "1");
      saveSegment(b.db, s.id, { tStart: 5_000, tEnd: 6_000, text: "mine" });
      const bucket = one(changes, "segments");
      expect(applyChange(b.db, G, { ...bucket, at: bucket.at + 1 }, "dev_a")).toBe("applied");
      const texts = b.db.all<{ text: string }>("SELECT text FROM segments WHERE session_id = ? ORDER BY t_start", [s.id]).map((r) => r.text);
      expect(texts).toEqual(recordingHere ? ["theirs", "mine"] : ["theirs"]);
    }
  });
  it("while this phone records, an older device bucket still adds its words and goes back out as a dirty bucket", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "theirs" });
    const changes = send(a);
    for (const c of changes) applyChange(b.db, G, c, "dev_a");
    setSetting(b.db, `recording_here:${s.id}`, "1");
    saveSegment(b.db, s.id, { tStart: 5_000, tEnd: 6_000, text: "mine" });
    const bucket = one(changes, "segments");
    b.db.run("DELETE FROM dirty");
    expect(applyChange(b.db, G, { ...bucket, at: 1, rows: [{ t_start: 0, t_end: 10, text: "theirs" }, { t_start: 7_000, t_end: 8_000, text: "older" }] }, "dev_a")).toBe("applied");
    expect(b.db.all<{ text: string }>("SELECT text FROM segments WHERE session_id = ? ORDER BY t_start", [s.id]).map((r) => r.text)).toEqual(["theirs", "mine", "older"]);
    expect(b.db.all<{ row_id: string }>("SELECT row_id FROM dirty WHERE table_name = 'segments'")).toEqual([{ row_id: `${s.id}:device:0` }]);
  });
  it("while this phone records, a merged bucket from a phone whose clock is ahead goes back out newer than it", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "theirs" });
    const changes = send(a);
    for (const c of changes) if (c.op !== "segments") applyChange(b.db, G, c, "dev_a");
    setSetting(b.db, `recording_here:${s.id}`, "1");
    saveSegment(b.db, s.id, { tStart: 5_000, tEnd: 6_000, text: "mine" });
    send(b);
    const ahead = Date.now() + 86_400_000;
    const bucket = one(changes, "segments");
    expect(applyChange(b.db, G, { ...bucket, at: ahead }, "dev_a")).toBe("applied");
    const back = one(send(b), "segments");
    expect(back.at).toBeGreaterThan(ahead);
    expect(back.rows.map((r) => r.text)).toEqual(["theirs", "mine"]);
  });
  it("while this phone records, a device bucket that adds no new words leaves no dirty row", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "theirs" });
    const changes = send(a);
    for (const c of changes) applyChange(b.db, G, c, "dev_a");
    setSetting(b.db, `recording_here:${s.id}`, "1");
    const bucket = one(changes, "segments");
    b.db.run("DELETE FROM dirty");
    expect(applyChange(b.db, G, { ...bucket, at: bucket.at + 1 }, "dev_a")).toBe("applied");
    expect(b.db.all("SELECT row_id FROM dirty WHERE table_name = 'segments'")).toEqual([]);
  });
  it("while this phone records, a cloud bucket still replaces the cloud rows", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    const changes = send(a);
    for (const c of changes) if (c.op !== "segments") applyChange(b.db, G, c, "dev_a");
    setSetting(b.db, `recording_here:${s.id}`, "1");
    b.db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES (?, 0, 10, 'old cloud', 'cloud')", [s.id]);
    const cloud: SyncChange = { v: 1, id: "seg_cloud_0000000000", at: 1_000, op: "segments", session_id: s.id, source: "cloud", bucket: 0, rows: [{ t_start: 0, t_end: 10, text: "new cloud" }] };
    expect(applyChange(b.db, G, cloud, "dev_a")).toBe("applied");
    expect(b.db.all<{ text: string }>("SELECT text FROM segments WHERE session_id = ? AND source = 'cloud'", [s.id]).map((r) => r.text)).toEqual(["new cloud"]);
  });
  it("a waiting row keeps its newest version; a deleted session clears what waited for it", () => {
    const b = device("b");
    const flag = (at: number, question: string): SyncChange => ({ v: 1, id: `flg_${String(at).padStart(16, "0")}`, at, op: "upsert", table: "flags", row: { id: "f1", session_id: "s_late", t: 0, question, state: "open" } });
    expect(applyChange(b.db, G, flag(10, "new"), "dev_a")).toBe("deferred");
    expect(applyChange(b.db, G, flag(5, "old"), "dev_a")).toBe("deferred");
    expect(b.db.get<{ body: string }>("SELECT body FROM sync_pending")?.body).toContain('"new"');
    expect(applyChange(b.db, G, { v: 1, id: "del_000000000000000", at: 20, op: "delete", table: "sessions", row_id: "s_late" }, "dev_a")).toBe("applied");
    expect(count(b, "sync_pending")).toBe(0);
  });
  it("waiting changes are capped per group", () => {
    const b = device("b");
    for (let i = 0; i < MAX_PENDING + 5; i += 1) {
      const flag: SyncChange = { v: 1, id: `flg_${String(i).padStart(16, "0")}`, at: i, op: "upsert", table: "flags", row: { id: `f${i}`, session_id: "missing_session", t: 0, question: "", state: "open" } };
      applyChange(b.db, G, flag, "dev_a");
    }
    expect(count(b, "sync_pending")).toBe(MAX_PENDING);
    expect(b.db.get<{ at: number }>("SELECT min(at) AS at FROM sync_pending")?.at).toBe(5);
  });
  it("last seq only moves forward", () => {
    const { db } = device("a");
    setLastSeq(db, G, 9, 1);
    setLastSeq(db, G, 4, 2);
    expect(lastSeq(db, G)).toBe(9);
  });
});

describe("flags on a page (card 4)", () => {
  // A pages session with one page, and a flag made on that page, on device a.
  function pageFlag() {
    const a = device("a");
    const pages = startPagesSession(a.db, a.deps, a.space.id, "Pages");
    const [page] = addPages(a.db, a.deps, pages.id, ["p.jpg"]);
    askLater(a.db, a.deps, pages.id, 0, "osmosis", page);
    const changes = send(a);
    return { a, page: page!, session: one(changes, "upsert", "sessions"), capture: one(changes, "upsert", "captures"), flag: one(changes, "upsert", "flags") };
  }

  it("a flag with a page waits for the page and lands with it", () => {
    const { flag, page, session, capture } = pageFlag();
    const b = device("b");
    expect(applyChange(b.db, G, flag, "dev_a")).toBe("deferred");
    applyChange(b.db, G, session, "dev_a");
    applyChange(b.db, G, capture, "dev_a");
    expect(b.db.get<{ capture_id: string | null }>("SELECT capture_id FROM flags")?.capture_id).toBe(page);
    expect(count(b, "sync_pending")).toBe(0);
  });

  it("a flag from an app version before capture_id keeps this iPhone's page", () => {
    const { flag, page, session, capture } = pageFlag();
    const b = device("b");
    applyChange(b.db, G, session, "dev_a");
    applyChange(b.db, G, capture, "dev_a");
    applyChange(b.db, G, flag, "dev_a");
    const { capture_id: _omitted, ...rest } = flag.row;
    expect(applyChange(b.db, G, { ...flag, at: flag.at + 1, row: { ...rest, question: "Edited" } }, "dev_a")).toBe("applied");
    expect(b.db.get<{ question: string; capture_id: string | null }>("SELECT question, capture_id FROM flags")).toEqual({ question: "Edited", capture_id: page });
  });

  it("a flag whose page was deleted here lands with no page", () => {
    const { flag, session, capture } = pageFlag();
    const b = device("b");
    applyChange(b.db, G, session, "dev_a");
    applyChange(b.db, G, capture, "dev_a");
    b.db.run("DELETE FROM captures");
    expect(applyChange(b.db, G, flag, "dev_a")).toBe("applied");
    expect(b.db.get<{ capture_id: string | null }>("SELECT capture_id FROM flags")?.capture_id).toBeNull();
  });
});

describe("line marks and notes (Next 1)", () => {
  const indexedAt = (d: Device, id: string) => d.db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = ?", [id])?.indexed_at;
  function markAndNote(d: Device, sessionId: string): void {
    d.db.run("INSERT INTO line_marks (id, session_id, t_start, text, updated_at) VALUES (?, ?, 0, 'cells divide', 1)", [`${sessionId}:0`, sessionId]);
    d.db.run("INSERT INTO notes (id, session_id, t, text, quote, created_at) VALUES ('n_1', ?, 5, 'check this', 'cells', 1)", [sessionId]);
  }

  it("a mark and a note are queued after their session, with every shared column; deleting a mark is queued", () => {
    const a = device("a");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    markAndNote(a, s.id);
    const changes = send(a);
    expect(changes[0]).toMatchObject({ op: "upsert", table: "sessions" });
    const mark = one(changes, "upsert", "line_marks");
    expect(Object.keys(mark.row).sort()).toEqual([...SYNC_COLUMNS.line_marks].sort());
    const note = one(changes, "upsert", "notes");
    expect(Object.keys(note.row).sort()).toEqual([...SYNC_COLUMNS.notes].sort());
    a.db.run("DELETE FROM line_marks");
    expect(one(send(a), "delete", "line_marks").table).toBe("line_marks");
  });

  it("applied on b, a mark clears b's search index and a note does not", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, s.id, { tStart: 0, tEnd: 10, text: "cells" });
    markAndNote(a, s.id);
    const changes = send(a);
    expect(applyChange(b.db, G, one(changes, "upsert", "sessions"), "dev_a")).toBe("applied");
    expect(applyChange(b.db, G, one(changes, "segments"), "dev_a")).toBe("applied");
    b.db.run("UPDATE sessions SET indexed_at = 5 WHERE id = ?", [s.id]);
    expect(applyChange(b.db, G, one(changes, "upsert", "notes"), "dev_a")).toBe("applied");
    expect(indexedAt(b, s.id)).toBe(5);
    expect(applyChange(b.db, G, one(changes, "upsert", "line_marks"), "dev_a")).toBe("applied");
    expect(indexedAt(b, s.id)).toBeNull();
    expect(count(b, "notes")).toBe(1);
    expect(count(b, "line_marks")).toBe(1);

    b.db.run("UPDATE sessions SET indexed_at = 5 WHERE id = ?", [s.id]);
    a.db.run("DELETE FROM line_marks");
    expect(applyChange(b.db, G, one(send(a), "delete", "line_marks"), "dev_a")).toBe("applied");
    expect(indexedAt(b, s.id)).toBeNull();
    expect(count(b, "line_marks")).toBe(0);
  });

  it("a mark that arrives before its session waits in sync_pending and lands with the session", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    markAndNote(a, s.id);
    const changes = send(a);
    expect(applyChange(b.db, G, one(changes, "upsert", "line_marks"), "dev_a")).toBe("deferred");
    expect(count(b, "sync_pending")).toBe(1);
    expect(applyChange(b.db, G, one(changes, "upsert", "sessions"), "dev_a")).toBe("applied");
    expect(count(b, "line_marks")).toBe(1);
    expect(count(b, "sync_pending")).toBe(0);
  });

  it("markMoved queues the session's marks and notes again", () => {
    const a = device("a");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    markAndNote(a, s.id);
    send(a);
    markMoved(a.db, s.id, null);
    const again = send(a);
    expect(again.some((c) => c.op === "upsert" && c.table === "line_marks")).toBe(true);
    expect(again.some((c) => c.op === "upsert" && c.table === "notes")).toBe(true);
  });

  it("a received mark is applied only when its id is its session and start time", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    markAndNote(a, s.id);
    const changes = send(a);
    applyChange(b.db, G, one(changes, "upsert", "sessions"), "dev_a");
    const mark = one(changes, "upsert", "line_marks");
    expect(applyChange(b.db, G, { ...mark, at: mark.at + 1, row: { ...mark.row, id: "other:0" } }, "dev_a")).toBe("rejected");
    expect(count(b, "line_marks")).toBe(0);
    expect(applyChange(b.db, G, mark, "dev_a")).toBe("applied");
    expect(count(b, "line_marks")).toBe(1);
  });

  it("applying a received mark and its session queues nothing in dirty", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    markAndNote(a, s.id);
    const changes = send(a);
    expect(applyChange(b.db, G, one(changes, "upsert", "sessions"), "dev_a")).toBe("applied");
    expect(applyChange(b.db, G, one(changes, "upsert", "line_marks"), "dev_a")).toBe("applied");
    expect(count(b, "line_marks")).toBe(1);
    expect(count(b, "dirty")).toBe(0);
  });

  it("a delete for a mark whose session is in another space is rejected and keeps the row", () => {
    const b = device("b");
    const other = createSpace(b.db, b.deps, "Chemistry");
    const s = startRecordingSession(b.db, b.deps, other.id, true);
    b.db.run("INSERT INTO line_marks (id, session_id, t_start, text, updated_at) VALUES (?, ?, 0, 'acid', 1)", [`${s.id}:0`, s.id]);
    const deletion = SyncChangeSchema.parse({ v: 1, id: "chg_0123456789abcdef", at: 9_000, op: "delete", table: "line_marks", row_id: `${s.id}:0` });
    expect(applyChange(b.db, G, deletion, "dev_a")).toBe("rejected");
    expect(count(b, "line_marks")).toBe(1);
  });

  it("a mark with hidden 3 is rejected and leaves nothing behind", () => {
    const a = device("a");
    const b = device("b");
    const s = startRecordingSession(a.db, a.deps, a.space.id, true);
    markAndNote(a, s.id);
    const changes = send(a);
    applyChange(b.db, G, one(changes, "upsert", "sessions"), "dev_a");
    const mark = one(changes, "upsert", "line_marks");
    expect(applyChange(b.db, G, { ...mark, at: mark.at + 1, row: { ...mark.row, hidden: 3 } }, "dev_a")).toBe("rejected");
    expect(count(b, "line_marks")).toBe(0);
    expect(b.db.get<{ n: number }>("SELECT count(*) AS n FROM row_versions WHERE table_name = 'line_marks'")?.n).toBe(0);
  });
});
