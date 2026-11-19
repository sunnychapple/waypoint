import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.ts";
import { createRoomStore, type Change, type NewChange } from "./store.ts";

export class GroupRoom extends DurableObject<Env> {
  private room!: ReturnType<typeof createRoomStore>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = createRoomStore(ctx.storage);
    });
  }

  append(change: NewChange): { seq: number } {
    return this.room.append(change, Date.now());
  }

  after(seq: number, limit: number): { changes: Change[]; last_seq: number } {
    return this.room.after(seq, limit);
  }

  ack(deviceId: string, seq: number): void {
    this.room.ack(deviceId, seq, Date.now());
  }
}
