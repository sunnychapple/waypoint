import { describe, expect, it } from "vitest";
import { apply, balancesFromLedger, emptyWallet } from "../src/index.ts";
import type { Command, CommandResult, LedgerEntry, WalletBucket, WalletState } from "../src/index.ts";

// Deterministic PRNG (mulberry32). Same seed, same sequence, every run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick from empty list");
  return item;
}

// Charged and forfeited credits from a settle or release result.
function settlementOf(result: CommandResult): { charged: number; forfeited: number } {
  if (!("forfeited_monthly" in result)) throw new Error("expected a settle or release result");
  return { charged: "charged" in result ? result.charged : 0, forfeited: result.forfeited_monthly };
}

describe("200-step seeded sequence", () => {
  it("keeps balances non-negative, rebuilds them from the ledger after every step, and accounts for every hold", () => {
    const rand = mulberry32(20_261_116);
    const buckets: readonly WalletBucket[] = ["monthly", "purchased"];
    // Grants and holds appear more often, so most holds can be funded.
    const kinds: readonly Command["type"][] = [
      "grant", "grant", "grant", "hold", "hold", "hold", "settle", "settle",
      "release", "release_expired", "refund", "clawback", "reset",
    ];

    let state: WalletState = emptyWallet();
    let now = 1_000;
    const entries: LedgerEntry[] = [];
    let applied = 0;
    let holdsAttempted = 0;
    let holdsCreated = 0;
    let settledOrReleased = 0;
    let resetsWhileHeld = 0;
    let clawbacksWhileHeld = 0;
    let holdsForfeited = 0;
    let maxOwed = 0;

    for (let step = 0; step < 200; step++) {
      now += between(rand, 0, 50);
      const id = `cmd-${step}`;
      const holdIds = Object.keys(state.holds);
      let kind = pick(rand, kinds);
      if ((kind === "settle" || kind === "release") && holdIds.length === 0) kind = "grant";

      let command: Command;
      switch (kind) {
        case "grant":
          command = { type: "grant", id, bucket: pick(rand, buckets), credits: between(rand, 1, 50), ref: "seq" };
          break;
        case "hold":
          command = {
            type: "hold",
            id,
            hold_id: `H${step}`,
            user_id: "u1",
            task: "explain",
            credits: between(rand, 1, 30),
            expires_at: now + between(rand, 0, 300),
          };
          break;
        case "settle":
          command = { type: "settle", id, hold_id: pick(rand, holdIds), actual: between(rand, 0, 40) };
          break;
        case "release":
          command = { type: "release", id, hold_id: pick(rand, holdIds) };
          break;
        case "release_expired":
          command = { type: "release_expired", id };
          break;
        case "refund":
          command = { type: "refund", id, bucket: pick(rand, buckets), credits: between(rand, 1, 20), ref: "seq" };
          break;
        case "clawback":
          command = { type: "clawback", id, credits: between(rand, 1, 30), ref: "seq" };
          break;
        case "reset":
          command = { type: "reset", id, credits: between(rand, 0, 40), resets_at: now + 10_000 };
          break;
      }

      const before = state;
      const out = apply(state, command, now);
      state = out.state;
      entries.push(...out.entries);
      applied++;
      maxOwed = Math.max(maxOwed, state.balances.owed);

      if (command.type === "hold") {
        holdsAttempted++;
        if (out.result.ok) holdsCreated++;
      }
      if (command.type === "reset" && holdIds.length > 0) resetsWhileHeld++;
      if (command.type === "clawback" && holdIds.length > 0) clawbacksWhileHeld++;

      if (command.type === "settle" || command.type === "release") {
        // Each settle or release gives its hold's credits back exactly: charged, plus credits returned
        // to a bucket or paid against owed, plus the monthly credits forfeited. Nothing is lost or made.
        const hold = before.holds[command.hold_id];
        if (hold === undefined) throw new Error("settle or release of a hold that is not open");
        const { charged, forfeited } = settlementOf(out.result);
        const returned = out.entries
          .filter((e) => e.kind === command.type)
          .reduce((sum, e) => (e.bucket === "owed" ? sum - e.credits : sum + e.credits), 0);
        expect(charged + returned + forfeited).toBe(hold.credits);
        if (forfeited > 0) holdsForfeited++;
        settledOrReleased++;
      }

      expect(state.balances.monthly).toBeGreaterThanOrEqual(0);
      expect(state.balances.purchased).toBeGreaterThanOrEqual(0);
      expect(state.balances.owed).toBeGreaterThanOrEqual(0);
      expect(balancesFromLedger(entries)).toEqual({
        monthly: state.balances.monthly,
        purchased: state.balances.purchased,
        owed: state.balances.owed,
      });
    }

    expect(applied).toBe(200);
    expect(holdsAttempted).toBeGreaterThan(0);
    expect(holdsCreated * 2).toBeGreaterThanOrEqual(holdsAttempted);
    expect(settledOrReleased).toBeGreaterThan(0);
    // The sequence must reach the cases the fix is about.
    expect(resetsWhileHeld).toBeGreaterThan(0);
    expect(clawbacksWhileHeld).toBeGreaterThan(0);
    expect(holdsForfeited).toBeGreaterThan(0);
    expect(maxOwed).toBeGreaterThan(0);
  });
});
