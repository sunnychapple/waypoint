import type { createRoomStore, NewChange } from "./store.ts";

// The live side of a group room: hibernating WebSockets that are only told "something changed" (never content),
// and pushes for devices that are not connected. Plain code, tested in Node with fake sockets; object.ts wires it
// to the Durable Object's state.

export type RoomStore = ReturnType<typeof createRoomStore>;

// The parts of a WebSocket and of DurableObjectState this module uses. WebSocket and DurableObjectState satisfy them.
export type RoomSocket = { send(message: string): void; close(code?: number, reason?: string): void };
export type SocketHost = { getWebSockets(tag?: string): RoomSocket[]; getTags(ws: RoomSocket): string[] };

// A device that should hear about a new change: an approved device of an active member (not the writer).
export type PushTarget = { id: string; user_id: string };

// Set by the API Worker on the request it forwards to the room; the room is reachable only through its binding.
export const ROOM_USER_HEADER = "Waypoint-Room-User";
export const ROOM_DEVICE_HEADER = "Waypoint-Room-Device";
// The membership's end (Unix ms), or "never".
export const ROOM_UNTIL_HEADER = "Waypoint-Room-Until";

export const CLOSE_REPLACED = 4000;
export const CLOSE_MEMBERSHIP_ENDED = 4003;
export const CLOSE_UNSUPPORTED = 1003;

export const deviceTag = (deviceId: string): string => `device:${deviceId}`;
export const userTag = (userId: string): string => `user:${userId}`;
export const untilTag = (until: number | null): string => `until:${until === null ? "never" : String(until)}`;

export function changedMessage(lastSeq: number): string {
  return JSON.stringify({ type: "changed", last_seq: lastSeq });
}

function closeQuietly(ws: RoomSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closing
  }
}

export function closeTagged(host: SocketHost, tag: string, code: number, reason: string): void {
  for (const ws of host.getWebSockets(tag)) closeQuietly(ws, code, reason);
}

function endedAt(host: SocketHost, ws: RoomSocket): number | null {
  const tag = host.getTags(ws).find((t) => t.startsWith("until:"));
  if (tag === undefined || tag === "until:never") return null;
  const value = Number(tag.slice("until:".length));
  return Number.isSafeInteger(value) ? value : 0;
}

// Tells every socket except the writer device's that the room's last seq moved. A socket whose membership end has
// passed is closed instead.
export function broadcastChanged(host: SocketHost, lastSeq: number, writerDeviceId: string, now: number): void {
  const writer = new Set(host.getWebSockets(deviceTag(writerDeviceId)));
  const message = changedMessage(lastSeq);
  for (const ws of host.getWebSockets()) {
    if (writer.has(ws)) continue;
    const until = endedAt(host, ws);
    if (until !== null && until <= now) {
      closeQuietly(ws, CLOSE_MEMBERSHIP_ENDED, "membership ended");
      continue;
    }
    try {
      ws.send(message);
    } catch {
      // a socket that is closing misses this notice; the app catches up when it reconnects
    }
  }
}

// Appends the change, tells connected devices, and returns the devices to push: targets with no open socket that
// were not pushed in the last minute.
export function appendAndNotify(
  room: RoomStore,
  host: SocketHost,
  change: NewChange,
  targets: PushTarget[],
  now: number,
): { seq: number; push: PushTarget[] } {
  const { seq } = room.append(change, now);
  broadcastChanged(host, seq, change.device_id, now);
  const offline = targets.filter((t) => host.getWebSockets(deviceTag(t.id)).length === 0);
  const due = new Set(room.duePushes(offline.map((t) => t.id), now));
  return { seq, push: offline.filter((t) => due.has(t.id)) };
}

// The only message a client sends: { "type": "ack", "seq": n }. Anything else gives null.
export function parseAck(message: string | ArrayBuffer): number | null {
  if (typeof message !== "string" || message.length > 200) return null;
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 2) return null;
  const { type, seq } = value as { type?: unknown; seq?: unknown };
  if (type !== "ack" || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) return null;
  return seq;
}

// Records an ack from the socket's device; a seq above the room's last is lowered to it. A socket without a device
// tag, or a message that is not an ack, closes the socket.
export function handleSocketMessage(room: RoomStore, host: SocketHost, ws: RoomSocket, message: string | ArrayBuffer, now: number): void {
  const seq = parseAck(message);
  const tag = host.getTags(ws).find((t) => t.startsWith("device:"));
  if (seq === null || tag === undefined) {
    closeQuietly(ws, CLOSE_UNSUPPORTED, "unsupported message");
    return;
  }
  room.ack(tag.slice("device:".length), Math.min(seq, room.lastSeq()), now);
}
