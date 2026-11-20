import { SYNC_DAILY_BYTES, SYNC_DAILY_LIMIT_MESSAGE } from "@waypoint/contracts";
import { describe, expect, test } from "vitest";
import { ApiFailure } from "../src/errors.ts";
import { spendSyncBytes, utcDay } from "../src/sync/budget.ts";
import type { BatchDb } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";

const DAY = 86_400_000;
// 18:00 UTC: six hours (21,600 s) before the next UTC day.
const NOW = 20_400 * DAY + 18 * 60 * 60 * 1000;

async function makeDb(): Promise<BatchDb> {
  const db = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, 0, ?)").bind(id, `clerk_${id}`, id).run();
  }
  return db;
}

async function bytesOf(db: BatchDb, userId: string, day: number): Promise<number | null> {
  const row = await db.prepare("SELECT bytes FROM sync_days WHERE user_id = ? AND day = ?").bind(userId, day).first<{ bytes: number }>();
  return row?.bytes ?? null;
}

describe("spendSyncBytes", () => {
  test("utcDay counts whole days since 1970: the last millisecond of a day and the first of the next differ by one", () => {
    expect(utcDay(NOW)).toBe(20_400);
    expect(utcDay(20_401 * DAY - 1)).toBe(20_400);
    expect(utcDay(20_401 * DAY)).toBe(20_401);
  });

  test("bytes add up per person per day, up to exactly the budget", async () => {
    const db = await makeDb();
    await spendSyncBytes(db, "u1", 1_000, NOW);
    await spendSyncBytes(db, "u1", SYNC_DAILY_BYTES - 1_000, NOW);
    await spendSyncBytes(db, "u2", 5, NOW);
    expect(await bytesOf(db, "u1", 20_400)).toBe(SYNC_DAILY_BYTES);
    expect(await bytesOf(db, "u2", 20_400)).toBe(5);
  });

  test("one byte over the budget: 429 rate_limited with the seconds until 00:00 UTC, and nothing is counted", async () => {
    const db = await makeDb();
    await spendSyncBytes(db, "u1", SYNC_DAILY_BYTES, NOW);
    const failure = await spendSyncBytes(db, "u1", 1, NOW).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure).toMatchObject({ code: "rate_limited", message: SYNC_DAILY_LIMIT_MESSAGE, retryAfter: 21_600 });
    expect(await bytesOf(db, "u1", 20_400)).toBe(SYNC_DAILY_BYTES);
  });

  test("a new UTC day starts from 0", async () => {
    const db = await makeDb();
    await spendSyncBytes(db, "u1", SYNC_DAILY_BYTES, NOW);
    await spendSyncBytes(db, "u1", 10, 20_401 * DAY);
    expect(await bytesOf(db, "u1", 20_401)).toBe(10);
  });

  test("extra bytes bought for today raise today's budget only", async () => {
    const db = await makeDb();
    await db.prepare("INSERT INTO sync_days (user_id, day, bytes) VALUES ('u1', 20400, ?)").bind(SYNC_DAILY_BYTES).run();
    await db.prepare("INSERT INTO sync_extras (user_id, key, day, bytes) VALUES ('u1', 'k_today', 20400, 300), ('u1', 'k_today2', 20400, 200), ('u1', 'k_old', 20399, 900)").run();
    await spendSyncBytes(db, "u1", 500, NOW);
    await expect(spendSyncBytes(db, "u1", 1, NOW)).rejects.toThrow(SYNC_DAILY_LIMIT_MESSAGE);
  });
});
