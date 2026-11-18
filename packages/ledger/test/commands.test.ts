import { describe, expect, it } from "vitest";
import { apply, emptyWallet } from "../src/index.ts";
import type { ApplyOutput, Command, CommandResult, WalletState } from "../src/index.ts";

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
      id: "H1", user_id: "u1", task: "explain", credits: 6, expires_at: 5_000, from_monthly: 6, from_purchased: 0, monthly_period: 0,
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
    expect(out.result).toEqual({ ok: true, charged: 2, forfeited_monthly: 0 });
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
    expect(out.result).toEqual({ ok: true, charged: 4, forfeited_monthly: 0 });
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
    expect(out.result).toEqual({ ok: true, forfeited_monthly: 0 });
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
  // D2: the part of the clawback that purchased cannot cover is recorded as owed (3 here).
  it("removes only what purchased holds and records the rest as owed", () => {
    const out = apply(wallet(10, 5), { type: "clawback", id: "k1", credits: 8, ref: "refund-apple" }, NOW);
    expect(out.result).toEqual({ ok: true, removed: 5, owed: 3 });
    expect(out.state.balances.purchased).toBe(0);
    expect(out.state.balances.monthly).toBe(10);
    expect(out.state.balances.owed).toBe(3);
    expect(out.entries).toEqual([
      { id: "k1:0", at: NOW, user_id: null, kind: "clawback", bucket: "purchased", credits: -5, ref: "refund-apple" },
      { id: "k1:1", at: NOW, user_id: null, kind: "clawback", bucket: "owed", credits: 3, ref: "refund-apple" },
    ]);
  });

  // D2: when nothing is purchased, the whole clawback is recorded as owed, so the purchased entry is skipped.
  it("writes no purchased entry when nothing is removed, and records the whole amount as owed", () => {
    const out = apply(wallet(10, 0), { type: "clawback", id: "k1", credits: 8, ref: "x" }, NOW);
    expect(out.result).toEqual({ ok: true, removed: 0, owed: 8 });
    expect(out.entries).toEqual([
      { id: "k1:0", at: NOW, user_id: null, kind: "clawback", bucket: "owed", credits: 8, ref: "x" },
    ]);
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

// D1 and D2 with holds still open. Each test follows the scenario in docs/build-plan.md (PR 03 fix).
describe("held credits across a reset and a clawback", () => {
  it("forfeits the monthly part of a hold made before a reset, and keeps monthly at the new amount", () => {
    // Monthly 10, hold 8 takes monthly 8 (period 0). Reset to 10 starts period 1 and sets monthly to 10.
    const held = apply(wallet(10, 0), holdCommand("h1", "H1", 8), NOW).state;
    const reset = apply(held, { type: "reset", id: "m1", credits: 10, resets_at: 9_999 }, NOW + 1);
    expect(reset.state.balances.monthly).toBe(10);
    expect(reset.state.balances.monthly_period).toBe(1);

    const out = apply(reset.state, { type: "release", id: "r1", hold_id: "H1" }, NOW + 2);
    expect(out.result).toEqual({ ok: true, forfeited_monthly: 8 });
    expect(out.state.balances.monthly).toBe(10);
    expect(out.entries).toEqual([]);
  });

  it("drops the monthly part of a settle after a reset, and still charges the hold", () => {
    // Hold 8 from monthly. Actual 3 means 5 would come back, all monthly, so all 5 are dropped.
    const held = apply(wallet(10, 0), holdCommand("h1", "H1", 8), NOW).state;
    const reset = apply(held, { type: "reset", id: "m1", credits: 10, resets_at: 9_999 }, NOW + 1).state;
    const out = apply(reset, { type: "settle", id: "s1", hold_id: "H1", actual: 3 }, NOW + 2);
    expect(out.result).toEqual({ ok: true, charged: 3, forfeited_monthly: 5 });
    expect(out.state.balances.monthly).toBe(10);
  });

  it("records the part a clawback cannot take as owed, and clears it when the hold is released", () => {
    // Purchased 100, hold 90 from purchased leaves 10. Clawback 100 takes 10 and owes 90.
    const held = apply(wallet(0, 100), holdCommand("h1", "H1", 90), NOW).state;
    const clawed = apply(held, { type: "clawback", id: "k1", credits: 100, ref: "refund-apple" }, NOW + 1);
    expect(clawed.result).toEqual({ ok: true, removed: 10, owed: 90 });
    expect(clawed.state.balances).toMatchObject({ purchased: 0, owed: 90 });

    // The released 90 pays off what is owed, so nothing goes back to purchased.
    const out = apply(clawed.state, { type: "release", id: "r1", hold_id: "H1" }, NOW + 2);
    expect(out.result).toEqual({ ok: true, forfeited_monthly: 0 });
    expect(out.state.balances).toMatchObject({ monthly: 0, purchased: 0, owed: 0 });
    expect(out.entries).toEqual([
      { id: "r1:0", at: NOW + 2, user_id: "u1", kind: "release", bucket: "owed", credits: -90, ref: "H1" },
    ]);
  });
});

describe("command ids", () => {
  it("names entries <command id>:<n> starting at 0", () => {
    const out = apply(wallet(3, 10), holdCommand("abc", "H1", 5), NOW);
    expect(out.entries.map((e) => e.id)).toEqual(["abc:0", "abc:1"]);
  });

  it("returns the stored result for a repeated id and type, with no entries and no change", () => {
    const held = apply(wallet(3, 10), holdCommand("h1", "H1", 5), NOW).state;
    const first = apply(held, { type: "settle", id: "s1", hold_id: "H1", actual: 2 }, NOW);
    expect(first.result).toEqual({ ok: true, charged: 2, forfeited_monthly: 0 });

    const again = apply(first.state, { type: "settle", id: "s1", hold_id: "H1", actual: 0 }, NOW);
    expect(again.result).toEqual({ ok: true, charged: 2, forfeited_monthly: 0 });
    expect(again.entries).toEqual([]);
    expect(again.state).toEqual(first.state);
  });

  it("throws when a known id is reused for a different command type", () => {
    const granted = apply(emptyWallet(), { type: "grant", id: "g1", bucket: "monthly", credits: 5, ref: "x" }, NOW).state;
    expect(() => apply(granted, holdCommand("g1", "H1", 5), NOW)).toThrow("command id reused for a different command");
  });

  it("throws when a settle reuses a grant id", () => {
    const held = apply(wallet(10, 0), holdCommand("h1", "H1", 4), NOW).state;
    const granted = apply(held, { type: "grant", id: "g1", bucket: "monthly", credits: 1, ref: "x" }, NOW).state;
    expect(() => apply(granted, { type: "settle", id: "g1", hold_id: "H1", actual: 1 }, NOW)).toThrow(
      "command id reused for a different command",
    );
  });

  it("treats inherited object keys as unused ids", () => {
    const out = apply(emptyWallet(), { type: "grant", id: "toString", bucket: "monthly", credits: 2, ref: "x" }, NOW);
    expect(out.result).toEqual({ ok: true });
    expect(out.state.balances.monthly).toBe(2);
  });

  it("does not look up inherited object keys as holds", () => {
    const out = apply(wallet(5, 0), { type: "settle", id: "s1", hold_id: "toString", actual: 1 }, NOW);
    expect(out.result).toEqual({ ok: false, reason: "unknown_hold" });
  });
});

describe("failed results", () => {
  it("does not remember a shortfall, so a retry with the same id succeeds once credits are granted", () => {
    const short = apply(emptyWallet(), holdCommand("retry", "H1", 5), NOW);
    expect(short.result).toEqual({ ok: false, shortfall: 5 });
    expect(Object.hasOwn(short.state.applied, "retry")).toBe(false);

    const funded = apply(short.state, { type: "grant", id: "top-up", bucket: "purchased", credits: 5, ref: "pack" }, NOW).state;
    const retried = apply(funded, holdCommand("retry", "H1", 5), NOW);
    expect(retried.result).toEqual({ ok: true });
    expect(retried.state.balances.purchased).toBe(0);
    expect(Object.hasOwn(retried.state.holds, "H1")).toBe(true);

    // Now that it succeeded, the same id returns the stored success and changes nothing.
    const replay = apply(retried.state, holdCommand("retry", "H1", 5), NOW);
    expect(replay.result).toEqual({ ok: true });
    expect(replay.entries).toEqual([]);
    expect(replay.state.balances.purchased).toBe(0);
  });

  it("does not remember an unknown hold, so the same id can succeed later", () => {
    const missing = apply(wallet(5, 0), { type: "settle", id: "s1", hold_id: "H1", actual: 1 }, NOW);
    expect(missing.result).toEqual({ ok: false, reason: "unknown_hold" });
    expect(Object.hasOwn(missing.state.applied, "s1")).toBe(false);

    const held = apply(missing.state, holdCommand("h1", "H1", 4), NOW).state;
    const settled = apply(held, { type: "settle", id: "s1", hold_id: "H1", actual: 1 }, NOW);
    expect(settled.result).toEqual({ ok: true, charged: 1, forfeited_monthly: 0 });
  });

  it("does not remember a failed release either", () => {
    const missing = apply(wallet(5, 0), { type: "release", id: "r1", hold_id: "H1" }, NOW);
    expect(Object.hasOwn(missing.state.applied, "r1")).toBe(false);
  });
});

describe("id validation", () => {
  it.each(["", "has space", "dot.id", "slash/id", "é", "x".repeat(129)])("rejects command id %j with RangeError", (id) => {
    expect(() => apply(emptyWallet(), { type: "grant", id, bucket: "monthly", credits: 1, ref: "x" }, NOW)).toThrow(RangeError);
  });

  it.each(["__proto__", "constructor", "prototype"])("rejects reserved command id %s with RangeError", (id) => {
    expect(() => apply(emptyWallet(), { type: "grant", id, bucket: "monthly", credits: 1, ref: "x" }, NOW)).toThrow(RangeError);
  });

  it("accepts an id of exactly 128 allowed characters", () => {
    const id = "a_:-".repeat(32);
    expect(id).toHaveLength(128);
    const out = apply(emptyWallet(), { type: "grant", id, bucket: "monthly", credits: 1, ref: "x" }, NOW);
    expect(out.result).toEqual({ ok: true });
  });

  it.each(["", "bad id", "x".repeat(129), "__proto__", "constructor", "prototype"])(
    "rejects hold_id %j with RangeError on hold",
    (holdId) => {
      expect(() => apply(wallet(10, 0), holdCommand("h1", holdId, 2), NOW)).toThrow(RangeError);
    },
  );

  it("rejects a bad hold_id on settle and release", () => {
    expect(() => apply(wallet(10, 0), { type: "settle", id: "s1", hold_id: "__proto__", actual: 1 }, NOW)).toThrow(RangeError);
    expect(() => apply(wallet(10, 0), { type: "release", id: "r1", hold_id: "bad id" }, NOW)).toThrow(RangeError);
  });

  it("keeps the credits when a __proto__ hold id is refused", () => {
    expect(() => apply(wallet(0, 100), holdCommand("h1", "__proto__", 50), NOW)).toThrow(RangeError);
  });
});

describe("time validation", () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects now %s with RangeError",
    (now) => {
      expect(() => apply(emptyWallet(), { type: "release_expired", id: "x1" }, now)).toThrow(RangeError);
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects expires_at %s on hold with RangeError",
    (expiresAt) => {
      expect(() => apply(wallet(10, 0), holdCommand("h1", "H1", 2, expiresAt), NOW)).toThrow(RangeError);
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects resets_at %s on reset with RangeError", (resetsAt) => {
    expect(() => apply(wallet(1, 0), { type: "reset", id: "m1", credits: 1, resets_at: resetsAt }, NOW)).toThrow(RangeError);
  });

  it("accepts zero for every time", () => {
    const out = apply(wallet(1, 0), { type: "reset", id: "m1", credits: 1, resets_at: 0 }, 0);
    expect(out.result).toEqual({ ok: true });
    expect(out.state.balances.monthly_resets_at).toBe(0);
    const held = apply(wallet(4, 0), holdCommand("h1", "H1", 2, 0), 0);
    expect(held.result).toEqual({ ok: true });
  });
});

describe("balance overflow", () => {
  it("throws RangeError when a grant would take a balance above Number.MAX_SAFE_INTEGER", () => {
    const full = apply(emptyWallet(), { type: "grant", id: "g1", bucket: "monthly", credits: Number.MAX_SAFE_INTEGER, ref: "x" }, NOW).state;
    expect(full.balances.monthly).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => apply(full, { type: "grant", id: "g2", bucket: "monthly", credits: 2, ref: "x" }, NOW)).toThrow(RangeError);
  });

  it("throws RangeError when a refund would overflow purchased", () => {
    const full = apply(emptyWallet(), { type: "grant", id: "g1", bucket: "purchased", credits: Number.MAX_SAFE_INTEGER, ref: "x" }, NOW).state;
    expect(() => apply(full, { type: "refund", id: "f1", bucket: "purchased", credits: 1, ref: "x" }, NOW)).toThrow(RangeError);
  });
});

