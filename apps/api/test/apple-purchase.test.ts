import { ApiErrorSchema, ApplePurchaseResponseSchema } from "@waypoint/contracts";
import type { Command } from "@waypoint/ledger";
import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import { addMonths, appleProduct } from "../src/apple/products.ts";
import { applyTransaction, type PurchaseOutcome } from "../src/apple/purchases.ts";
import { applePurchaseRoute } from "../src/apple/route.ts";
import { AppleTransactionSchema } from "../src/apple/transaction.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { Db, DbStatement } from "../src/storage.ts";
import { createWalletStore } from "../src/wallet/store.ts";
import { makeChain, signJws, type TestChain } from "./helpers/apple.ts";
import { createTestDb } from "./helpers/d1.ts";
import { createTestStore } from "./helpers/sql.ts";

const NOW = Date.UTC(2026, 10, 19, 12);
const SIGNED_DATE = Date.UTC(2026, 10, 19);
const DAY = 24 * 60 * 60 * 1000;
const A = "6f1c2b9a-0000-4000-8000-000000000001";
const B = "6f1c2b9a-0000-4000-8000-000000000002";
const C = "6f1c2b9a-0000-4000-8000-000000000003";
const D = "6f1c2b9a-0000-4000-8000-000000000004";

let chain: TestChain;
let db: Db;
let userA: SessionUser;
let userB: SessionUser;

// Per billing account, a real wallet store; every command sent to it is recorded.
const wallets = new Map<string, ReturnType<typeof createWalletStore>>();
const commands: Command[] = [];
const walletFor = (id: string) => {
  let wallet = wallets.get(id);
  if (wallet === undefined) {
    wallet = createWalletStore(createTestStore());
    wallets.set(id, wallet);
  }
  return wallet;
};
const WALLET = {
  idFromName: (name: string) => name,
  get: (id: string) => ({
    apply: async (command: Command) => {
      commands.push(command);
      return walletFor(id).apply(command, NOW);
    },
  }),
};

beforeAll(async () => {
  chain = await makeChain();
});

async function addUser(id: string, zeroRetention = false): Promise<SessionUser> {
  await db
    .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
    .bind(id, `clerk_${id}`, NOW, id)
    .run();
  if (zeroRetention) await db.prepare("UPDATE users SET zero_retention = 1 WHERE id = ?").bind(id).run();
  return { id, clerk_id: `clerk_${id}`, plan: "free", billing_account_id: id, zero_retention: zeroRetention };
}

beforeEach(async () => {
  db = createTestDb();
  wallets.clear();
  commands.splice(0);
  userA = await addUser(A);
  userB = await addUser(B);
});

function appFor(user: SessionUser, now = NOW): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", applePurchaseRoute({ now: () => now, rootSha256: chain.rootSha256 }));
  return app;
}

function envWith(overrides: Record<string, string> = {}): Record<string, unknown> {
  return {
    DB: db,
    WALLET,
    APPLE_BUNDLE_ID: "com.example.waypoint",
    APPLE_ENVIRONMENTS: "Production,Sandbox",
    ...overrides,
  };
}

async function send(
  signed: string,
  options: { user?: SessionUser; key?: string; env?: Record<string, unknown>; at?: number } = {},
): Promise<Response> {
  return appFor(options.user ?? userA, options.at).request(
    "/v1/purchases/apple",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": options.key ?? crypto.randomUUID() },
      body: JSON.stringify({ signed_transaction: signed }),
    },
    options.env ?? envWith(),
  );
}

function transaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transactionId: "2000000000000001",
    originalTransactionId: "2000000000000001",
    bundleId: "com.example.waypoint",
    productId: "waypoint.credits.1000",
    type: "Consumable",
    inAppOwnershipType: "PURCHASED",
    environment: "Production",
    purchaseDate: Date.UTC(2026, 10, 18),
    signedDate: SIGNED_DATE,
    storefront: "USA",
    ...overrides,
  };
}

function jwsFor(overrides: Record<string, unknown> = {}): Promise<string> {
  return signJws(transaction(overrides), chain);
}

