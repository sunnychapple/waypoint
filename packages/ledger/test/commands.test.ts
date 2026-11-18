import { describe, expect, it } from "vitest";
import { apply, emptyWallet } from "../src/index.ts";
import type { Command, WalletState } from "../src/index.ts";

const NOW = 1_000;

function wallet(monthly: number, purchased: number): WalletState {
  let state = emptyWallet();
  if (monthly > 0) {
    state = apply(state, { type: "grant", id: "setup-m", bucket: "monthly", credits: monthly, ref: "setup" }, 0).state;
  }
  if (purchased > 0) {
    state = apply(state, { type: "grant", id: "setup-p", bucket: "purchased", credits: purchased, ref: "setup" }, 0).state;
  }
  return state;
}

function holdCommand(id: string, holdId: string, credits: number, expiresAt = 5_000): Command {
  return { type: "hold", id, hold_id: holdId, user_id: "u1", task: "explain", credits, expires_at: expiresAt };
}

describe("grant", () => {
  it("adds credits to the chosen bucket and records one entry", () => {
    const out = apply(emptyWallet(), { type: "grant", id: "c1", bucket: "purchased", credits: 25, ref: "pack" }, NOW);
    expect(out.result).toEqual({ ok: true });
    expect(out.state.balances.purchased).toBe(25);
    expect(out.state.balances.monthly).toBe(0);
    expect(out.entries).toEqual([
      { id: "c1:0", at: NOW, user_id: null, kind: "grant", bucket: "purchased", credits: 25, ref: "pack" },
    ]);
  });

  it("records the user when given", () => {
    const out = apply(emptyWallet(), { type: "grant", id: "c1", bucket: "monthly", credits: 3, ref: "plus", user_id: "u9" }, NOW);
    expect(out.entries[0]?.user_id).toBe("u9");
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects credits %s with RangeError", (credits) => {
    expect(() => apply(emptyWallet(), { type: "grant", id: "c1", bucket: "monthly", credits, ref: "x" }, NOW)).toThrow(RangeError);
  });
});

describe("hold", () => {
  it("takes from monthly only when monthly covers it", () => {
    const start = wallet(10, 4);
    const out = apply(start, holdCommand("h1", "H1", 6), NOW);
    expect(out.result).toEqual({ ok: true });
    expect(out.state.balances.monthly).toBe(4);
    expect(out.state.balances.purchased).toBe(4);
    expect(out.state.holds.H1).toEqual({
      id: "H1", user_id: "u1", task: "explain", credits: 6, expires_at: 5_000, from_monthly: 6, from_purchased: 0,
    });
    expect(out.entries).toEqual([
      { id: "h1:0", at: NOW, user_id: "u1", kind: "hold", bucket: "monthly", credits: -6, ref: "H1" },
    ]);
  });

  it("takes monthly first then purchased, with one entry per bucket touched", () => {
    const start = wallet(3, 10);
    const out = apply(start, holdCommand("h1", "H1", 5), NOW);
    expect(out.result).toEqual({ ok: true });
    expect(out.state.balances.monthly).toBe(0);
    expect(out.state.balances.purchased).toBe(8);
    expect(out.state.holds.H1?.from_monthly).toBe(3);
    expect(out.state.holds.H1?.from_purchased).toBe(2);
    expect(out.entries).toEqual([
      { id: "h1:0", at: NOW, user_id: "u1", kind: "hold", bucket: "monthly", credits: -3, ref: "H1" },
      { id: "h1:1", at: NOW, user_id: "u1", kind: "hold", bucket: "purchased", credits: -2, ref: "H1" },
    ]);
  });

  it("fails with a shortfall and changes nothing when balances are too low", () => {
    const start = wallet(2, 1);
    const out = apply(start, holdCommand("h1", "H1", 5), NOW);
    expect(out.result).toEqual({ ok: false, shortfall: 2 });
    expect(out.state.balances).toEqual(start.balances);
    expect(out.state.holds).toEqual({});
    expect(out.entries).toEqual([]);
  });

  it("throws when the hold id already exists", () => {
    const held = apply(wallet(10, 0), holdCommand("h1", "H1", 2), NOW).state;
    expect(() => apply(held, holdCommand("h2", "H1", 2), NOW)).toThrow(Error);
  });

  it.each([0, -3, 2.5])("rejects credits %s with RangeError", (credits) => {
    expect(() => apply(wallet(10, 0), holdCommand("h1", "H1", credits), NOW)).toThrow(RangeError);
  });
});

