import { describe, expect, test } from "vitest";
import { createTestStore } from "./helpers/sql.ts";
import { fakeHost } from "./helpers/room.ts";
import { createRoomStore, type NewChange } from "../src/room/store.ts";
import {
  appendAndNotify,
  broadcastChanged,
  closeTagged,
  handleSocketMessage,
  parseAck,
  type RoomSocket,
  type SocketHost,
} from "../src/room/sockets.ts";

// Compile-time checks: the Durable Object's state and sockets must fit the plain-code types.
export const hostFits: (state: DurableObjectState) => SocketHost = (state) => state;
export const socketFits: (ws: WebSocket) => RoomSocket = (ws) => ws;

const NOW = 1_763_560_000_000;
const CHANGED_5 = '{"type":"changed","last_seq":5}';

function change(overrides: Partial<NewChange> = {}): NewChange {
  return {
    device_id: "writer-device",
    key_version: 1,
    kind: "note",
    locked_bytes: new Uint8Array([1, 2, 3]).buffer,
    blob_key: null,
    ...overrides,
  };
}

describe("compile-time fits", () => {
  test("the fitting functions are defined", () => {
    expect(typeof hostFits).toBe("function");
    expect(typeof socketFits).toBe("function");
  });
});

describe("broadcastChanged", () => {
  test("sockets of two other devices each get exactly the changed notice; the writer device's sockets get nothing", () => {
    const host = fakeHost();
    const w1 = host.connect(["device:writer-device", "user:u1"]);
    const w2 = host.connect(["device:writer-device", "user:u1"]);
    const o1 = host.connect(["device:d1", "user:u2"]);
    const o2 = host.connect(["device:d2", "user:u3"]);
    broadcastChanged(host, 5, "writer-device", NOW);
    expect(o1.sent).toEqual([CHANGED_5]);
    expect(o2.sent).toEqual([CHANGED_5]);
    expect(w1.sent).toEqual([]);
    expect(w2.sent).toEqual([]);
  });

  test("a socket whose membership ended at now is closed with 4003 and sent nothing; later ends and never get the notice", () => {
    const host = fakeHost();
    const ended = host.connect(["device:d1", `until:${NOW}`]);
    const later = host.connect(["device:d2", `until:${NOW + 1}`]);
    const never = host.connect(["device:d3", "until:never"]);
    broadcastChanged(host, 5, "writer-device", NOW);
    expect(ended.closed).toEqual({ code: 4003, reason: "membership ended" });
    expect(ended.sent).toEqual([]);
    expect(later.sent).toEqual([CHANGED_5]);
    expect(never.sent).toEqual([CHANGED_5]);
  });

  test("a socket whose send throws does not stop the others", () => {
    const host = fakeHost();
    const broken = host.connect(["device:d1"]);
    broken.send = () => {
      throw new Error("socket is closing");
    };
    const fine = host.connect(["device:d2"]);
    broadcastChanged(host, 5, "writer-device", NOW);
    expect(fine.sent).toEqual([CHANGED_5]);
  });
});

describe("appendAndNotify", () => {
  test("stores the change as seq 1, broadcasts it, and returns as push only the targets with no open socket", () => {
    const room = createRoomStore(createTestStore());
    const host = fakeHost();
    const open = host.connect(["device:d-open", "user:u2"]);
    const targets = [
      { id: "d-open", user_id: "u2" },
      { id: "d-off", user_id: "u3" },
    ];
    const result = appendAndNotify(room, host, change(), targets, NOW);
    expect(result).toEqual({ seq: 1, push: [{ id: "d-off", user_id: "u3" }] });
    expect(room.after(0, 10).changes.map((c) => c.seq)).toEqual([1]);
    expect(open.sent).toEqual(['{"type":"changed","last_seq":1}']);
  });

  test("a second append within a minute returns no push; after 60,000 ms the offline target is returned again", () => {
    const room = createRoomStore(createTestStore());
    const host = fakeHost();
    const targets = [{ id: "d-off", user_id: "u3" }];
    expect(appendAndNotify(room, host, change(), targets, NOW).push).toEqual(targets);
    expect(appendAndNotify(room, host, change(), targets, NOW + 1_000).push).toEqual([]);
    expect(appendAndNotify(room, host, change(), targets, NOW + 60_000).push).toEqual(targets);
  });

  test("a target with an open socket is not pushed, also when the next append comes more than a minute later", () => {
    const room = createRoomStore(createTestStore());
    const host = fakeHost();
    host.connect(["device:d-open", "user:u2"]);
    const targets = [{ id: "d-open", user_id: "u2" }];
    expect(appendAndNotify(room, host, change(), targets, NOW).push).toEqual([]);
    expect(appendAndNotify(room, host, change(), targets, NOW + 120_000).push).toEqual([]);
  });
});