async function expectError(res: Response, status: number, code: string, message: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(ApiErrorSchema.parse(await res.json())).toEqual({ code, message, retry_after: null });
}

async function countRows(sql: string, ...values: string[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ n: number }>();
  return row === null ? 0 : row.n;
}

describe("POST /v1/purchases/apple", () => {
  test("a 1,000-credit pack gives 200 with the reply, 1000 purchased credits and one active consumable row", async () => {
    const res = await send(await jwsFor(), { user: userA });
    expect(res.status).toBe(200);
    const body = ApplePurchaseResponseSchema.parse(await res.json());
    expect(body).toEqual({ transaction_id: "2000000000000001", product: "pack", credits: 1000, plan: "free" });
    expect(walletFor(A).read().purchased).toBe(1000);
    const row = await db
      .prepare("SELECT kind, status FROM purchases WHERE transaction_id = ?")
      .bind("2000000000000001")
      .first<{ kind: string; status: string }>();
    expect(row).toEqual({ kind: "consumable", status: "active" });
  });

  test("the same JWS with a new key gives 200 and grants nothing more; both wallet commands had the transaction's id", async () => {
    const jws = await jwsFor();
    expect((await send(jws, { user: userA })).status).toBe(200);
    const again = await send(jws, { user: userA });
    expect(again.status).toBe(200);
    expect(walletFor(A).read().purchased).toBe(1000);
    expect(commands.map((c) => c.id)).toEqual(["apple:txn:2000000000000001", "apple:txn:2000000000000001"]);
  });

  test("the same JWS with the same key replays the stored reply and sends no wallet command", async () => {
    const jws = await jwsFor();
    const first = await send(jws, { user: userA, key: "replay-key-0000001" });
    expect(first.status).toBe(200);
    const replay = await send(jws, { user: userA, key: "replay-key-0000001" });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(await first.json());
    expect(commands).toHaveLength(1);
  });

  test("quantity 3 on the 5,000-credit pack grants 15,000 credits", async () => {
    const jws = await jwsFor({ transactionId: "2000000000000002", originalTransactionId: "2000000000000002", productId: "waypoint.credits.5000", quantity: 3 });
    const res = await send(jws, { user: userA });
    expect(ApplePurchaseResponseSchema.parse(await res.json())).toMatchObject({ product: "pack", credits: 15000 });
    expect(walletFor(A).read().purchased).toBe(15000);
  });

  test("Own it gives 2,000 credits, plan own, and an open own_it entitlement from a purchase", async () => {
    const jws = await jwsFor({ transactionId: "2000000000000003", originalTransactionId: "2000000000000003", productId: "waypoint.own_it", type: "Non-Consumable" });
    const res = await send(jws, { user: userA });
    expect(ApplePurchaseResponseSchema.parse(await res.json())).toEqual({
      transaction_id: "2000000000000003",
      product: "own_it",
      credits: 2000,
      plan: "own",
    });
    const entitlement = await db
      .prepare("SELECT source, ended_at FROM entitlements WHERE user_id = ? AND product = 'own_it'")
      .bind(A)
      .first<{ source: string; ended_at: number | null }>();
    expect(entitlement).toEqual({ source: "purchase", ended_at: null });
    const user = await db.prepare("SELECT plan FROM users WHERE id = ?").bind(A).first<{ plan: string }>();
    expect(user?.plan).toBe("own");
  });

  test("Own it shared through Family Sharing gives 0 credits, plan own, a family_share entitlement and no wallet command for the second user", async () => {
    const jws = await jwsFor({
      transactionId: "2000000000000010",
      originalTransactionId: "2000000000000010",
      productId: "waypoint.own_it",
      type: "Non-Consumable",
      inAppOwnershipType: "FAMILY_SHARED",
    });
    const res = await send(jws, { user: userB });
    expect(ApplePurchaseResponseSchema.parse(await res.json())).toMatchObject({ credits: 0, plan: "own" });
    expect(commands).toHaveLength(0);
    const entitlement = await db
      .prepare("SELECT source FROM entitlements WHERE user_id = ? AND product = 'own_it'")
      .bind(B)
      .first<{ source: string }>();
    expect(entitlement?.source).toBe("family_share");
  });

  test("monthly Plus gives 2,000 credits, plan plus, a reset to 2,000 that ends at expiresDate", async () => {
    const expiresDate = NOW + 30 * DAY;
    const jws = await jwsFor({
      transactionId: "2000000000000020",
      originalTransactionId: "2000000000000020",
      productId: "waypoint.plus.monthly",
      type: "Auto-Renewable Subscription",
      expiresDate,
    });
    const res = await send(jws, { user: userA });
    expect(ApplePurchaseResponseSchema.parse(await res.json())).toMatchObject({ product: "plus", credits: 2000, plan: "plus" });
    const view = walletFor(A).read();
    expect(view.monthly).toBe(2000);
    expect(view.monthly_resets_at).toBe(expiresDate);
    expect(commands.map((c) => c.type)).toEqual(["reset"]);
  });

  test("yearly Plus bought on 31 January resets monthly credits on 28 February (one calendar month after purchase)", async () => {
    const jws = await jwsFor({
      transactionId: "2000000000000021",
      originalTransactionId: "2000000000000021",
      productId: "waypoint.plus.yearly",
      type: "Auto-Renewable Subscription",
      purchaseDate: Date.UTC(2026, 0, 31, 10),
      expiresDate: Date.UTC(2027, 0, 31, 10),
    });
    const res = await send(jws, { user: userA });
    expect(res.status).toBe(200);
    expect(walletFor(A).read().monthly_resets_at).toBe(Date.UTC(2026, 1, 28, 10));
  });

  test("Plus whose period is already over gives 0 credits, plan free, no wallet command and an expired row", async () => {
    const jws = await jwsFor({
      transactionId: "2000000000000022",
      originalTransactionId: "2000000000000022",
      productId: "waypoint.plus.monthly",
      type: "Auto-Renewable Subscription",
      expiresDate: NOW - DAY,
    });
    const res = await send(jws, { user: userA });
    expect(ApplePurchaseResponseSchema.parse(await res.json())).toMatchObject({ credits: 0, plan: "free" });
    expect(commands).toHaveLength(0);
    const row = await db
      .prepare("SELECT status FROM purchases WHERE transaction_id = ?")
      .bind("2000000000000022")
      .first<{ status: string }>();
    expect(row?.status).toBe("expired");
  });

  test("replaying an active Plus transaction after it has expired does not reopen plus and replies 0 credits", async () => {
    const expiresDate = NOW + 30 * DAY;
    const jws = await jwsFor({
      transactionId: "2000000000000025",
      originalTransactionId: "2000000000000025",
      productId: "waypoint.plus.monthly",
      type: "Auto-Renewable Subscription",
      expiresDate,
    });
    expect((await send(jws, { user: userA })).status).toBe(200);
    // The lapse ends the entitlement. Nothing else in this path reopens it.
    await db.prepare("UPDATE entitlements SET ended_at = ? WHERE user_id = ? AND product = 'plus'").bind(expiresDate, A).run();
    const res = await send(jws, { user: userA, at: NOW + 60 * DAY });
    expect(ApplePurchaseResponseSchema.parse(await res.json())).toEqual({
      transaction_id: "2000000000000025",
      product: "plus",
      credits: 0,
      plan: "free",
    });
    expect(commands.map((c) => c.type)).toEqual(["reset"]);
    expect(walletFor(A).read().monthly).toBe(2000);
  });

  test("a refunded transaction sent again gives 409 refunded, grants nothing and its row stays refunded", async () => {
    const jws = await jwsFor({ transactionId: "2000000000000060", originalTransactionId: "2000000000000060" });
    expect((await send(jws, { user: userA })).status).toBe(200);
    await db.prepare("UPDATE purchases SET status = 'refunded' WHERE transaction_id = ?").bind("2000000000000060").run();
    const before = commands.length;
    await expectError(await send(jws, { user: userA }), 409, "conflict", "purchase was refunded");
    expect(commands).toHaveLength(before);
    expect(walletFor(A).read().purchased).toBe(1000);
    expect(await countRows("SELECT COUNT(*) AS n FROM purchases WHERE transaction_id = ? AND status = 'refunded'", "2000000000000060")).toBe(1);
  });

  test("a Family Sharing copy of a transaction the first user bought gives 409 and no entitlement for the second user", async () => {
    const owned = {
      transactionId: "2000000000000061",
      originalTransactionId: "2000000000000061",
      productId: "waypoint.own_it",
      type: "Non-Consumable",
    };
    expect((await send(await jwsFor(owned), { user: userA })).status).toBe(200);
    const shared = await jwsFor({ ...owned, inAppOwnershipType: "FAMILY_SHARED" });
    await expectError(await send(shared, { user: userB }), 409, "conflict", "purchase belongs to another account");
    expect(await countRows("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?", B)).toBe(0);
    expect(walletFor(B).read().purchased).toBe(0);
  });

  test("a transaction sent again with a different purchase date keeps the row it first recorded", async () => {
    const id = "2000000000000062";
    expect((await send(await jwsFor({ transactionId: id, originalTransactionId: id, purchaseDate: Date.UTC(2026, 10, 10) }), { user: userA })).status).toBe(200);
    expect((await send(await jwsFor({ transactionId: id, originalTransactionId: id, purchaseDate: Date.UTC(2026, 10, 12) }), { user: userA })).status).toBe(200);
    expect(await countRows("SELECT COUNT(*) AS n FROM purchases WHERE transaction_id = ?", id)).toBe(1);
    const row = await db.prepare("SELECT purchased_at FROM purchases WHERE transaction_id = ?").bind(id).first<{ purchased_at: number }>();
    expect(row?.purchased_at).toBe(Date.UTC(2026, 10, 10));
  });

  test("the 20,000-credit pack grants 20,000 purchased credits", async () => {
    const jws = await jwsFor({ transactionId: "2000000000000063", originalTransactionId: "2000000000000063", productId: "waypoint.credits.20000" });
    const res = await send(jws, { user: userA });
    expect(ApplePurchaseResponseSchema.parse(await res.json())).toMatchObject({ product: "pack", credits: 20000 });
    expect(walletFor(A).read().purchased).toBe(20000);
  });

  test("a productId of toString or __proto__ gives 400 unknown product", async () => {
    await expectError(await send(await jwsFor({ productId: "toString", type: "Consumable" }), { user: userA }), 400, "bad_request", "unknown product");
    await expectError(await send(await jwsFor({ productId: "__proto__", type: "Consumable" }), { user: userA }), 400, "bad_request", "unknown product");
  });

  test("a quantity over 100 gives 400 invalid purchase and grants nothing", async () => {
    const jws = await jwsFor({ transactionId: "2000000000000064", originalTransactionId: "2000000000000064", quantity: 101 });
    await expectError(await send(jws, { user: userA }), 400, "bad_request", "invalid purchase");
    expect(walletFor(A).read().purchased).toBe(0);
  });

  test("a user with zero retention who buys a pack has it turned off afterwards", async () => {
    const user = await addUser(C, true);
    const res = await send(await jwsFor({ transactionId: "2000000000000023", originalTransactionId: "2000000000000023" }), { user });
    expect(res.status).toBe(200);
    const row = await db.prepare("SELECT zero_retention FROM users WHERE id = ?").bind(C).first<{ zero_retention: number }>();
    expect(row?.zero_retention).toBe(0);
  });

  test("a Plus buyer with zero retention on keeps it", async () => {
    const user = await addUser(D, true);
    const res = await send(
      await jwsFor({
        transactionId: "2000000000000024",
        originalTransactionId: "2000000000000024",
        productId: "waypoint.plus.monthly",
        type: "Auto-Renewable Subscription",
        expiresDate: NOW + 30 * DAY,
      }),
      { user },
    );
    expect(res.status).toBe(200);
    const row = await db.prepare("SELECT zero_retention FROM users WHERE id = ?").bind(D).first<{ zero_retention: number }>();
    expect(row?.zero_retention).toBe(1);
  });

  test("another user sending a transaction the first user recorded gives 409 and leaves the other wallet unchanged", async () => {
    expect((await send(await jwsFor(), { user: userA })).status).toBe(200);
    const res = await send(await jwsFor(), { user: userB });
    await expectError(res, 409, "conflict", "purchase belongs to another account");
    expect(walletFor(B).read().purchased).toBe(0);
  });

  test("another user sending a Plus renewal of the first user's subscription gives 409", async () => {
    const plus = { productId: "waypoint.plus.monthly", type: "Auto-Renewable Subscription", expiresDate: NOW + 30 * DAY };
    expect((await send(await jwsFor({ ...plus, transactionId: "2000000000000030", originalTransactionId: "2000000000000030" }), { user: userA })).status).toBe(200);
    const res = await send(await jwsFor({ ...plus, transactionId: "2000000000000031", originalTransactionId: "2000000000000030" }), { user: userB });
    await expectError(res, 409, "conflict", "purchase belongs to another account");
  });

  test("appAccountToken of another user gives 409; the same user's id in capitals gives 200", async () => {
    const other = await jwsFor({ transactionId: "2000000000000040", originalTransactionId: "2000000000000040", appAccountToken: B });
    await expectError(await send(other, { user: userA }), 409, "conflict", "purchase belongs to another account");
    const own = await jwsFor({ transactionId: "2000000000000041", originalTransactionId: "2000000000000041", appAccountToken: A.toUpperCase() });
    expect((await send(own, { user: userA })).status).toBe(200);
  });

  test("a transaction with revocationDate gives 409 refunded and writes no purchase row", async () => {
    const res = await send(await jwsFor({ transactionId: "2000000000000050", originalTransactionId: "2000000000000050", revocationDate: NOW - DAY }), { user: userA });
    await expectError(res, 409, "conflict", "purchase was refunded");
    expect(await countRows("SELECT COUNT(*) AS n FROM purchases")).toBe(0);
  });

  test("a wrong bundleId, an environment of Xcode, or an environment not in APPLE_ENVIRONMENTS gives 400 invalid purchase", async () => {
    await expectError(await send(await jwsFor({ bundleId: "com.other.app" }), { user: userA }), 400, "bad_request", "invalid purchase");
    await expectError(await send(await jwsFor({ environment: "Xcode" }), { user: userA }), 400, "bad_request", "invalid purchase");
    const sandbox = await jwsFor({ environment: "Sandbox" });
    await expectError(await send(sandbox, { user: userA, env: envWith({ APPLE_ENVIRONMENTS: "Production" }) }), 400, "bad_request", "invalid purchase");
  });

  test("an unknown productId, or a type that does not match the product, gives 400 unknown product", async () => {
    await expectError(await send(await jwsFor({ productId: "nope" }), { user: userA }), 400, "bad_request", "unknown product");
    await expectError(await send(await jwsFor({ type: "Non-Consumable" }), { user: userA }), 400, "bad_request", "unknown product");
  });

  test("a payload without transactionId, or with transactionId 1/2, gives 400 invalid purchase", async () => {
    await expectError(await send(await jwsFor({ transactionId: undefined }), { user: userA }), 400, "bad_request", "invalid purchase");
    await expectError(await send(await jwsFor({ transactionId: "1/2" }), { user: userA }), 400, "bad_request", "invalid purchase");
  });

  test("a JWS signed by another chain gives 400 invalid purchase, and the body does not echo the signed text", async () => {
    const other = await makeChain();
    const jws = await signJws(transaction(), other);
    const res = await send(jws, { user: userA });
    const text = await res.text();
    expect(res.status).toBe(400);
    expect(ApiErrorSchema.parse(JSON.parse(text))).toEqual({ code: "bad_request", message: "invalid purchase", retry_after: null });
    expect(text).not.toContain(jws);
  });

  test("bad JSON, an extra key or a missing field gives 400 invalid request", async () => {
    const bodies = ["{not json", JSON.stringify({ signed_transaction: "x", extra: 1 }), "{}"];
    for (const body of bodies) {
      const res = await appFor(userA).request(
        "/v1/purchases/apple",
        { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body },
        envWith(),
      );
      await expectError(res, 400, "bad_request", "invalid request");
    }
  });

  test("addMonths keeps the day where it can, clamps to the month's last day, and keeps the time of day", () => {
    expect(addMonths(Date.UTC(2026, 0, 31), 1)).toBe(Date.UTC(2026, 1, 28));
    expect(addMonths(Date.UTC(2026, 11, 15), 1)).toBe(Date.UTC(2027, 0, 15));
    expect(addMonths(Date.UTC(2028, 0, 31), 1)).toBe(Date.UTC(2028, 1, 29));
    expect(addMonths(Date.UTC(2026, 0, 15, 10, 30), 1)).toBe(Date.UTC(2026, 1, 15, 10, 30));
  });
});

