import { describe, expect, it } from "vitest";
import { apply, balancesFromLedger, emptyWallet } from "../src/index.ts";
import type { LedgerEntry } from "../src/index.ts";

describe("emptyWallet", () => {
  it("starts with zero balances, no reset time, no holds and no applied commands", () => {
    expect(emptyWallet()).toEqual({
      balances: { monthly: 0, purchased: 0, owed: 0, monthly_period: 0, monthly_resets_at: null },
      holds: {},
      applied: {},
    });
  });

  it("returns a new object each call", () => {
    const a = emptyWallet();
    const b = emptyWallet();
    expect(a).not.toBe(b);
    expect(a.holds).not.toBe(b.holds);
  });
});

describe("balancesFromLedger", () => {
  it("is zero for no entries", () => {
    expect(balancesFromLedger([])).toEqual({ monthly: 0, purchased: 0, owed: 0 });
  });

  it("sums signed credits per bucket", () => {
    const entries: LedgerEntry[] = [
      { id: "a:0", at: 1, user_id: null, kind: "grant", bucket: "monthly", credits: 10, ref: "r" },
      { id: "b:0", at: 1, user_id: null, kind: "grant", bucket: "purchased", credits: 7, ref: "r" },
      { id: "c:0", at: 2, user_id: "u1", kind: "hold", bucket: "monthly", credits: -4, ref: "h" },
      { id: "c:1", at: 2, user_id: "u1", kind: "hold", bucket: "purchased", credits: -1, ref: "h" },
      { id: "d:0", at: 3, user_id: null, kind: "clawback", bucket: "purchased", credits: -2, ref: "k" },
      { id: "d:1", at: 3, user_id: null, kind: "clawback", bucket: "owed", credits: 5, ref: "k" },
    ];
    expect(balancesFromLedger(entries)).toEqual({ monthly: 6, purchased: 4, owed: 5 });
  });

  it("matches the wallet balances after a sequence of commands", () => {
    let state = emptyWallet();
    const entries: LedgerEntry[] = [];
    const steps = [
      { type: "grant" as const, id: "g1", bucket: "monthly" as const, credits: 20, ref: "plus" },
      { type: "grant" as const, id: "g2", bucket: "purchased" as const, credits: 6, ref: "pack" },
      { type: "hold" as const, id: "h1", hold_id: "H1", user_id: "u1", task: "explain", credits: 23, expires_at: 9_000 },
      { type: "settle" as const, id: "s1", hold_id: "H1", actual: 5 },
      { type: "reset" as const, id: "m1", credits: 12, resets_at: 99_000 },
    ];
    for (const command of steps) {
      const out = apply(state, command, 100);
      state = out.state;
      entries.push(...out.entries);
    }
    expect(balancesFromLedger(entries)).toEqual({
      monthly: state.balances.monthly,
      purchased: state.balances.purchased,
      owed: state.balances.owed,
    });
  });
});
