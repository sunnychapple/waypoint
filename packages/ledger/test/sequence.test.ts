import { describe, expect, it } from "vitest";
import { apply, balancesFromLedger, emptyWallet } from "../src/index.ts";
import type { Bucket, Command, LedgerEntry, WalletState } from "../src/index.ts";

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

describe("200-step seeded sequence", () => {
  it("keeps balances non-negative and rebuilds them from the ledger", () => {
    const rand = mulberry32(20_261_116);
    const buckets: readonly Bucket[] = ["monthly", "purchased"];
    const kinds = ["grant", "hold", "settle", "release", "release_expired", "refund", "clawback", "reset"] as const;

    let state: WalletState = emptyWallet();
    let now = 1_000;
    const entries: LedgerEntry[] = [];
    let applied = 0;
    let holdsCreated = 0;
    let settled = 0;

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

      const out = apply(state, command, now);
      state = out.state;
      entries.push(...out.entries);
      applied++;
      if (command.type === "hold" && out.result.ok) holdsCreated++;
      if (command.type === "settle" && out.result.ok) settled++;

      expect(state.balances.monthly).toBeGreaterThanOrEqual(0);
      expect(state.balances.purchased).toBeGreaterThanOrEqual(0);
    }

    expect(applied).toBe(200);
    expect(holdsCreated).toBeGreaterThan(0);
    expect(settled).toBeGreaterThan(0);

    const rebuilt = balancesFromLedger(entries);
    expect(rebuilt).toEqual({ monthly: state.balances.monthly, purchased: state.balances.purchased });
  });
});
