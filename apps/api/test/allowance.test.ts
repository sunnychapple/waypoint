import type { Command } from "@waypoint/ledger";
import { describe, expect, test } from "vitest";
import { topUpYearlyPlus } from "../src/apple/allowance.ts";
import { addMonths, PLUS_MONTHLY_CREDITS } from "../src/apple/products.ts";
import type { WalletCommands } from "../src/apple/purchases.ts";
import type { Db } from "../src/storage.ts";
import { createWalletStore } from "../src/wallet/store.ts";
import { createTestDb } from "./helpers/d1.ts";
import { createTestStore } from "./helpers/sql.ts";

const NOW = Date.UTC(2026, 10, 19, 12);
const DAY = 24 * 60 * 60 * 1000;
const YEARLY_START = Date.UTC(2026, 0, 31, 10);

// Records every command it is given and answers ok.
function recordingWallet(commands: Command[]): (billingAccountId: string) => WalletCommands {
  return () => ({
    async apply(command) {
      commands.push(command);
      return { ok: true };
    },
  });
}

async function userWithPlus(db: Db, user: string, billing: string, source: "purchase" | "family_share" = "purchase", endedAt: number | null = null) {
  await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, 0, ?)").bind(user, `clerk_${user}`, billing).run();
  await db
    .prepare("INSERT INTO entitlements (user_id, product, source, granted_at, ended_at) VALUES (?, 'plus', ?, 0, ?)")
    .bind(user, source, endedAt)
    .run();
}

describe("topUpYearlyPlus", () => {
  test("a yearly subscription bought in January gets one reset for month 9 with the period end as resets_at", async () => {
    const db = createTestDb();
    await userWithPlus(db, "u1", "ba1");
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'active', ?)")
      .bind(YEARLY_START)
      .run();
    const commands: Command[] = [];
    const applied = await topUpYearlyPlus(db, recordingWallet(commands), NOW);
    expect(applied).toBe(1);
    expect(commands).toEqual([
      { type: "reset", id: "plus-month:t1:9", credits: PLUS_MONTHLY_CREDITS, resets_at: addMonths(YEARLY_START, 10) },
    ]);
  });

  test("a yearly subscription bought 10 days ago gets no command (month 0 was PR 17's reset)", async () => {
    const db = createTestDb();
    await userWithPlus(db, "u1", "ba1");
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'active', ?)")
      .bind(NOW - 10 * DAY)
      .run();
    const commands: Command[] = [];
    expect(await topUpYearlyPlus(db, recordingWallet(commands), NOW)).toBe(0);
    expect(commands).toEqual([]);
  });

  test("a yearly subscription bought 13 months ago and still active gets month 11 at most", async () => {
    const db = createTestDb();
    const start = Date.UTC(2025, 9, 1, 10);
    await userWithPlus(db, "u1", "ba1");
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'active', ?)")
      .bind(start)
      .run();
    const commands: Command[] = [];
    await topUpYearlyPlus(db, recordingWallet(commands), NOW);
    expect(commands).toEqual([
      { type: "reset", id: "plus-month:t1:11", credits: PLUS_MONTHLY_CREDITS, resets_at: addMonths(start, 12) },
    ]);
  });

  test("run twice with the real wallet store: the second run has the same command id and adds no ledger entry", async () => {
    const db = createTestDb();
    await userWithPlus(db, "u1", "ba1");
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'active', ?)")
      .bind(YEARLY_START)
      .run();
    const wallet = createWalletStore(createTestStore());
    const walletFor = (): WalletCommands => ({ apply: async (command) => wallet.apply(command, NOW) });
    expect(await topUpYearlyPlus(db, walletFor, NOW)).toBe(1);
    const afterFirst = wallet.ledger(0, 500).entries.length;
    expect(afterFirst).toBeGreaterThan(0);
    expect(await topUpYearlyPlus(db, walletFor, NOW)).toBe(1);
    expect(wallet.ledger(0, 500).entries.length).toBe(afterFirst);
    expect(wallet.read().monthly).toBe(PLUS_MONTHLY_CREDITS);
  });

  test("a yearly subscription with status expired or refunded gets no command", async () => {
    const db = createTestDb();
    await userWithPlus(db, "u1", "ba1");
    await userWithPlus(db, "u2", "ba2");
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'expired', ?)")
      .bind(YEARLY_START)
      .run();
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t2', 'o2', 'ba2', 'waypoint.plus.yearly', 'subscription', 'refunded', ?)")
      .bind(YEARLY_START)
      .run();
    const commands: Command[] = [];
    expect(await topUpYearlyPlus(db, recordingWallet(commands), NOW)).toBe(0);
    expect(commands).toEqual([]);
  });

  test("a yearly subscription whose only entitlement is family_share gets no command", async () => {
    const db = createTestDb();
    await userWithPlus(db, "u1", "ba1", "family_share");
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'active', ?)")
      .bind(YEARLY_START)
      .run();
    const commands: Command[] = [];
    expect(await topUpYearlyPlus(db, recordingWallet(commands), NOW)).toBe(0);
    expect(commands).toEqual([]);
  });

  test("a yearly subscription whose Plus entitlement has ended gets no command", async () => {
    const db = createTestDb();
    await userWithPlus(db, "u1", "ba1", "purchase", NOW - DAY);
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'active', ?)")
      .bind(YEARLY_START)
      .run();
    const commands: Command[] = [];
    expect(await topUpYearlyPlus(db, recordingWallet(commands), NOW)).toBe(0);
    expect(commands).toEqual([]);
  });

  test("two yearly rows for one original id: only the newest is used", async () => {
    const db = createTestDb();
    await userWithPlus(db, "u1", "ba1");
    const newer = Date.UTC(2026, 2, 15, 10);
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t-old', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'active', ?)")
      .bind(YEARLY_START)
      .run();
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t-new', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'active', ?)")
      .bind(newer)
      .run();
    const commands: Command[] = [];
    await topUpYearlyPlus(db, recordingWallet(commands), NOW);
    expect(commands).toEqual([
      { type: "reset", id: "plus-month:t-new:8", credits: PLUS_MONTHLY_CREDITS, resets_at: addMonths(newer, 9) },
    ]);
  });

  test("a monthly Plus subscription gets no command", async () => {
    const db = createTestDb();
    await userWithPlus(db, "u1", "ba1");
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES ('t1', 'o1', 'ba1', 'waypoint.plus.monthly', 'subscription', 'active', ?)")
      .bind(YEARLY_START)
      .run();
    const commands: Command[] = [];
    expect(await topUpYearlyPlus(db, recordingWallet(commands), NOW)).toBe(0);
    expect(commands).toEqual([]);
  });
});
