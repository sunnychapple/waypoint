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
    const room = createRoomStore(createTestStore());
    expect(() => room.append(change({ device_id }), 1)).toThrow(RangeError);
  });

  test.each([
    ["key_version 0", 0],
    ["key_version 1.5", 1.5],
    ["key_version NaN", Number.NaN],
    ["key_version above the safe integer range", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s", (_, key_version) => {
    const room = createRoomStore(createTestStore());
    expect(() => room.append(change({ key_version }), 1)).toThrow(RangeError);
  });

  test.each([
    ["an empty kind", ""],
    ["a kind with an uppercase letter", "Note"],
    ["a kind with a digit", "note2"],
    ["a kind of 33 characters", "a".repeat(33)],
  ])("rejects %s", (_, kind) => {
    const room = createRoomStore(createTestStore());
    expect(() => room.append(change({ kind }), 1)).toThrow(RangeError);
  });

  test("rejects 0 bytes", () => {
    const room = createRoomStore(createTestStore());
    expect(() => room.append(change({ locked_bytes: new ArrayBuffer(0) }), 1)).toThrow(RangeError);
  });

  test("accepts exactly 1,048,576 bytes", () => {
    const room = createRoomStore(createTestStore());
    expect(room.append(change({ locked_bytes: new ArrayBuffer(MAX_BYTES) }), 1)).toEqual({ seq: 1 });
  });

  test("rejects 1,048,577 bytes", () => {
    const room = createRoomStore(createTestStore());
    expect(() => room.append(change({ locked_bytes: new ArrayBuffer(MAX_BYTES + 1) }), 1)).toThrow(RangeError);
  });

  test("rejects an empty blob_key", () => {
    const room = createRoomStore(createTestStore());
    expect(() => room.append(change({ blob_key: "" }), 1)).toThrow(RangeError);
  });

  test("accepts a blob_key of 512 characters", () => {
    const room = createRoomStore(createTestStore());
    expect(room.append(change({ blob_key: "k".repeat(512) }), 1)).toEqual({ seq: 1 });
  });

  test("rejects a blob_key of 513 characters", () => {
    const room = createRoomStore(createTestStore());
    expect(() => room.append(change({ blob_key: "k".repeat(513) }), 1)).toThrow(RangeError);
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
