import { describe, expect, test } from "vitest";
import { createTestStore } from "./helpers/sql.ts";
import { createRoomStore, type NewChange } from "../src/room/store.ts";

const MAX_BYTES = 1_048_576;

function change(overrides: Partial<NewChange> = {}): NewChange {
  return {
    device_id: "device-a",
    key_version: 1,
    kind: "note",
    locked_bytes: new Uint8Array([1, 2, 3]).buffer,
    blob_key: null,
    ...overrides,
  };
}

// Number of rows currently in the changes table.
function rowCount(store: ReturnType<typeof createTestStore>): unknown {
  return store.sql.exec("SELECT COUNT(*) AS n FROM changes").toArray()[0]?.n;
}

// A room with one good change already stored, so a rejected append must leave exactly one row.
function seeded() {
  const store = createTestStore();
  const room = createRoomStore(store);
  room.append(change(), 1);
  return { store, room };
}

// Appends a change whose fields may have the wrong runtime type.
function appendRaw(room: ReturnType<typeof createRoomStore>, overrides: Record<string, unknown>) {
  const bad: Record<string, unknown> = { ...change(), ...overrides };
  return Reflect.apply(room.append, room, [bad, 2]);
}

describe("append and after", () => {
  test("the first append gets seq 1 and the next gets seq 2", () => {
    const room = createRoomStore(createTestStore());
    expect(room.append(change(), 1000)).toEqual({ seq: 1 });
    expect(room.append(change(), 1001)).toEqual({ seq: 2 });
  });

  test("bytes come back byte-for-byte equal", () => {
    const room = createRoomStore(createTestStore());
    const sent = new Uint8Array([0, 255, 17, 128, 0]).buffer;
    room.append(change({ locked_bytes: sent }), 1000);
    const [row] = room.after(0, 10).changes;
    expect(row?.locked_bytes).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(row?.locked_bytes ?? new ArrayBuffer(0))).toEqual(new Uint8Array(sent));
  });

  test("blob_key comes back null when unset and as given when set", () => {
    const room = createRoomStore(createTestStore());
    room.append(change({ blob_key: null }), 1000);
    room.append(change({ blob_key: "blobs/abc" }), 1001);
    const { changes } = room.after(0, 10);
    expect(changes.map((c) => c.blob_key)).toEqual([null, "blobs/abc"]);
    expect(changes.map((c) => c.at)).toEqual([1000, 1001]);
  });

  test("after(0, 2) on 3 changes gives seq 1 and 2 with last_seq 3", () => {
    const room = createRoomStore(createTestStore());
    room.append(change(), 1);
    room.append(change(), 2);
    room.append(change(), 3);
    const result = room.after(0, 2);
    expect(result.changes.map((c) => c.seq)).toEqual([1, 2]);
    expect(result.last_seq).toBe(3);
  });

  test("after(3, 10) on 3 changes gives none", () => {
    const room = createRoomStore(createTestStore());
    room.append(change(), 1);
    room.append(change(), 2);
    room.append(change(), 3);
    expect(room.after(3, 10)).toEqual({ changes: [], last_seq: 3 });
  });

  test("after on an empty room gives none with last_seq 0", () => {
    const room = createRoomStore(createTestStore());
    expect(room.after(0, 10)).toEqual({ changes: [], last_seq: 0 });
  });

  test.each([
    ["seq is negative", -1],
    ["seq is not an integer", 1.5],
    ["seq is NaN", Number.NaN],
    ["seq is above the safe integer range", Number.MAX_SAFE_INTEGER + 1],
  ])("after throws RangeError when %s", (_, seq) => {
    const room = createRoomStore(createTestStore());
    expect(() => room.after(seq, 10)).toThrow(RangeError);
  });

  test.each([
    ["limit is 0", 0],
    ["limit is 501", 501],
    ["limit is not an integer", 2.5],
    ["limit is NaN", Number.NaN],
  ])("after throws RangeError when %s", (_, limit) => {
    const room = createRoomStore(createTestStore());
    expect(() => room.after(0, limit)).toThrow(RangeError);
  });

  test("after accepts limit 500", () => {
    const room = createRoomStore(createTestStore());
    room.append(change(), 1);
    expect(room.after(0, 500).changes).toHaveLength(1);
  });
});

