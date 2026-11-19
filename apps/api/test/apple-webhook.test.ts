import { ApiErrorSchema } from "@waypoint/contracts";
import type { Command } from "@waypoint/ledger";
import { Hono } from "hono";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { appleProduct } from "../src/apple/products.ts";
import { applyTransaction, type PurchaseAccount, type WalletCommands } from "../src/apple/purchases.ts";
import type { AppleTransaction } from "../src/apple/transaction.ts";
import { appleWebhookRoute } from "../src/apple/webhook.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { Db } from "../src/storage.ts";
import { createWalletStore } from "../src/wallet/store.ts";
import { makeChain, signJws, type TestChain } from "./helpers/apple.ts";
import { createTestDb } from "./helpers/d1.ts";
import { createTestStore } from "./helpers/sql.ts";

const NOW = Date.UTC(2026, 10, 19, 12);
const DAY = 24 * 60 * 60 * 1000;
const BUNDLE = "app.waypoint.ios";
const A = "6f1c2b9a-0000-4000-8000-000000000001";
const B = "6f1c2b9a-0000-4000-8000-000000000002";
const U1 = "5e1f0000-0000-4000-8000-000000000001";
const U2 = "5e1f0000-0000-4000-8000-000000000002";
const U3 = "5e1f0000-0000-4000-8000-000000000003";

let chain: TestChain;
let db: Db;

// One real wallet per billing account; every command sent to a wallet is recorded in order.
const stores = new Map<string, ReturnType<typeof createWalletStore>>();
const commands: Command[] = [];
function storeFor(billingAccountId: string): ReturnType<typeof createWalletStore> {
  let store = stores.get(billingAccountId);
  if (store === undefined) {
    store = createWalletStore(createTestStore());
    stores.set(billingAccountId, store);
  }
  return store;
}
function walletFor(billingAccountId: string): WalletCommands {
  return {
    apply: async (command: Command) => {
      commands.push(command);
      return storeFor(billingAccountId).apply(command, NOW);
    },
  };
}
const WALLET = {
  idFromName: (name: string) => name,
  get: (id: string) => walletFor(id),
};
const FAILING_WALLET = {
  idFromName: (name: string) => name,
  get: () => ({
    apply: async (): Promise<never> => {
      throw new Error("wallet unavailable");
    },
  }),
};

beforeAll(async () => {
  chain = await makeChain();
});

async function addUser(id: string): Promise<PurchaseAccount> {
  await db
    .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
    .bind(id, `clerk_${id}`, NOW, id)
    .run();
  return { user_id: id, billing_account_id: id };
}

beforeEach(async () => {
  db = createTestDb();
  stores.clear();
  commands.splice(0);
  await addUser(A);
  await addUser(B);
});

function transaction(overrides: Partial<AppleTransaction> = {}): AppleTransaction {
  return {
    transactionId: "2000000000000001",
    originalTransactionId: "2000000000000001",
    bundleId: BUNDLE,
    productId: "waypoint.credits.1000",
    type: "Consumable",
    inAppOwnershipType: "PURCHASED",
    environment: "Production",
    purchaseDate: NOW - DAY,
    signedDate: NOW,
    ...overrides,
  };
}

// The decoded data object of a notice; signedTransactionInfo is signed from txn unless txn is null.
async function dataFor(txn: AppleTransaction | null, overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return {
    bundleId: BUNDLE,
    environment: "Production",
    appAppleId: 1234,
    ...(txn === null ? {} : { signedTransactionInfo: await signJws(txn, chain) }),
    ...overrides,
  };
}

function decoded(
  notificationType: string,
  notificationUUID: string,
  data: Record<string, unknown> | undefined,
  subtype?: string,
): Record<string, unknown> {
  return {
    notificationType,
    ...(subtype === undefined ? {} : { subtype }),
    notificationUUID,
    version: "2.0",
    signedDate: NOW,
    ...(data === undefined ? {} : { data }),
  };
}

async function notice(notificationType: string, notificationUUID: string, txn: AppleTransaction): Promise<string> {
  return signJws(decoded(notificationType, notificationUUID, await dataFor(txn)), chain);
}

function appFor(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.route("/", appleWebhookRoute({ now: () => NOW, rootSha256: chain.rootSha256 }));
  return app;
}

function envWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DB: db,
    WALLET,
    APPLE_BUNDLE_ID: BUNDLE,
    APPLE_ENVIRONMENTS: "Production,Sandbox",
    APPLE_APP_APPLE_ID: "1234",
    ...overrides,
  };
}