// A Db that runs `between` right after the first statement it is given, before handing back that statement's result:
// another request lands in the middle of this one.
function interrupted(inner: Db, between: () => Promise<void>): Db {
  let done = false;
  const once = async (): Promise<void> => {
    if (done) return;
    done = true;
    await between();
  };
  const wrap = (statement: DbStatement): DbStatement => ({
    bind: (...values: unknown[]) => wrap(statement.bind(...values)),
    first: async <T,>() => {
      const result = await statement.first<T>();
      await once();
      return result;
    },
    all: async <T,>() => {
      const result = await statement.all<T>();
      await once();
      return result;
    },
    run: async () => {
      const result = await statement.run();
      await once();
      return result;
    },
  });
  return { prepare: (query: string) => wrap(inner.prepare(query)) };
}

// What Clerk's user.deleted does to an account's purchases (apps/api/src/webhooks/clerk.ts).
async function deleteAccount(id: string): Promise<void> {
  await db.prepare("UPDATE purchases SET released_at = ? WHERE billing_account_id = ? AND kind IN ('non_consumable', 'subscription')").bind(NOW, id).run();
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
}

describe("POST /v1/purchases/apple: purchases of a deleted account", () => {
  test("Own it: the next account gets the entitlement and plan own with 0 credits, once; a third account gets 409", async () => {
    const own = await jwsFor({ transactionId: "2000000000000050", originalTransactionId: "2000000000000050", productId: "waypoint.own_it", type: "Non-Consumable", appAccountToken: A });
    expect((await send(own, { user: userA })).status).toBe(200);
    await deleteAccount(A);
    commands.splice(0);
    const userC = await addUser(C);
    const res = await send(own, { user: userC });
    expect(ApplePurchaseResponseSchema.parse(await res.json())).toEqual({ transaction_id: "2000000000000050", product: "own_it", credits: 0, plan: "own" });
    expect(commands).toHaveLength(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM purchases WHERE billing_account_id = ?", C)).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ? AND product = 'own_it' AND ended_at IS NULL", C)).toBe(1);
    expect(ApplePurchaseResponseSchema.parse(await (await send(own, { user: userC })).json()).credits).toBe(0);
    expect(commands).toHaveLength(0);
    expect(walletFor(C).read().purchased).toBe(0);
    const userD = await addUser(D);
    await expectError(await send(own, { user: userD }), 409, "conflict", "purchase belongs to another account");
  });

  test("Plus: the claimed period gives plan plus and no reset; the next renewal resets to 2,000 for the new account", async () => {
    const plus = { productId: "waypoint.plus.monthly", type: "Auto-Renewable Subscription", appAccountToken: A, expiresDate: NOW + 20 * DAY };
    expect((await send(await jwsFor({ ...plus, transactionId: "2000000000000060", originalTransactionId: "2000000000000060" }), { user: userA })).status).toBe(200);
    await deleteAccount(A);
    commands.splice(0);
    const userC = await addUser(C);
    const claimed = await send(await jwsFor({ ...plus, transactionId: "2000000000000060", originalTransactionId: "2000000000000060" }), { user: userC });
    expect(ApplePurchaseResponseSchema.parse(await claimed.json())).toMatchObject({ product: "plus", credits: 0, plan: "plus" });
    expect(commands).toHaveLength(0);
    const renewal = await send(
      await jwsFor({ ...plus, transactionId: "2000000000000061", originalTransactionId: "2000000000000060", purchaseDate: NOW, expiresDate: NOW + 30 * DAY }),
      { user: userC },
    );
    expect(ApplePurchaseResponseSchema.parse(await renewal.json())).toMatchObject({ credits: 2000, plan: "plus" });
    expect(commands.map((c) => c.type)).toEqual(["reset"]);
    expect(walletFor(C).read().monthly).toBe(2000);
  });

  test("the 409 'belongs to another account' is not stored: after that account is deleted, the same Idempotency-Key claims it", async () => {
    const fields = { transactionId: "2000000000000095", originalTransactionId: "2000000000000095", productId: "waypoint.own_it", type: "Non-Consumable", appAccountToken: A };
    const own = await jwsFor(fields);
    expect((await send(own, { user: userA })).status).toBe(200);
    const userC = await addUser(C);
    const key = "apple_txn_2000000000000095";
    await expectError(await send(own, { user: userC, key }), 409, "conflict", "purchase belongs to another account");
    expect(await countRows("SELECT COUNT(*) AS n FROM idempotency WHERE key = ?", key)).toBe(0);
    await deleteAccount(A);
    const res = await send(own, { user: userC, key });
    expect(res.status).toBe(200);
    expect(res.headers.get("Idempotent-Replayed")).toBeNull();
  });

  test("two accounts claiming at once: the claim that lands second gets other_account and no entitlement", async () => {
    const fields = { transactionId: "2000000000000090", originalTransactionId: "2000000000000090", productId: "waypoint.own_it", type: "Non-Consumable", appAccountToken: A };
    expect((await send(await jwsFor(fields), { user: userA })).status).toBe(200);
    await deleteAccount(A);
    await addUser(C);
    await addUser(D);
    const txn = AppleTransactionSchema.parse(transaction(fields));
    const product = appleProduct("waypoint.own_it");
    if (product === undefined) throw new Error("unknown product");
    const claim = (id: string, on: Db) => applyTransaction(on, WALLET.get(id), { user_id: id, billing_account_id: id }, txn, product, NOW);
    const second: PurchaseOutcome[] = [];
    // D's first statement runs, then C's whole claim, then the rest of D's.
    const first = await claim(D, interrupted(db, async () => void second.push(await claim(C, db))));
    expect(first).toMatchObject({ ok: true, credits: 0 });
    expect(second).toEqual([{ ok: false, reason: "other_account" }]);
    expect(await countRows("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?", C)).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM purchases WHERE billing_account_id = ?", D)).toBe(1);
  });

  test("a token of an account that never existed, for a purchase nobody released, gets 409", async () => {
    const own = await jwsFor({ transactionId: "2000000000000095", originalTransactionId: "2000000000000095", productId: "waypoint.own_it", type: "Non-Consumable", appAccountToken: C });
    await expectError(await send(own, { user: userB }), 409, "conflict", "purchase belongs to another account");
  });

  test("a pack stays with the deleted account: the next account gets 409 and no credits", async () => {
    const pack = await jwsFor({ transactionId: "2000000000000070", originalTransactionId: "2000000000000070", appAccountToken: A });
    expect((await send(pack, { user: userA })).status).toBe(200);
    await deleteAccount(A);
    const userC = await addUser(C);
    await expectError(await send(pack, { user: userC }), 409, "conflict", "purchase belongs to another account");
    expect(walletFor(C).read().purchased).toBe(0);
  });

  test("the account still exists: its released rows cannot be claimed", async () => {
    const own = await jwsFor({ transactionId: "2000000000000080", originalTransactionId: "2000000000000080", productId: "waypoint.own_it", type: "Non-Consumable" });
    expect((await send(own, { user: userA })).status).toBe(200);
    await db.prepare("UPDATE purchases SET released_at = ? WHERE billing_account_id = ?").bind(NOW, A).run();
    await expectError(await send(own, { user: userB }), 409, "conflict", "purchase belongs to another account");
  });
});
