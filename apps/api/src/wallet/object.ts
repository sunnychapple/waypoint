import { DurableObject } from "cloudflare:workers";
import type { Command, CommandResult, LedgerEntry } from "@waypoint/ledger";
import type { Env } from "../env.ts";
import { createWalletStore, type WalletView } from "./store.ts";

export class Wallet extends DurableObject<Env> {
  private wallet!: ReturnType<typeof createWalletStore>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.wallet = createWalletStore(ctx.storage);
    });
  }

  async apply(command: Command): Promise<CommandResult> {
    const result = this.wallet.apply(command, Date.now());
    const next = this.wallet.nextExpiry();
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
    return result;
  }

  async read(): Promise<WalletView> {
    return this.wallet.read();
  }

  async ledger(after: number, limit: number): Promise<{ entries: LedgerEntry[]; next: number }> {
    return this.wallet.ledger(after, limit);
  }

  override async alarm(): Promise<void> {
    this.wallet.apply({ type: "release_expired", id: `expire-${crypto.randomUUID()}` }, Date.now());
    const next = this.wallet.nextExpiry();
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
  }
}
