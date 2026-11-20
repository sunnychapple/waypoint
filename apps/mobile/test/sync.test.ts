import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addFlag, addPhoto, finishRecording, savePart, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { moveSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { createSpace, ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { saveCards } from "../src/core/study/cards.ts";
import {
  applyChange,
  applyPulled,
  collectChanges,
  lastSeq,
  markMoved,
  MAX_CHANGE_BYTES,
  MAX_PENDING,
  nextOutgoing,
  sent,
  setLastSeq,
  type SyncChange,
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
    expect(applyChange(b.db, G, one(changes, "segments"), "dev_a")).toBe("applied");
    expect(b.db.get("SELECT space_id, title FROM sessions WHERE id = ?", [s.id])).toEqual({ space_id: b.space.id, title: "New recording" });
    expect(b.db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = ?", [s.id])?.text).toBe("cells");
    expect(count(b, "dirty")).toBe(0);
    expect(applyChange(b.db, G, session, "dev_a")).toBe("older");
    expect(applyChange(b.db, G, { ...session, at: session.at + 5, row: { ...session.row, title: "Mitosis" } }, "dev_a")).toBe("applied");
    expect(title(b, s.id)).toBe("Mitosis");
    expect(applyChange(b.db, "grp_unknown_0000000", session, "dev_a")).toBe("rejected");
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