describe("append checks", () => {
  test.each([
    ["an empty device_id", ""],
    ["a device_id of 129 characters", "a".repeat(129)],
    ["a device_id with a space", "device a"],
    ["a device_id with a dot", "device.a"],
  ])("rejects %s", (_, device_id) => {
    const { store, room } = seeded();
    expect(() => room.append(change({ device_id }), 2)).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test.each([
    ["a device_id of 128 characters", "a".repeat(128)],
    ["a device_id with _, : and -", "A_b:c-d"],
  ])("accepts %s", (_, device_id) => {
    const room = createRoomStore(createTestStore());
    expect(room.append(change({ device_id }), 1)).toEqual({ seq: 1 });
  });

  test.each([
    ["a number", 5],
    ["undefined", undefined],
  ])("rejects a device_id that is %s", (_, device_id) => {
    const { store, room } = seeded();
    expect(() => appendRaw(room, { device_id })).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test.each([
    ["key_version 0", 0],
    ["key_version 1.5", 1.5],
    ["key_version NaN", Number.NaN],
    ["key_version above the safe integer range", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s", (_, key_version) => {
    const { store, room } = seeded();
    expect(() => room.append(change({ key_version }), 2)).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test.each([
    ["a string", "1"],
    ["undefined", undefined],
  ])("rejects a key_version that is %s", (_, key_version) => {
    const { store, room } = seeded();
    expect(() => appendRaw(room, { key_version })).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test.each([
    ["an empty kind", ""],
    ["a kind with an uppercase letter", "Note"],
    ["a kind with a digit", "note2"],
    ["a kind of 33 characters", "a".repeat(33)],
  ])("rejects %s", (_, kind) => {
    const { store, room } = seeded();
    expect(() => room.append(change({ kind }), 2)).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test.each([
    ["a kind of 32 characters", "a".repeat(32)],
    ["a kind with an underscore", "a_b"],
  ])("accepts %s", (_, kind) => {
    const room = createRoomStore(createTestStore());
    expect(room.append(change({ kind }), 1)).toEqual({ seq: 1 });
  });

  test.each([
    ["a number", 5],
    ["undefined", undefined],
  ])("rejects a kind that is %s", (_, kind) => {
    const { store, room } = seeded();
    expect(() => appendRaw(room, { kind })).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test("rejects 0 bytes", () => {
    const { store, room } = seeded();
    expect(() => room.append(change({ locked_bytes: new ArrayBuffer(0) }), 2)).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test("accepts exactly 1,048,576 bytes", () => {
    const room = createRoomStore(createTestStore());
    expect(room.append(change({ locked_bytes: new ArrayBuffer(MAX_BYTES) }), 1)).toEqual({ seq: 1 });
  });

  test("rejects 1,048,577 bytes", () => {
    const { store, room } = seeded();
    expect(() => room.append(change({ locked_bytes: new ArrayBuffer(MAX_BYTES + 1) }), 2)).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test.each([
    ["a Uint8Array", new Uint8Array([1, 2, 3])],
    ["a DataView", new DataView(new ArrayBuffer(3))],
    ["a SharedArrayBuffer", new SharedArrayBuffer(3)],
    ["null", null],
    ["undefined", undefined],
  ])("rejects locked_bytes that is %s", (_, locked_bytes) => {
    const { store, room } = seeded();
    expect(() => appendRaw(room, { locked_bytes })).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test("rejects an empty blob_key", () => {
    const { store, room } = seeded();
    expect(() => room.append(change({ blob_key: "" }), 2)).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test.each([
    ["a number", 5],
    ["undefined", undefined],
  ])("rejects a blob_key that is %s", (_, blob_key) => {
    const { store, room } = seeded();
    expect(() => appendRaw(room, { blob_key })).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test("accepts a blob_key of 512 characters", () => {
    const room = createRoomStore(createTestStore());
    expect(room.append(change({ blob_key: "k".repeat(512) }), 1)).toEqual({ seq: 1 });
  });

  test("rejects a blob_key of 513 characters", () => {
    const { store, room } = seeded();
    expect(() => room.append(change({ blob_key: "k".repeat(513) }), 2)).toThrow(RangeError);
    expect(rowCount(store)).toBe(1);
  });

  test("a failed append does not use up a seq", () => {
    const room = createRoomStore(createTestStore());
    expect(room.append(change(), 1)).toEqual({ seq: 1 });
    expect(() => room.append(change({ kind: "Bad" }), 2)).toThrow(RangeError);
    expect(room.append(change(), 3)).toEqual({ seq: 2 });
  });
});

describe("ack", () => {
  function cursor(store: ReturnType<typeof createTestStore>, deviceId: string) {
    return store.sql
      .exec("SELECT last_seq, seen_at FROM cursors WHERE device_id = ?", deviceId)
      .toArray()[0];
  }

  test("keeps the larger of the stored and the given seq", () => {
    const store = createTestStore();
    const room = createRoomStore(store);
    room.append(change(), 1);
    room.append(change(), 2);
    room.append(change(), 3);
    room.ack("device-a", 3, 100);
    room.ack("device-a", 1, 200);
    expect(cursor(store, "device-a")?.last_seq).toBe(3);
  });

  test("moves last_seq up when the given seq is larger", () => {
    const store = createTestStore();
    const room = createRoomStore(store);
    room.append(change(), 1);
    room.append(change(), 2);
    room.ack("device-a", 1, 100);
    room.ack("device-a", 2, 200);
    expect(cursor(store, "device-a")?.last_seq).toBe(2);
  });

  test("sets seen_at to now on every ack", () => {
    const store = createTestStore();
    const room = createRoomStore(store);
    room.append(change(), 1);
    room.ack("device-a", 1, 100);
    expect(cursor(store, "device-a")?.seen_at).toBe(100);
    room.ack("device-a", 0, 2000);
    expect(cursor(store, "device-a")?.seen_at).toBe(2000);
  });

  test("accepts seq 0 in an empty room", () => {
    const store = createTestStore();
    const room = createRoomStore(store);
    room.ack("device-a", 0, 5);
    expect(cursor(store, "device-a")).toEqual({ last_seq: 0, seen_at: 5 });
  });

  test("rejects a seq above the largest seq", () => {
    const store = createTestStore();
    const room = createRoomStore(store);
    room.append(change(), 1);
    room.append(change(), 2);
    room.append(change(), 3);
    expect(() => room.ack("device-a", 4, 100)).toThrow(RangeError);
    expect(cursor(store, "device-a")).toBeUndefined();
  });

  test.each([
    ["a negative seq", -1],
    ["a non-integer seq", 1.5],
    ["a NaN seq", Number.NaN],
  ])("rejects %s", (_, seq) => {
    const room = createRoomStore(createTestStore());
    room.append(change(), 1);
    expect(() => room.ack("device-a", seq, 100)).toThrow(RangeError);
  });

  test("rejects an invalid device_id", () => {
    const room = createRoomStore(createTestStore());
    room.append(change(), 1);
    expect(() => room.ack("", 1, 100)).toThrow(RangeError);
  });

  test.each([
    ["a number", 5],
    ["undefined", undefined],
    ["null", null],
  ])("rejects a device_id that is %s", (_, deviceId) => {
    const room = createRoomStore(createTestStore());
    room.append(change(), 1);
    expect(() => Reflect.apply(room.ack, room, [deviceId, 1, 100])).toThrow(RangeError);
  });
});

describe("restart", () => {
  test("a new store on the same SqlStore continues from the last seq", () => {
    const store = createTestStore();
    const first = createRoomStore(store);
    first.append(change(), 1);
    first.append(change(), 2);
    const second = createRoomStore(store);
    expect(second.append(change(), 3)).toEqual({ seq: 3 });
    expect(second.after(0, 10).last_seq).toBe(3);
  });
});

describe("after options and page limits", () => {
  test("after(0, 10, { fromAt: T }) returns only changes appended with now >= T, in seq order; last_seq is still the largest seq", () => {
    const room = createRoomStore(createTestStore());
    room.append(change(), 1000);
    room.append(change(), 2000);
    room.append(change(), 3000);
    const result = room.after(0, 10, { fromAt: 2000 });
    expect(result.changes.map((c) => c.seq)).toEqual([2, 3]);
    expect(result.changes.map((c) => c.at)).toEqual([2000, 3000]);
    expect(result.last_seq).toBe(3);
  });

  test("after with maxBytes stops before the change that would pass it, and the first change always comes", () => {
    const room = createRoomStore(createTestStore());
    for (let i = 0; i < 3; i++) room.append(change({ locked_bytes: new Uint8Array(100).buffer }), 1000 + i);
    expect(room.after(0, 10, { maxBytes: 250 }).changes.map((c) => c.seq)).toEqual([1, 2]);
    expect(room.after(0, 10, { maxBytes: 1 }).changes.map((c) => c.seq)).toEqual([1]);
    expect(room.after(0, 10).changes.map((c) => c.seq)).toEqual([1, 2, 3]);
  });

  test("after with fromAt -1, fromAt 1.5 or maxBytes 0 throws RangeError", () => {
    const room = createRoomStore(createTestStore());
    room.append(change(), 1000);
    expect(() => room.after(0, 10, { fromAt: -1 })).toThrow(RangeError);
    expect(() => room.after(0, 10, { fromAt: 1.5 })).toThrow(RangeError);
    expect(() => room.after(0, 10, { maxBytes: 0 })).toThrow(RangeError);
  });

  test("lastSeq() is 0 for an empty room and the largest seq after appends", () => {
    const room = createRoomStore(createTestStore());
    expect(room.lastSeq()).toBe(0);
    room.append(change(), 1);
    room.append(change(), 2);
    expect(room.lastSeq()).toBe(2);
  });
});

describe("duePushes", () => {
  const T = 1_763_560_000_000;

  test("duePushes(['a','b'], T) gives both; at T+59,999 none; at T+60,000 both; a device pushed before is due only after the minute", () => {
    const room = createRoomStore(createTestStore());
    expect(room.duePushes(["a", "b"], T)).toEqual(["a", "b"]);
    expect(room.duePushes(["a", "b"], T + 59_999)).toEqual([]);
    expect(room.duePushes(["a", "b"], T + 60_000)).toEqual(["a", "b"]);
    expect(room.duePushes(["c"], T + 60_000)).toEqual(["c"]);
    expect(room.duePushes(["c", "d"], T + 60_001)).toEqual(["d"]);
  });

  test("an invalid device id throws RangeError and records nothing for the valid ids in the same call", () => {
    const room = createRoomStore(createTestStore());
    expect(() => room.duePushes(["good-id", "bad id!"], T)).toThrow(RangeError);
    expect(room.duePushes(["good-id"], T)).toEqual(["good-id"]);
  });
});
