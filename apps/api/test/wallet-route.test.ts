import { LedgerResponseSchema, WalletResponseSchema, type LedgerResponse, type WalletResponse } from "@waypoint/contracts";
import type { Command } from "@waypoint/ledger";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { walletRoutes } from "../src/wallet/route.ts";
import { createWalletStore } from "../src/wallet/store.ts";
import { createTestDb } from "./helpers/d1.ts";
import { createTestStore } from "./helpers/sql.ts";

const NOW = 1_800_000_000_000;
const USER: SessionUser = {
  id: "u1",
  clerk_id: "user_1",
  plan: "plus",
  billing_account_id: "billing-1",
  zero_retention: false,
};

// A DB with user u1 (plan plus), and a WALLET stub over a real wallet store that records the names asked for.
async function fixture() {
  const db = createTestDb();
  await db
    .prepare("INSERT INTO users (id, clerk_id, created_at, plan, billing_account_id) VALUES (?, ?, ?, ?, ?)")
    .bind("u1", "user_1", NOW, "plus", "billing-1")
    .run();
  const wallet = createWalletStore(createTestStore());
  const names: string[] = [];
  const env = {
    DB: db,
    WALLET: {
      idFromName(name: string) {
        return name;
      },
      get(id: string) {
        names.push(id);
        return {
          read: async () => wallet.read(),
          ledger: async (after: number, limit: number) => wallet.ledger(after, limit),
        };
      },
    },
  };
  return { env, db, wallet, names };
}

type Wallet = Awaited<ReturnType<typeof fixture>>["wallet"];

function apply(wallet: Wallet, commands: Command[]): void {
  for (const command of commands) {
    wallet.apply(command, NOW);
  }
}

// The seeded wallet: monthly 10, purchased 5, a hold h1 of 12 (takes 10 monthly and 2 purchased), then a clawback of 7.
function seedBalances(wallet: Wallet): void {
  apply(wallet, [
    { type: "grant", id: "g1", bucket: "monthly", credits: 10, ref: "plan" },
    { type: "grant", id: "g2", bucket: "purchased", credits: 5, ref: "pack" },
    { type: "hold", id: "c1", hold_id: "h1", user_id: "u1", task: "summary", credits: 12, expires_at: NOW + 60_000 },
    { type: "clawback", id: "c2", credits: 7, ref: "refund-7" },
  ]);
}

function setup(user: SessionUser = USER) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", walletRoutes({ now: () => NOW }));
  return app;
}

describe("GET /v1/wallet", () => {
  test("the seeded wallet gives 200 with the balance, the plan, and looks up the billing account", async () => {
    const { env, wallet, names } = await fixture();
    seedBalances(wallet);
    const res = await setup().request("/v1/wallet", {}, env);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(WalletResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      balance: { monthly: 0, purchased: 0, held: 12, owed: 4, available: 0 },
      monthly_resets_at: null,
      plan: "plus",
    });
    expect(names).toEqual(["billing-1"]);
  });

  test("monthly_resets_at after a reset command is that command's resets_at", async () => {
    const { env, wallet } = await fixture();
    apply(wallet, [{ type: "reset", id: "r1", credits: 20, resets_at: NOW + 5000 }]);
    const res = await setup().request("/v1/wallet", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ monthly_resets_at: NOW + 5000 });
  });

  test("entitlements with ended_at null or later than now are returned, ordered by granted_at, and not another user's", async () => {
    const { env, db } = await fixture();
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, plan, billing_account_id) VALUES (?, ?, ?, ?, ?)")
      .bind("u2", "user_2", NOW, "plus", "billing-2")
      .run();
    const insert = (userId: string, product: string, grantedAt: number, endedAt: number | null) =>
      db
        .prepare("INSERT INTO entitlements (user_id, product, source, granted_at, ended_at) VALUES (?, ?, ?, ?, ?)")
        .bind(userId, product, "purchase", grantedAt, endedAt)
        .run();
    await insert("u1", "b", 2000, null);
    await insert("u1", "a", 1000, NOW + 1000);
    await insert("u1", "c", 1500, NOW - 1);
    await insert("u2", "z", 500, null);

    const res = await setup().request("/v1/wallet", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WalletResponse;
    expect(body.entitlements).toEqual([
      { product: "a", source: "purchase", media_cap_gb: 3, granted_at: 1000, ended_at: NOW + 1000 },
      { product: "b", source: "purchase", media_cap_gb: 3, granted_at: 2000, ended_at: null },
    ]);
  });

  test("a new wallet with no rows gives all zeros and no entitlements", async () => {
    const { env } = await fixture();
    const res = await setup().request("/v1/wallet", {}, env);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(WalletResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({
      balance: { monthly: 0, purchased: 0, held: 0, owed: 0, available: 0 },
      monthly_resets_at: null,
      plan: "plus",
      entitlements: [],
    });
  });
});

