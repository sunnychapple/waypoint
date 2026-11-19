import { describe, expect, test } from "vitest";
import {
  apply,
  balancesFromLedger,
  emptyWallet,
  type Command,
  type CommandResult,
  type Hold,
  type LedgerEntry,
  type WalletState,
} from "@waypoint/ledger";
import { createWalletStore, type WalletView } from "../src/wallet/store.ts";
import type { SqlStore } from "../src/storage.ts";
import { createTestStore } from "./helpers/sql.ts";

const TABLES = ["balances", "holds", "ledger", "applied"] as const;

function snapshot(store: SqlStore): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    out[table] = store.sql.exec(`SELECT * FROM ${table} ORDER BY 1`).toArray();
  }
  return out;
}

function byId(a: Hold, b: Hold): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function viewOf(state: WalletState): WalletView {
  return {
    monthly: state.balances.monthly,
    purchased: state.balances.purchased,
    owed: state.balances.owed,
    monthly_resets_at: state.balances.monthly_resets_at,
    holds: Object.values(state.holds).sort(byId),
  };
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("wallet store", () => {
  test("grant then read shows the balance", () => {
    const wallet = createWalletStore(createTestStore());
    expect(wallet.apply({ type: "grant", id: "g1", bucket: "monthly", credits: 10, ref: "plan" }, 1000)).toEqual({
      ok: true,
    });
    expect(wallet.read()).toEqual({ monthly: 10, purchased: 0, owed: 0, monthly_resets_at: null, holds: [] });
  });

  test("hold then settle with a partial actual returns the unused credits", () => {
    const wallet = createWalletStore(createTestStore());
    wallet.apply({ type: "grant", id: "g1", bucket: "monthly", credits: 10, ref: "plan" }, 1000);
    wallet.apply({ type: "grant", id: "g2", bucket: "purchased", credits: 10, ref: "pack" }, 1000);
    expect(
      wallet.apply(
        { type: "hold", id: "c1", hold_id: "h1", user_id: "u1", task: "summary", credits: 15, expires_at: 9000 },
        1000,
      ),
    ).toEqual({ ok: true });
    expect(wallet.read()).toMatchObject({ monthly: 0, purchased: 5 });
    expect(
      wallet.apply({ type: "settle", id: "c2", hold_id: "h1", actual: 6 }, 2000),
    ).toEqual({ ok: true, charged: 6, forfeited_monthly: 0 });
    expect(wallet.read()).toEqual({ monthly: 4, purchased: 10, owed: 0, monthly_resets_at: null, holds: [] });
  });

  test("release returns the held credits", () => {
    const wallet = createWalletStore(createTestStore());
    wallet.apply({ type: "grant", id: "g1", bucket: "monthly", credits: 10, ref: "plan" }, 1000);
    wallet.apply(
      { type: "hold", id: "c1", hold_id: "h1", user_id: "u1", task: "summary", credits: 4, expires_at: 9000 },
      1000,
    );
    expect(wallet.apply({ type: "release", id: "c2", hold_id: "h1" }, 1500)).toEqual({
      ok: true,
      forfeited_monthly: 0,
    });
    expect(wallet.read()).toEqual({ monthly: 10, purchased: 0, owed: 0, monthly_resets_at: null, holds: [] });
  });

  test("clawback beyond purchased gives the rest to owed", () => {
    const wallet = createWalletStore(createTestStore());
    wallet.apply({ type: "grant", id: "g1", bucket: "purchased", credits: 5, ref: "pack" }, 1000);
    expect(wallet.apply({ type: "clawback", id: "c1", credits: 8, ref: "refund-7" }, 1100)).toEqual({
      ok: true,
      removed: 5,
      owed: 3,
    });
    expect(wallet.read()).toMatchObject({ purchased: 0, owed: 3 });
  });

  test("reset pays off owed first, then sets the monthly balance and resets_at", () => {
    const wallet = createWalletStore(createTestStore());
    wallet.apply({ type: "grant", id: "g1", bucket: "purchased", credits: 5, ref: "pack" }, 1000);
    wallet.apply({ type: "clawback", id: "c1", credits: 8, ref: "refund-7" }, 1100);
    expect(wallet.apply({ type: "reset", id: "c2", credits: 20, resets_at: 5000 }, 1200)).toEqual({ ok: true });
    expect(wallet.read()).toEqual({ monthly: 17, purchased: 0, owed: 0, monthly_resets_at: 5000, holds: [] });
  });

  test("a repeated command id writes nothing and returns the first result", () => {
    const store = createTestStore();
    const wallet = createWalletStore(store);
    wallet.apply({ type: "grant", id: "g1", bucket: "monthly", credits: 10, ref: "plan" }, 1000);
    wallet.apply(
      { type: "hold", id: "c1", hold_id: "h1", user_id: "u1", task: "summary", credits: 10, expires_at: 9000 },
      1000,
    );
    wallet.apply({ type: "settle", id: "s1", hold_id: "h1", actual: 4 }, 1100);
    const before = snapshot(store);

    expect(wallet.apply({ type: "settle", id: "s1", hold_id: "h1", actual: 9 }, 1200)).toEqual({
      ok: true,
      charged: 4,
      forfeited_monthly: 0,
    });
    expect(snapshot(store)).toEqual(before);
  });

  test("the same command id with another type throws and writes nothing", () => {
    const store = createTestStore();
    const wallet = createWalletStore(store);
    wallet.apply({ type: "grant", id: "g1", bucket: "monthly", credits: 10, ref: "plan" }, 1000);
    const before = snapshot(store);

    expect(() => wallet.apply({ type: "release", id: "g1", hold_id: "h1" }, 1100)).toThrow(
      "command id reused for a different command",
    );
    expect(snapshot(store)).toEqual(before);
  });

  test("a failed hold writes nothing, and the same id succeeds after a grant", () => {
    const store = createTestStore();
    const wallet = createWalletStore(store);
    wallet.apply({ type: "grant", id: "g1", bucket: "monthly", credits: 3, ref: "plan" }, 1000);
    const before = snapshot(store);
    const hold: Command = {
      type: "hold",
      id: "c1",
      hold_id: "h1",
      user_id: "u1",
      task: "summary",
      credits: 5,
      expires_at: 9000,
    };

    expect(wallet.apply(hold, 1100)).toEqual({ ok: false, shortfall: 2 });
    expect(snapshot(store)).toEqual(before);

    wallet.apply({ type: "grant", id: "g2", bucket: "monthly", credits: 10, ref: "plan" }, 1200);
    expect(wallet.apply(hold, 1300)).toEqual({ ok: true });
    expect(wallet.read()).toMatchObject({ monthly: 8, holds: [{ id: "h1", credits: 5 }] });
  });

  test("an invalid command throws and writes nothing", () => {
    const store = createTestStore();
    const wallet = createWalletStore(store);
    const before = snapshot(store);

    expect(() => wallet.apply({ type: "grant", id: "g1", bucket: "monthly", credits: 0, ref: "plan" }, 1000)).toThrow(
      RangeError,
    );
    expect(snapshot(store)).toEqual(before);
  });

  test("a new store on the same SqlStore sees the same state", () => {
    const store = createTestStore();
    const first = createWalletStore(store);
    first.apply({ type: "grant", id: "g1", bucket: "purchased", credits: 7, ref: "pack" }, 1000);
    first.apply(
      { type: "hold", id: "c1", hold_id: "h1", user_id: "u1", task: "summary", credits: 2, expires_at: 9000 },
      1000,
    );

    const second = createWalletStore(store);
    expect(second.read()).toEqual(first.read());
    expect(second.apply({ type: "grant", id: "g1", bucket: "purchased", credits: 7, ref: "pack" }, 2000)).toEqual({
      ok: true,
    });
    expect(second.read()).toMatchObject({ purchased: 5 });
  });

  test("a 200-step seeded sequence matches the ledger package run in memory", () => {
    const rand = seeded(20261119);
    const int = (max: number) => Math.floor(rand() * max);
    const pick = <T>(items: T[], fallback: T): T =>
      items.length === 0 ? fallback : (items[int(items.length)] ?? fallback);

    const store = createTestStore();
    const wallet = createWalletStore(store);
    let state = emptyWallet();
    const memoryEntries: LedgerEntry[] = [];
    const holdIds: string[] = [];
    const history: Command[] = [];
    let now = 1000;

    for (let step = 0; step < 200; step++) {
      now += int(3000);
      const roll = int(100);
      let command: Command;
      if (roll < 20) {
        command = {
          type: "grant",
          id: `c${step}`,
          bucket: rand() < 0.5 ? "monthly" : "purchased",
          credits: 1 + int(40),
          ref: `ref-${step}`,
          ...(rand() < 0.5 ? { user_id: "u1" } : {}),
        };
      } else if (roll < 40) {
        const id = `h${step}`;
        holdIds.push(id);
        command = {
          type: "hold",
          id: `c${step}`,
          hold_id: id,
          user_id: "u1",
          task: "summary",
          credits: 1 + int(60),
          expires_at: now + 1 + int(20000),
        };
      } else if (roll < 55) {
        command = { type: "settle", id: `c${step}`, hold_id: pick(holdIds, "missing"), actual: int(50) };
      } else if (roll < 65) {
        command = { type: "release", id: `c${step}`, hold_id: pick(holdIds, "missing") };
      } else if (roll < 72) {
        command = { type: "release_expired", id: `c${step}` };
      } else if (roll < 80) {
        command = {
          type: "refund",
          id: `c${step}`,
          bucket: rand() < 0.5 ? "monthly" : "purchased",
          credits: 1 + int(20),
          ref: `ref-${step}`,
        };
      } else if (roll < 88) {
        command = { type: "clawback", id: `c${step}`, credits: 1 + int(30), ref: `ref-${step}` };
      } else if (roll < 93) {
        command = { type: "reset", id: `c${step}`, credits: int(25), resets_at: now + 1000 + int(1000000) };
      } else {
        command = pick(history, { type: "release_expired", id: `c${step}` });
      }
      history.push(command);

      let expected: CommandResult | { error: string };
      try {
        const output = apply(state, command, now);
        state = output.state;
        memoryEntries.push(...output.entries);
        expected = output.result;
      } catch (error) {
        expected = { error: error instanceof Error ? error.message : String(error) };
      }

      let actual: CommandResult | { error: string };
      try {
        actual = wallet.apply(command, now);
      } catch (error) {
        actual = { error: error instanceof Error ? error.message : String(error) };
      }
      expect(actual, `step ${step}`).toEqual(expected);
      expect(wallet.read(), `step ${step}`).toEqual(viewOf(state));
    }

    const paged: LedgerEntry[] = [];
    let after = 0;
    for (;;) {
      const page = wallet.ledger(after, 50);
      if (page.entries.length === 0) break;
      paged.push(...page.entries);
      after = page.next;
    }
    expect(paged.length).toBeGreaterThan(50);
    expect(paged).toEqual(memoryEntries);
    const view = wallet.read();
    expect(balancesFromLedger(paged)).toEqual({ monthly: view.monthly, purchased: view.purchased, owed: view.owed });
  });

  test("ledger pages in seq order and returns the last seq as next", () => {
    const wallet = createWalletStore(createTestStore());
    for (let i = 1; i <= 7; i++) {
      wallet.apply({ type: "grant", id: `g${i}`, bucket: "monthly", credits: 1, ref: `ref-${i}` }, 1000 + i);
    }
    const first = wallet.ledger(0, 3);
    expect(first.entries.map((entry) => entry.ref)).toEqual(["ref-1", "ref-2", "ref-3"]);
    expect(first.next).toBe(3);
    const second = wallet.ledger(first.next, 3);
    expect(second.entries.map((entry) => entry.ref)).toEqual(["ref-4", "ref-5", "ref-6"]);
    expect(second.next).toBe(6);
    const third = wallet.ledger(second.next, 3);
    expect(third.entries.map((entry) => entry.ref)).toEqual(["ref-7"]);
    expect(third.next).toBe(7);
    expect(wallet.ledger(third.next, 3)).toEqual({ entries: [], next: 7 });
    expect(wallet.ledger(0, 500).entries).toHaveLength(7);
  });

  test("ledger throws RangeError for a bad after or limit", () => {
    const wallet = createWalletStore(createTestStore());
    expect(() => wallet.ledger(-1, 10)).toThrow(RangeError);
    expect(() => wallet.ledger(1.5, 10)).toThrow(RangeError);
    expect(() => wallet.ledger(Number.MAX_SAFE_INTEGER + 1, 10)).toThrow(RangeError);
    expect(() => wallet.ledger(0, 0)).toThrow(RangeError);
    expect(() => wallet.ledger(0, 501)).toThrow(RangeError);
    expect(() => wallet.ledger(0, 2.5)).toThrow(RangeError);
  });

  test("nextExpiry is null with no holds and the smallest expiry with two holds", () => {
    const wallet = createWalletStore(createTestStore());
    expect(wallet.nextExpiry()).toBeNull();
    wallet.apply({ type: "grant", id: "g1", bucket: "monthly", credits: 20, ref: "plan" }, 1000);
    wallet.apply(
      { type: "hold", id: "c1", hold_id: "h1", user_id: "u1", task: "a", credits: 2, expires_at: 9000 },
      1000,
    );
    wallet.apply(
      { type: "hold", id: "c2", hold_id: "h2", user_id: "u1", task: "b", credits: 2, expires_at: 4000 },
      1000,
    );
    expect(wallet.nextExpiry()).toBe(4000);
  });
});
