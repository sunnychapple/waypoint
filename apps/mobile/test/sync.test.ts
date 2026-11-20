import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addFlag, addPhoto, finishRecording, savePart, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { createSpace, ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { saveCards } from "../src/core/study/cards.ts";
import {
  applyChange,
  applyPulled,
  collectChanges,
  lastSeq,
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
    expect(one(send(b), "upsert", "sessions").at).toBe(900_001);
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
