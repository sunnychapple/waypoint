import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.ts";
import {
  appendAndNotify,
  changedMessage,
  CLOSE_MEMBERSHIP_ENDED,
  CLOSE_REPLACED,
  closeTagged,
  deviceTag,
  handleSocketMessage,
  ROOM_DEVICE_HEADER,
  ROOM_UNTIL_HEADER,
  ROOM_USER_HEADER,
  untilTag,
  userTag,
  type PushTarget,
  type RoomStore,
} from "./sockets.ts";
import { createRoomStore, type AfterOptions, type Change, type NewChange } from "./store.ts";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const UNTIL = /^(never|\d{1,16})$/;

export class GroupRoom extends DurableObject<Env> {
  private room!: RoomStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = createRoomStore(ctx.storage);
    });
    // Answered by the runtime without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  append(change: NewChange, targets: PushTarget[]): { seq: number; push: PushTarget[] } {
    return appendAndNotify(this.room, this.ctx, change, targets, Date.now());
  }

  after(seq: number, limit: number, options: AfterOptions): { changes: Change[]; last_seq: number } {
    return this.room.after(seq, limit, options);
  }

  ack(deviceId: string, seq: number): void {
    this.room.ack(deviceId, seq, Date.now());
  }

  // Closes every socket of a user whose membership just ended.
  disconnect(userId: string): void {
    closeTagged(this.ctx, userTag(userId), CLOSE_MEMBERSHIP_ENDED, "membership ended");
  }

  // Only the API Worker calls this, after it has checked the session, the membership and the device.
  override async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get(ROOM_USER_HEADER) ?? "";
    const deviceId = request.headers.get(ROOM_DEVICE_HEADER) ?? "";
    const until = request.headers.get(ROOM_UNTIL_HEADER) ?? "";
    if (request.headers.get("Upgrade") !== "websocket" || !ID.test(userId) || !ID.test(deviceId) || !UNTIL.test(until)) {
      return new Response(null, { status: 400 });
    }
    closeTagged(this.ctx, deviceTag(deviceId), CLOSE_REPLACED, "replaced by a newer connection");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [deviceTag(deviceId), userTag(userId), untilTag(until === "never" ? null : Number(until))]);
    server.send(changedMessage(this.room.lastSeq()));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    handleSocketMessage(this.room, this.ctx, ws, message, Date.now());
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Answer the client's close frame. 1005 and 1006 cannot be sent back.
    try {
      if (code === 1005 || code === 1006) ws.close();
      else ws.close(code, reason);
    } catch {
      // already closed
    }
  }
}
