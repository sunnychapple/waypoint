import type { Command } from "@waypoint/ledger";
import { describe, expect, test, vi } from "vitest";
import { runScheduled } from "../src/index.ts";
import { createTestDb } from "./helpers/d1.ts";

// index.ts imports the Durable Object classes, which need the Workers runtime; the tests only call runScheduled().
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const NOW = Date.UTC(2026, 10, 19, 12);
const YEARLY_START = Date.UTC(2026, 0, 31, 10);

async function yearlyAccount(db: ReturnType<typeof createTestDb>, n: number) {
  await db
    .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, 0, ?)")
    .bind(`u${n}`, `clerk_u${n}`, `ba${n}`)
    .run();
  await db
    .prepare("INSERT INTO entitlements (user_id, product, source, granted_at, ended_at) VALUES (?, 'plus', 'purchase', 0, NULL)")
    .bind(`u${n}`)
    .run();
  await db
    .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES (?, ?, ?, 'waypoint.plus.yearly', 'subscription', 'active', ?)")
    .bind(`t${n}`, `o${n}`, `ba${n}`, YEARLY_START)
    .run();
}

describe("scheduled", () => {
  test("cleanup throws: the yearly top-up still runs", async () => {
    const db = createTestDb();
    await yearlyAccount(db, 1);
    const commands: Command[] = [];
    const bucket = {
      list: async (): Promise<never> => {
        throw new Error("R2 unavailable");
      },
      delete: async () => {},
    };
    const walletFor = () => ({
      apply: async (command: Command) => {
        commands.push(command);
        return { ok: true as const };
      },
    });
    await expect(runScheduled({ DB: db, BUCKET: bucket }, walletFor, NOW)).rejects.toThrow("R2 unavailable");
    expect(commands.map((command) => command.id)).toEqual(["plus-month:t1:9"]);
  });

  test("cleanup throws: an expired time-limited membership is still ended", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u9', 'clerk_u9', 0, 'ba9')").run();
    await db
      .prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES ('group_eeeeeeeeeeee', 'shared', 'bmFtZS1sb2NrZWQ', 4, NULL)")
      .run();
    await db
      .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, ends_at, history_from, left_at) VALUES ('group_eeeeeeeeeeee', 'u9', 'viewer', 0, ?, 0, NULL)")
      .bind(NOW - 1)
      .run();
    const bucket = {
      list: async (): Promise<never> => {
        throw new Error("R2 unavailable");
      },
      delete: async () => {},
    };
    await expect(runScheduled({ DB: db, BUCKET: bucket }, () => ({ apply: async () => ({ ok: true as const }) }), NOW)).rejects.toThrow("R2 unavailable");
    const row = await db
      .prepare("SELECT m.left_at, g.key_version FROM memberships m JOIN groups g ON g.id = m.group_id WHERE m.user_id = 'u9'")
      .first<{ left_at: number; key_version: number }>();
    expect(row).toEqual({ left_at: NOW - 1, key_version: 5 });
  });
});