describe("settle", () => {
  it("charges the actual amount and returns the rest to purchased first, then monthly", () => {
    // Hold 5 takes monthly 3 and purchased 2. Actual 2 means 3 come back: purchased 2, monthly 1.
    const held = apply(wallet(3, 10), holdCommand("h1", "H1", 5), NOW).state;
    const out = apply(held, { type: "settle", id: "s1", hold_id: "H1", actual: 2 }, NOW + 1);
    expect(out.result).toEqual({ ok: true, charged: 2 });
    expect(out.state.balances.purchased).toBe(10);
    expect(out.state.balances.monthly).toBe(1);
    expect(out.state.holds.H1).toBeUndefined();
    expect(out.entries).toEqual([
      { id: "s1:0", at: NOW + 1, user_id: "u1", kind: "settle", bucket: "purchased", credits: 2, ref: "H1" },
      { id: "s1:1", at: NOW + 1, user_id: "u1", kind: "settle", bucket: "monthly", credits: 1, ref: "H1" },
    ]);
  });

  it("charges only the hold when actual is above it and writes no entries", () => {
    const held = apply(wallet(10, 0), holdCommand("h1", "H1", 4), NOW).state;
    const out = apply(held, { type: "settle", id: "s1", hold_id: "H1", actual: 9 }, NOW);
    expect(out.result).toEqual({ ok: true, charged: 4 });
    expect(out.state.balances.monthly).toBe(6);
    expect(out.entries).toEqual([]);
  });

  it("returns unknown_hold for a missing hold", () => {
    const out = apply(wallet(1, 0), { type: "settle", id: "s1", hold_id: "nope", actual: 1 }, NOW);
    expect(out.result).toEqual({ ok: false, reason: "unknown_hold" });
    expect(out.entries).toEqual([]);
  });

  it.each([-1, 1.5])("rejects actual %s with RangeError", (actual) => {
    const held = apply(wallet(10, 0), holdCommand("h1", "H1", 4), NOW).state;
    expect(() => apply(held, { type: "settle", id: "s1", hold_id: "H1", actual }, NOW)).toThrow(RangeError);
  });
});

describe("release", () => {
  it("returns the full split to the buckets it came from and deletes the hold", () => {
    const held = apply(wallet(3, 10), holdCommand("h1", "H1", 5), NOW).state;
    const out = apply(held, { type: "release", id: "r1", hold_id: "H1" }, NOW + 1);
    expect(out.result).toEqual({ ok: true });
    expect(out.state.balances.monthly).toBe(3);
    expect(out.state.balances.purchased).toBe(10);
    expect(out.state.holds.H1).toBeUndefined();
    expect(out.entries).toEqual([
      { id: "r1:0", at: NOW + 1, user_id: "u1", kind: "release", bucket: "purchased", credits: 2, ref: "H1" },
      { id: "r1:1", at: NOW + 1, user_id: "u1", kind: "release", bucket: "monthly", credits: 3, ref: "H1" },
    ]);
  });

  it("returns unknown_hold for a missing hold", () => {
    const out = apply(wallet(1, 0), { type: "release", id: "r1", hold_id: "nope" }, NOW);
    expect(out.result).toEqual({ ok: false, reason: "unknown_hold" });
  });
});

describe("release_expired", () => {
  it("releases every hold at or past its expiry, in hold id order", () => {
    let state = wallet(20, 0);
    state = apply(state, holdCommand("h1", "B", 2, 2_000), NOW).state;
    state = apply(state, holdCommand("h2", "A", 3, 900), NOW).state;
    state = apply(state, holdCommand("h3", "C", 4, 5_000), NOW).state;
    const out = apply(state, { type: "release_expired", id: "x1" }, 2_000);
    expect(out.result).toEqual({ ok: true, released: ["A", "B"] });
    expect(Object.keys(out.state.holds)).toEqual(["C"]);
    expect(out.state.balances.monthly).toBe(20 - 4);
    expect(out.entries.map((e) => e.id)).toEqual(["x1:0", "x1:1"]);
    expect(out.entries.map((e) => [e.ref, e.credits])).toEqual([
      ["A", 3],
      ["B", 2],
    ]);
  });

  it("releases nothing when no hold is due", () => {
    const state = apply(wallet(5, 0), holdCommand("h1", "H1", 1, 9_000), NOW).state;
    const out = apply(state, { type: "release_expired", id: "x1" }, NOW);
    expect(out.result).toEqual({ ok: true, released: [] });
    expect(out.entries).toEqual([]);
  });
});

