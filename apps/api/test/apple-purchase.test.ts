import { ApiErrorSchema, ApplePurchaseResponseSchema } from "@waypoint/contracts";
import type { Command } from "@waypoint/ledger";
import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import { addMonths } from "../src/apple/products.ts";
import { applePurchaseRoute } from "../src/apple/route.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { Db } from "../src/storage.ts";
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

function appFor(user: SessionUser): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", applePurchaseRoute({ now: () => NOW, rootSha256: chain.rootSha256 }));
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
  options: { user?: SessionUser; key?: string; env?: Record<string, unknown> } = {},
): Promise<Response> {
  return appFor(options.user ?? userA).request(
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