async function post(signedPayload: string, env: Record<string, unknown> = envWith()): Promise<Response> {
  return appFor().request(
    "/webhooks/apple",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedPayload }) },
    env,
  );
}

async function expectInvalid(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  expect(ApiErrorSchema.parse(await res.json())).toEqual({
    code: "bad_request",
    message: "invalid notification",
    retry_after: null,
  });
}

async function noticeRows(): Promise<unknown[]> {
  const result = await db.prepare("SELECT * FROM apple_notifications").all<unknown>();
  return result.results;
}

async function planOf(userId: string): Promise<string> {
  const row = await db.prepare("SELECT plan FROM users WHERE id = ?").bind(userId).first<{ plan: string }>();
  if (row === null) throw new Error("no user");
  return row.plan;
}

describe("POST /webhooks/apple", () => {
  test("a ONE_TIME_CHARGE for a pack with appAccountToken gives 200 with an empty body, grants 1000 and records only the uuid, type and time", async () => {
    const txn = transaction({ appAccountToken: A.toUpperCase() });
    const res = await post(await notice("ONE_TIME_CHARGE", U1, txn));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(storeFor(A).read().purchased).toBe(1000);
    expect(await noticeRows()).toEqual([
      { notification_uuid: U1, notification_type: "ONE_TIME_CHARGE", received_at: NOW },
    ]);
  });

  test("the same notice again gives 200 and sends no new wallet command", async () => {
    const payload = await notice("ONE_TIME_CHARGE", U1, transaction({ appAccountToken: A }));
    expect((await post(payload)).status).toBe(200);
    const before = commands.length;
    expect((await post(payload)).status).toBe(200);
    expect(commands.length).toBe(before);
    expect(storeFor(A).read().purchased).toBe(1000);
  });

  test("SUBSCRIBED gives Plus with 2,000 monthly credits, then DID_RENEW resets them under apple:txn:<new transaction id>", async () => {
    const first = transaction({
      transactionId: "2000000000000010",
      originalTransactionId: "2000000000000010",
      productId: "waypoint.plus.monthly",
      type: "Auto-Renewable Subscription",
      appAccountToken: A,
      expiresDate: NOW + 30 * DAY,
    });
    expect((await post(await notice("SUBSCRIBED", U1, first))).status).toBe(200);
    expect(await planOf(A)).toBe("plus");
    expect(storeFor(A).read().monthly).toBe(2000);

    const renewal = { ...first, transactionId: "2000000000000011", purchaseDate: NOW, expiresDate: NOW + 60 * DAY };
    expect((await post(await notice("DID_RENEW", U2, renewal))).status).toBe(200);
    expect(commands.at(-1)).toMatchObject({ type: "reset", id: "apple:txn:2000000000000011", credits: 2000 });
  });

  test("a REFUND of that Plus renewal sets monthly credits to 0 and the plan back to free", async () => {
    const first = transaction({
      transactionId: "2000000000000020",
      originalTransactionId: "2000000000000020",
      productId: "waypoint.plus.monthly",
      type: "Auto-Renewable Subscription",
      appAccountToken: A,
      expiresDate: NOW + 30 * DAY,
    });
    await post(await notice("SUBSCRIBED", U1, first));
    const renewal = { ...first, transactionId: "2000000000000021", purchaseDate: NOW, expiresDate: NOW + 60 * DAY };
    await post(await notice("DID_RENEW", U2, renewal));
    expect((await post(await notice("REFUND", U3, renewal))).status).toBe(200);
    expect(storeFor(A).read().monthly).toBe(0);
    expect(await planOf(A)).toBe("free");
  });

  test("a REFUND of a pack the app recorded takes its 1000 credits back", async () => {
    const txn = transaction({ transactionId: "2000000000000030", originalTransactionId: "2000000000000030" });
    const product = appleProduct(txn.productId);
    if (product === undefined) throw new Error("test product missing");
    await applyTransaction(db, walletFor(A), { user_id: A, billing_account_id: A }, txn, product, NOW);
    expect(storeFor(A).read().purchased).toBe(1000);
    expect((await post(await notice("REFUND", U1, txn))).status).toBe(200);
    expect(storeFor(A).read().purchased).toBe(0);
  });

  test("a notice for a transaction no account knows gives 200, is recorded, and sends no wallet command", async () => {
    const res = await post(await notice("ONE_TIME_CHARGE", U1, transaction({ transactionId: "2000000000000040" })));
    expect(res.status).toBe(200);
    expect(commands).toEqual([]);
    expect(await noticeRows()).toHaveLength(1);
  });

  test("a notice with a productId this app does not sell gives 200, is recorded, and sends no wallet command", async () => {
    const txn = transaction({ productId: "waypoint.unknown", appAccountToken: A });
    expect((await post(await notice("ONE_TIME_CHARGE", U1, txn))).status).toBe(200);
    expect(commands).toEqual([]);
    expect(await noticeRows()).toHaveLength(1);
  });

  test("a TEST notice with data but no signedTransactionInfo gives 200 and is recorded", async () => {
    const payload = await signJws(decoded("TEST", U1, await dataFor(null)), chain);
    expect((await post(payload)).status).toBe(200);
    expect(await noticeRows()).toEqual([{ notification_uuid: U1, notification_type: "TEST", received_at: NOW }]);
  });

  test("a notice with no data (a summary instead) gives 200 and is recorded", async () => {
    const payload = await signJws({ ...decoded("PRICE_INCREASE", U1, undefined), summary: { requestIdentifier: "x" } }, chain);
    expect((await post(payload)).status).toBe(200);
    expect(await noticeRows()).toHaveLength(1);
  });

  test("a notice for another bundleId gives 400 invalid notification and records nothing", async () => {
    const payload = await signJws(
      decoded("TEST", U1, await dataFor(null, { bundleId: "com.example.other" })),
      chain,
    );
    await expectInvalid(await post(payload));
    expect(await noticeRows()).toEqual([]);
  });

  test("a Sandbox notice when APPLE_ENVIRONMENTS is Production only gives 400", async () => {
    const payload = await signJws(
      decoded("TEST", U1, await dataFor(null, { environment: "Sandbox" })),
      chain,
    );
    await expectInvalid(await post(payload, envWith({ APPLE_ENVIRONMENTS: "Production" })));
  });

  test("a Production notice with appAppleId 9 gives 400", async () => {
    const payload = await signJws(decoded("TEST", U1, await dataFor(null, { appAppleId: 9 })), chain);
    await expectInvalid(await post(payload));
  });

  test("a Production notice with no appAppleId gives 400", async () => {
    const payload = await signJws(decoded("TEST", U1, await dataFor(null, { appAppleId: undefined })), chain);
    await expectInvalid(await post(payload));
  });

  test("a Sandbox notice with no appAppleId gives 200", async () => {
    const payload = await signJws(
      decoded("TEST", U1, await dataFor(null, { environment: "Sandbox", appAppleId: undefined })),
      chain,
    );
    expect((await post(payload)).status).toBe(200);
  });

  test("a signedTransactionInfo signed by another chain gives 400", async () => {
    const other = await makeChain();
    const txn = transaction({ appAccountToken: A });
    const data = await dataFor(null, { signedTransactionInfo: await signJws(txn, other) });
    await expectInvalid(await post(await signJws(decoded("ONE_TIME_CHARGE", U1, data), chain)));
    expect(commands).toEqual([]);
  });

  test("a signedTransactionInfo for another bundleId gives 400", async () => {
    const txn = transaction({ appAccountToken: A, bundleId: "com.example.other" });
    await expectInvalid(await post(await notice("ONE_TIME_CHARGE", U1, txn)));
    expect(commands).toEqual([]);
  });

  test("a signedPayload signed by another chain gives 400", async () => {
    const other = await makeChain();
    await expectInvalid(await post(await signJws(decoded("TEST", U1, await dataFor(null)), other)));
  });

  test("a signedPayload that is not a three-part JWS gives 400", async () => {
    await expectInvalid(await post("a.b.c"));
  });

  test("a body that is not JSON gives 400", async () => {
    const res = await appFor().request(
      "/webhooks/apple",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" },
      envWith(),
    );
    await expectInvalid(res);
  });

  test("a body of {} gives 400", async () => {
    const res = await appFor().request(
      "/webhooks/apple",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      envWith(),
    );
    await expectInvalid(res);
  });

  test("a notificationUUID with a slash in it gives 400", async () => {
    const payload = await signJws(decoded("TEST", "abc/def", await dataFor(null)), chain);
    await expectInvalid(await post(payload));
  });

  test("a wallet that throws gives 500 and records nothing, so the same notice succeeds when Apple retries it", async () => {
    const txn = transaction({ appAccountToken: A });
    const payload = await notice("ONE_TIME_CHARGE", U1, txn);
    const failed = await post(payload, envWith({ WALLET: FAILING_WALLET }));
    expect(failed.status).toBe(500);
    expect(await noticeRows()).toEqual([]);

    expect((await post(payload)).status).toBe(200);
    expect(storeFor(A).read().purchased).toBe(1000);
    expect(await noticeRows()).toHaveLength(1);
  });
});