describe("parseAck", () => {
  test("{\"type\":\"ack\",\"seq\":3} gives 3; seq -1, 1.5, \"3\", an extra key, another type, invalid JSON, an ArrayBuffer and a 201-character string give null", () => {
    const json = '{"type":"ack","seq":3}';
    expect(parseAck(json)).toBe(3);
    expect(parseAck('{"type":"ack","seq":-1}')).toBeNull();
    expect(parseAck('{"type":"ack","seq":1.5}')).toBeNull();
    expect(parseAck('{"type":"ack","seq":"3"}')).toBeNull();
    expect(parseAck('{"type":"ack","seq":3,"extra":true}')).toBeNull();
    expect(parseAck('{"type":"nack","seq":3}')).toBeNull();
    expect(parseAck("{not json")).toBeNull();
    expect(parseAck(new ArrayBuffer(4))).toBeNull();
    expect(parseAck(json + " ".repeat(201 - json.length))).toBeNull();
  });
});

describe("handleSocketMessage", () => {
  test("an ack from a socket tagged device:d1 sets d1's cursor", () => {
    const store = createTestStore();
    const room = createRoomStore(store);
    for (let i = 0; i < 3; i++) room.append(change(), NOW + i);
    const host = fakeHost();
    const ws = host.connect(["device:d1"]);
    handleSocketMessage(room, host, ws, '{"type":"ack","seq":2}', NOW);
    expect(store.sql.exec("SELECT last_seq FROM cursors WHERE device_id = ?", "d1").toArray()).toEqual([{ last_seq: 2 }]);
  });

  test("an ack above the room's last seq sets the cursor to the last seq", () => {
    const store = createTestStore();
    const room = createRoomStore(store);
    for (let i = 0; i < 3; i++) room.append(change(), NOW + i);
    const host = fakeHost();
    const ws = host.connect(["device:d1"]);
    handleSocketMessage(room, host, ws, '{"type":"ack","seq":9}', NOW);
    expect(store.sql.exec("SELECT last_seq FROM cursors WHERE device_id = ?", "d1").toArray()).toEqual([{ last_seq: 3 }]);
  });

  test("a bad message closes the socket with 1003 and changes no cursor", () => {
    const store = createTestStore();
    const room = createRoomStore(store);
    room.append(change(), NOW);
    const host = fakeHost();
    const ws = host.connect(["device:d1"]);
    handleSocketMessage(room, host, ws, '{"type":"hello"}', NOW);
    expect(ws.closed).toEqual({ code: 1003, reason: "unsupported message" });
    expect(store.sql.exec("SELECT COUNT(*) AS n FROM cursors").toArray()).toEqual([{ n: 0 }]);
  });
});

describe("closeTagged", () => {
  test("closes only the sockets with that tag", () => {
    const host = fakeHost();
    const a = host.connect(["device:d1"]);
    const b = host.connect(["device:d2"]);
    closeTagged(host, "device:d1", 4000, "replaced by a newer connection");
    expect(a.closed).toEqual({ code: 4000, reason: "replaced by a newer connection" });
    expect(b.closed).toBeNull();
  });
});