describe("GET /v1/wallet/ledger", () => {
  test("limit=2 gives 2 entries, next 2 and the open hold, and a later page continues from after", async () => {
    const { env, wallet } = await fixture();
    seedBalances(wallet);
    const first = await setup().request("/v1/wallet/ledger?limit=2", {}, env);
    expect(first.status).toBe(200);
    const firstBody: unknown = await first.json();
    expect(LedgerResponseSchema.safeParse(firstBody).success).toBe(true);
    const page = firstBody as LedgerResponse;
    expect(page.entries).toHaveLength(2);
    expect(page.next).toBe(2);
    expect(page.open_holds).toEqual(["h1"]);

    const all = (await (await setup().request("/v1/wallet/ledger?limit=100", {}, env)).json()) as LedgerResponse;
    const second = await setup().request("/v1/wallet/ledger?after=2", {}, env);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as LedgerResponse;
    expect(secondBody.entries).toEqual(all.entries.slice(2));
  });

  test("paging to the end gives an empty entries and next equal to after", async () => {
    const { env, wallet } = await fixture();
    seedBalances(wallet);
    let after = 0;
    let entries = 0;
    for (;;) {
      const res = await setup().request(`/v1/wallet/ledger?after=${after}&limit=2`, {}, env);
      const page = (await res.json()) as LedgerResponse;
      entries += page.entries.length;
      if (page.entries.length === 0) {
        expect(page.next).toBe(after);
        break;
      }
      after = page.next;
    }
    expect(entries).toBeGreaterThan(0);
  });

  test("with no query it gives up to 50 entries from the start", async () => {
    const { env, wallet } = await fixture();
    apply(
      wallet,
      Array.from({ length: 60 }, (_, i) => ({
        type: "grant" as const,
        id: `g${i + 1}`,
        bucket: "monthly" as const,
        credits: 1,
        ref: "plan",
      })),
    );
    const res = await setup().request("/v1/wallet/ledger", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LedgerResponse;
    expect(body.entries).toHaveLength(50);
    expect(body.next).toBe(50);
  });

  test("limit=100 is allowed", async () => {
    const { env, wallet } = await fixture();
    seedBalances(wallet);
    const res = await setup().request("/v1/wallet/ledger?limit=100", {}, env);
    expect(res.status).toBe(200);
    expect(LedgerResponseSchema.safeParse(await res.json()).success).toBe(true);
  });

  test.each(["limit=0", "limit=101", "limit=1.5", "limit=", "after=-1", "after=x", "after=1e3"])(
    "%s gives 400 bad_request",
    async (query) => {
      const { env } = await fixture();
      const res = await setup().request(`/v1/wallet/ledger?${query}`, {}, env);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
    },
  );

  test("open_holds is empty after the hold is settled", async () => {
    const { env, wallet } = await fixture();
    apply(wallet, [
      { type: "grant", id: "g1", bucket: "monthly", credits: 10, ref: "plan" },
      { type: "hold", id: "c1", hold_id: "h1", user_id: "u1", task: "summary", credits: 4, expires_at: NOW + 60_000 },
      { type: "settle", id: "s1", hold_id: "h1", actual: 4 },
    ]);
    const res = await setup().request("/v1/wallet/ledger", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ open_holds: [] });
  });
});