describe("refund", () => {
  it("gives credits back to the chosen bucket", () => {
    const out = apply(wallet(0, 1), { type: "refund", id: "f1", bucket: "monthly", credits: 4, ref: "task-7", user_id: "u1" }, NOW);
    expect(out.result).toEqual({ ok: true });
    expect(out.state.balances.monthly).toBe(4);
    expect(out.entries).toEqual([
      { id: "f1:0", at: NOW, user_id: "u1", kind: "refund", bucket: "monthly", credits: 4, ref: "task-7" },
    ]);
  });

  it("rejects non-positive credits with RangeError", () => {
    expect(() => apply(emptyWallet(), { type: "refund", id: "f1", bucket: "purchased", credits: 0, ref: "x" }, NOW)).toThrow(RangeError);
  });
});

describe("clawback", () => {
  it("removes only what purchased holds, never going below zero", () => {
    const out = apply(wallet(10, 5), { type: "clawback", id: "k1", credits: 8, ref: "refund-apple" }, NOW);
    expect(out.result).toEqual({ ok: true, removed: 5 });
    expect(out.state.balances.purchased).toBe(0);
    expect(out.state.balances.monthly).toBe(10);
    expect(out.entries).toEqual([
      { id: "k1:0", at: NOW, user_id: null, kind: "clawback", bucket: "purchased", credits: -5, ref: "refund-apple" },
    ]);
  });

  it("writes no entry when nothing is removed", () => {
    const out = apply(wallet(10, 0), { type: "clawback", id: "k1", credits: 8, ref: "x" }, NOW);
    expect(out.result).toEqual({ ok: true, removed: 0 });
    expect(out.entries).toEqual([]);
  });

  it("rejects non-positive credits with RangeError", () => {
    expect(() => apply(wallet(0, 5), { type: "clawback", id: "k1", credits: 0, ref: "x" }, NOW)).toThrow(RangeError);
  });
});

describe("reset", () => {
  it("sets monthly to the new amount, records the difference and the next reset time", () => {
    const out = apply(wallet(3, 0), { type: "reset", id: "m1", credits: 10, resets_at: 9_999 }, NOW);
    expect(out.result).toEqual({ ok: true });
    expect(out.state.balances.monthly).toBe(10);
    expect(out.state.balances.monthly_resets_at).toBe(9_999);
    expect(out.entries).toEqual([
      { id: "m1:0", at: NOW, user_id: null, kind: "reset", bucket: "monthly", credits: 7, ref: "m1" },
    ]);
  });

  it("lets unused monthly credits go, and allows zero", () => {
    const out = apply(wallet(4, 2), { type: "reset", id: "m1", credits: 0, resets_at: 9_999 }, NOW);
    expect(out.state.balances.monthly).toBe(0);
    expect(out.state.balances.purchased).toBe(2);
    expect(out.entries).toEqual([
      { id: "m1:0", at: NOW, user_id: null, kind: "reset", bucket: "monthly", credits: -4, ref: "m1" },
    ]);
  });

  it("writes no entry when the amount is unchanged", () => {
    const out = apply(wallet(5, 0), { type: "reset", id: "m1", credits: 5, resets_at: 9_999 }, NOW);
    expect(out.entries).toEqual([]);
    expect(out.state.balances.monthly_resets_at).toBe(9_999);
  });

  it("rejects negative credits with RangeError", () => {
    expect(() => apply(emptyWallet(), { type: "reset", id: "m1", credits: -1, resets_at: 1 }, NOW)).toThrow(RangeError);
  });
});

describe("command ids", () => {
  it("returns the stored first result for a repeated id, with no entries and no change", () => {
    const first = apply(wallet(1, 0), holdCommand("dup", "H1", 5), NOW);
    expect(first.result).toEqual({ ok: false, shortfall: 4 });

    const again = apply(first.state, { type: "grant", id: "dup", bucket: "monthly", credits: 50, ref: "x" }, NOW);
    expect(again.result).toEqual({ ok: false, shortfall: 4 });
    expect(again.entries).toEqual([]);
    expect(again.state).toEqual(first.state);
  });

  it("names entries <command id>:<n> starting at 0", () => {
    const out = apply(wallet(3, 10), holdCommand("abc", "H1", 5), NOW);
    expect(out.entries.map((e) => e.id)).toEqual(["abc:0", "abc:1"]);
  });
});

describe("immutability", () => {
  it("never changes the input state", () => {
    const start = apply(wallet(3, 10), holdCommand("h1", "H1", 5), NOW).state;
    const snapshot = JSON.stringify(start);
    apply(start, { type: "settle", id: "s1", hold_id: "H1", actual: 1 }, NOW);
    apply(start, { type: "release", id: "r1", hold_id: "H1" }, NOW);
    apply(start, { type: "release_expired", id: "x1" }, 99_999);
    apply(start, { type: "clawback", id: "k1", credits: 100, ref: "x" }, NOW);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});