describe("unknown command type", () => {
  it("throws at runtime for a type the union does not have, and records nothing", () => {
    const bogus: Command = JSON.parse('{"type":"bogus","id":"b1"}');
    expect(() => apply(emptyWallet(), bogus, NOW)).toThrow("unknown command type");

    // The id was not recorded, so a real command with the same id still runs.
    const real = apply(emptyWallet(), { type: "grant", id: "b1", bucket: "monthly", credits: 1, ref: "x" }, NOW);
    expect(real.result).toEqual({ ok: true });
  });
});

describe("frozen results", () => {
  it("freezes the returned result and the stored copy", () => {
    const out: ApplyOutput = apply(emptyWallet(), { type: "grant", id: "g1", bucket: "monthly", credits: 1, ref: "x" }, NOW);
    const result: CommandResult = out.result;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(out.state.applied.g1?.result)).toBe(true);
  });

  it("freezes the released array, so a caller cannot change a stored result", () => {
    const held = apply(wallet(10, 0), holdCommand("h1", "H1", 2), NOW).state;
    const out = apply(held, { type: "release_expired", id: "x1" }, 5_000);
    expect(out.result).toEqual({ ok: true, released: ["H1"] });
    expect("released" in out.result && Object.isFrozen(out.result.released)).toBe(true);
    expect(Object.isFrozen(out.state.applied.x1)).toBe(true);
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
