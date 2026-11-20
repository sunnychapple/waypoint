import { appendAndNotify, closeTagged, CLOSE_MEMBERSHIP_ENDED, userTag, type PushTarget, type RoomSocket, type SocketHost } from "../../src/room/sockets.ts";
import { createRoomStore, type AfterOptions, type NewChange } from "../../src/room/store.ts";
import { createTestStore } from "./sql.ts";

// A socket stand-in: records what it was sent and how it was closed.
export type FakeSocket = RoomSocket & { tags: string[]; sent: string[]; closed: { code: number | undefined; reason: string | undefined } | null };

export type FakeHost = SocketHost & { sockets: FakeSocket[]; connect(tags: string[]): FakeSocket };

export function fakeHost(): FakeHost {
  const sockets: FakeSocket[] = [];
  const isFake = (ws: RoomSocket): ws is FakeSocket => sockets.some((s) => s === ws);
  return {
    sockets,
    connect(tags) {
      const socket: FakeSocket = {
        tags,
        sent: [],
        closed: null,
        send(message) {
          if (socket.closed !== null) throw new Error("socket closed");
          socket.sent.push(message);
        },
        close(code, reason) {
          socket.closed = { code, reason };
        },
      };
      sockets.push(socket);
      return socket;
    },
    getWebSockets(tag) {
      return sockets.filter((s) => s.closed === null && (tag === undefined || s.tags.includes(tag)));
    },
    getTags(ws) {
      return isFake(ws) ? ws.tags : [];
    },
  };
}

// Stands in for env.GROUP_ROOM: one room per name, each a real room store on createTestStore() with a fake host,
// running the same plain code as the Durable Object. fetch only records what the Worker forwarded.
export function fakeRoomNamespace(now: () => number) {
  const rooms = new Map<string, { store: ReturnType<typeof createRoomStore>; host: FakeHost; fetches: { url: string; headers: Headers }[] }>();
  const roomFor = (name: string) => {
    let room = rooms.get(name);
    if (room === undefined) {
      room = { store: createRoomStore(createTestStore()), host: fakeHost(), fetches: [] };
      rooms.set(name, room);
    }
    return room;
  };
  return {
    rooms,
    roomFor,
    idFromName: (name: string) => name,
    get: (name: string) => {
      const room = roomFor(name);
      return {
        append: async (change: NewChange, targets: PushTarget[]) => appendAndNotify(room.store, room.host, change, targets, now()),
        after: async (seq: number, limit: number, options: AfterOptions) => room.store.after(seq, limit, options),
        disconnect: async (userId: string) => closeTagged(room.host, userTag(userId), CLOSE_MEMBERSHIP_ENDED, "membership ended"),
        fetch: async (url: string, init: RequestInit) => {
          room.fetches.push({ url, headers: new Headers(init.headers) });
          return new Response("forwarded to the room");
        },
      };
    },
  };
}
