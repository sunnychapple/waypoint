import type { Command } from "@waypoint/ledger";
import { beforeEach, describe, expect, test } from "vitest";
import { appleProduct, type AppleProduct } from "../src/apple/products.ts";
import {
  actionFor,
  applyNotice,
  findAccount,
  refundCredits,
  type AppleNotification,
} from "../src/apple/notifications.ts";
import { applyTransaction, type PurchaseAccount, type WalletCommands } from "../src/apple/purchases.ts";
import type { AppleTransaction } from "../src/apple/transaction.ts";
import type { Db } from "../src/storage.ts";
import { createWalletStore } from "../src/wallet/store.ts";
import { createTestDb } from "./helpers/d1.ts";
import { createTestStore } from "./helpers/sql.ts";

const NOW = Date.UTC(2026, 10, 19, 12);
const DAY = 24 * 60 * 60 * 1000;
const BUNDLE = "app.waypoint.ios";
const A = "6f1c2b9a-0000-4000-8000-000000000001";
const B = "6f1c2b9a-0000-4000-8000-000000000002";

let db: Db;
let accountA: PurchaseAccount;
let accountB: PurchaseAccount;

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
function read(account: PurchaseAccount) {
  return storeFor(account.billing_account_id).read();
}

async function one<T>(sql: string, ...values: unknown[]): Promise<T> {
  const row = await db.prepare(sql).bind(...values).first<T>();
  if (row === null) throw new Error(`no row for: ${sql}`);
  return row;
}

async function addUser(id: string, zeroRetention = false): Promise<PurchaseAccount> {
  await db
    .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
    .bind(id, `clerk_${id}`, NOW, id)
    .run();
  if (zeroRetention) await db.prepare("UPDATE users SET zero_retention = 1 WHERE id = ?").bind(id).run();
  return { user_id: id, billing_account_id: id };
}

beforeEach(async () => {
  db = createTestDb();
  stores.clear();
  commands.splice(0);
  accountA = await addUser(A);
  accountB = await addUser(B);
});

const uuid = (n: number): string => `5e1f0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function productOf(productId: string): AppleProduct {
  const product = appleProduct(productId);
  if (product === undefined) throw new Error(`unknown product ${productId}`);
  return product;
}

// A transaction as Apple's decoded signedTransactionInfo would look, with overrides.
function transaction(id: string, productId: string, extra: Partial<AppleTransaction> = {}): AppleTransaction {
  return {
    transactionId: id,
    originalTransactionId: id,
    bundleId: BUNDLE,
    productId,
    type: productOf(productId).appleType,
    inAppOwnershipType: "PURCHASED",
    environment: "Sandbox",
    purchaseDate: NOW - DAY,
    signedDate: NOW,
    ...extra,
  };
}

function notice(notificationType: string, notificationUUID: string, subtype?: string): AppleNotification {
  return subtype === undefined
    ? { notificationType, notificationUUID, signedDate: NOW }
    : { notificationType, subtype, notificationUUID, signedDate: NOW };
}

// Records a transaction for an account the way the app's POST does, without sending a notice.
async function record(account: PurchaseAccount, txn: AppleTransaction): Promise<void> {
  await applyTransaction(db, walletFor(account.billing_account_id), account, txn, productOf(txn.productId), NOW);
}

// Applies a notice for a transaction the same way the webhook will.
async function apply(account: PurchaseAccount, n: AppleNotification, txn: AppleTransaction): Promise<void> {
  await applyNotice({
    db,
    wallet: walletFor(account.billing_account_id),
    account,
    notification: n,
    txn,
    product: productOf(txn.productId),
    now: NOW,
  });
}

async function planOf(userId: string): Promise<string> {
  return (await one<{ plan: string }>("SELECT plan FROM users WHERE id = ?", userId)).plan;
}

describe("actionFor", () => {
  test("maps each notice in the table to its action", () => {
    expect(actionFor("SUBSCRIBED", undefined)).toBe("grant");
    expect(actionFor("DID_RENEW", undefined)).toBe("grant");
    expect(actionFor("ONE_TIME_CHARGE", undefined)).toBe("grant");
    expect(actionFor("OFFER_REDEEMED", undefined)).toBe("grant");
    expect(actionFor("DID_CHANGE_RENEWAL_PREF", "UPGRADE")).toBe("grant");
    expect(actionFor("REFUND", undefined)).toBe("refund");
    expect(actionFor("REVOKE", undefined)).toBe("revoke");
    expect(actionFor("EXPIRED", undefined)).toBe("lapse");
    expect(actionFor("GRACE_PERIOD_EXPIRED", undefined)).toBe("lapse");
    expect(actionFor("DID_FAIL_TO_RENEW", undefined)).toBe("lapse");
  });

  test("DID_CHANGE_RENEWAL_PREF without a subtype does nothing", () => {
    expect(actionFor("DID_CHANGE_RENEWAL_PREF", undefined)).toBe("none");
  });

  test("DID_FAIL_TO_RENEW in its grace period does nothing", () => {
    expect(actionFor("DID_FAIL_TO_RENEW", "GRACE_PERIOD")).toBe("none");
  });

  test("TEST does nothing", () => {
    expect(actionFor("TEST", undefined)).toBe("none");
  });

  test("CONSUMPTION_REQUEST does nothing", () => {
    expect(actionFor("CONSUMPTION_REQUEST", undefined)).toBe("none");
  });
});

describe("findAccount", () => {
  test("finds the account by transaction id", async () => {
    await record(accountA, transaction("t1", "waypoint.credits.1000"));
    expect(await findAccount(db, transaction("t1", "waypoint.credits.1000"))).toEqual(accountA);
  });

  test("finds the account by original id when the transaction id is new", async () => {
    await record(accountA, transaction("t1", "waypoint.plus.monthly", { expiresDate: NOW + 30 * DAY }));
    const renewal = transaction("t2", "waypoint.plus.monthly", { originalTransactionId: "t1", expiresDate: NOW + 60 * DAY });
    expect(await findAccount(db, renewal)).toEqual(accountA);
  });

  test("finds the account by appAccountToken, given in capitals, when neither id is recorded", async () => {
    const fresh = transaction("t9", "waypoint.credits.1000", { appAccountToken: B.toUpperCase() });
    expect(await findAccount(db, fresh)).toEqual(accountB);
  });

  test("returns null when nothing is known about the transaction", async () => {
    expect(await findAccount(db, transaction("t9", "waypoint.credits.1000"))).toBeNull();
  });

  test("returns null for an appAccountToken that is no user", async () => {
    const fresh = transaction("t9", "waypoint.credits.1000", { appAccountToken: "6f1c2b9a-0000-4000-8000-0000000000ff" });
    expect(await findAccount(db, fresh)).toBeNull();
  });
});

describe("refundCredits", () => {
  test("a pack takes back its credits times the quantity", () => {
    const txn = transaction("t1", "waypoint.credits.5000", { quantity: 2 });
    expect(refundCredits(productOf("waypoint.credits.5000"), txn)).toBe(10000);
  });

  test("Own it takes back 2,000", () => {
    expect(refundCredits(productOf("waypoint.own_it"), transaction("t1", "waypoint.own_it"))).toBe(2000);
  });

  test("a prorated refund takes back the revoked share, rounded up", () => {
    const txn = transaction("t1", "waypoint.credits.1000", {
      revocationType: "REFUND_PRORATED",
      revocationPercentage: 33333,
    });
    expect(refundCredits(productOf("waypoint.credits.1000"), txn)).toBe(334);
  });

  test("Plus takes back nothing", () => {
    expect(refundCredits(productOf("waypoint.plus.monthly"), transaction("t1", "waypoint.plus.monthly"))).toBe(0);
  });
});

describe("grants", () => {
  test("a renewal of a recorded monthly subscription resets to 2,000 under the transaction's id", async () => {
    await record(accountA, transaction("t1", "waypoint.plus.monthly", { expiresDate: NOW + 30 * DAY }));
    commands.splice(0);
    const renewal = transaction("t2", "waypoint.plus.monthly", { originalTransactionId: "t1", expiresDate: NOW + 60 * DAY });
    await apply(accountA, notice("DID_RENEW", uuid(1)), renewal);
    expect(commands.at(-1)).toEqual({ type: "reset", id: "apple:txn:t2", credits: 2000, resets_at: NOW + 60 * DAY });
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t2")).status).toBe("active");
  });

  test("ONE_TIME_CHARGE for a pack, then the app's own path for the same transaction, grants once", async () => {
    const txn = transaction("t1", "waypoint.credits.1000");
    await apply(accountA, notice("ONE_TIME_CHARGE", uuid(1)), txn);
    await record(accountA, txn);
    expect(read(accountA).purchased).toBe(1000);
  });
});

describe("refunds, revokes and lapses", () => {
  test("a refund of a pack takes its credits back with a clawback under the notice's id", async () => {
    const txn = transaction("t1", "waypoint.credits.1000");
    await apply(accountA, notice("ONE_TIME_CHARGE", uuid(1)), txn);
    commands.splice(0);
    await apply(accountA, notice("REFUND", uuid(2)), txn);
    expect(read(accountA).purchased).toBe(0);
    expect(commands).toEqual([{ type: "clawback", id: `apple:${uuid(2)}`, credits: 1000, ref: "apple:t1" }]);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t1")).status).toBe("refunded");
  });

  test("a refund of a pack after 600 were spent leaves 600 owed", async () => {
    const txn = transaction("t1", "waypoint.credits.1000");
    await apply(accountA, notice("ONE_TIME_CHARGE", uuid(1)), txn);
    const wallet = walletFor(accountA.billing_account_id);
    await wallet.apply({ type: "hold", id: "hold:1", hold_id: "hold:1", user_id: A, task: "explain", credits: 600, expires_at: NOW + DAY });
    await wallet.apply({ type: "settle", id: "settle:1", hold_id: "hold:1", actual: 600 });
    await apply(accountA, notice("REFUND", uuid(2)), txn);
    expect(read(accountA).purchased).toBe(0);
    expect(read(accountA).owed).toBe(600);
  });

  test("a refund of Own it takes 2,000 back, ends the entitlement and sets the plan to free", async () => {
    const txn = transaction("t1", "waypoint.own_it");
    await apply(accountA, notice("ONE_TIME_CHARGE", uuid(1)), txn);
    expect(await planOf(A)).toBe("own");
    await apply(accountA, notice("REFUND", uuid(2)), txn);
    expect(commands.at(-1)).toEqual({ type: "clawback", id: `apple:${uuid(2)}`, credits: 2000, ref: "apple:t1" });
    expect((await one<{ ended_at: number | null }>("SELECT ended_at FROM entitlements WHERE user_id = ? AND product = 'own_it'", A)).ended_at).toBe(NOW);
    expect(await planOf(A)).toBe("free");
  });

  test("a refund of Own it claimed from a deleted account makes no wallet command, ends the new entitlement and sets the plan to free", async () => {
    const txn = transaction("t1", "waypoint.own_it");
    await record(accountA, txn);
    await db.prepare("UPDATE purchases SET released_at = ? WHERE billing_account_id = ?").bind(NOW, A).run();
    await db.prepare("DELETE FROM users WHERE id = ?").bind(A).run();
    await record(accountB, txn);
    expect(await planOf(B)).toBe("own");
    commands.splice(0);
    await apply(accountB, notice("REFUND", uuid(2)), txn);
    expect(commands).toHaveLength(0);
    expect(read(accountB).purchased).toBe(0);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t1")).status).toBe("refunded");
    expect(await planOf(B)).toBe("free");
  });

  test("a refund of Plus resets monthly to 0 under the notice's id, ends the entitlement and turns zero retention off", async () => {
    await db.prepare("UPDATE users SET zero_retention = 1 WHERE id = ?").bind(A).run();
    const txn = transaction("t1", "waypoint.plus.monthly", { expiresDate: NOW + 30 * DAY });
    await apply(accountA, notice("SUBSCRIBED", uuid(1)), txn);
    expect(read(accountA).monthly).toBe(2000);
    await apply(accountA, notice("REFUND", uuid(2)), txn);
    expect(read(accountA).monthly).toBe(0);
    expect(commands.at(-1)).toEqual({ type: "reset", id: `apple:${uuid(2)}`, credits: 0, resets_at: NOW });
    expect((await one<{ ended_at: number | null }>("SELECT ended_at FROM entitlements WHERE user_id = ? AND product = 'plus'", A)).ended_at).toBe(NOW);
    expect(await planOf(A)).toBe("free");
    expect((await one<{ zero_retention: number }>("SELECT zero_retention FROM users WHERE id = ?", A)).zero_retention).toBe(0);
  });

  test("a refund of an earlier Plus period after a renewal marks only that row refunded: monthly, entitlement and plan stay", async () => {
    const first = transaction("t1", "waypoint.plus.monthly", { purchaseDate: NOW - 40 * DAY, expiresDate: NOW - 10 * DAY });
    const second = transaction("t2", "waypoint.plus.monthly", { originalTransactionId: "t1", purchaseDate: NOW - 10 * DAY, expiresDate: NOW + 20 * DAY });
    await record(accountA, first);
    await record(accountA, second);
    expect(read(accountA).monthly).toBe(2000);
    commands.splice(0);
    await apply(accountA, notice("REFUND", uuid(2)), first);
    expect(commands).toHaveLength(0);
    expect(read(accountA).monthly).toBe(2000);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t1")).status).toBe("refunded");
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t2")).status).toBe("active");
    expect((await one<{ ended_at: number | null }>("SELECT ended_at FROM entitlements WHERE user_id = ? AND product = 'plus'", A)).ended_at).toBeNull();
    expect(await planOf(A)).toBe("plus");
  });

  test("a refund of the current Plus period after a renewal still resets monthly to 0 and ends Plus", async () => {
    const first = transaction("t1", "waypoint.plus.monthly", { purchaseDate: NOW - 40 * DAY, expiresDate: NOW - 10 * DAY });
    const second = transaction("t2", "waypoint.plus.monthly", { originalTransactionId: "t1", purchaseDate: NOW - 10 * DAY, expiresDate: NOW + 20 * DAY });
    await record(accountA, first);
    await record(accountA, second);
    await apply(accountA, notice("REFUND", uuid(3)), second);
    expect(read(accountA).monthly).toBe(0);
    expect(await planOf(A)).toBe("free");
  });

  test("the same refund notice applied twice makes one wallet command", async () => {
    const txn = transaction("t1", "waypoint.credits.1000");
    await apply(accountA, notice("ONE_TIME_CHARGE", uuid(1)), txn);
    commands.splice(0);
    await apply(accountA, notice("REFUND", uuid(2)), txn);
    await apply(accountA, notice("REFUND", uuid(2)), txn);
    expect(commands.filter((c) => c.type === "clawback")).toHaveLength(1);
  });

  test("two different refund notices for the same transaction make one wallet command", async () => {
    const txn = transaction("t1", "waypoint.credits.1000");
    await apply(accountA, notice("ONE_TIME_CHARGE", uuid(1)), txn);
    commands.splice(0);
    await apply(accountA, notice("REFUND", uuid(2)), txn);
    await apply(accountA, notice("REFUND", uuid(3)), txn);
    expect(commands.filter((c) => c.type === "clawback")).toHaveLength(1);
  });

  test("a refund of a transaction never recorded makes no wallet command and records it as refunded", async () => {
    await apply(accountA, notice("REFUND", uuid(2)), transaction("t404", "waypoint.credits.1000"));
    expect(commands).toHaveLength(0);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t404")).status).toBe("refunded");
  });

  test("a refund that arrives before its purchase stops the later grant", async () => {
    await apply(accountA, notice("REFUND", uuid(2)), transaction("t405", "waypoint.credits.1000"));
    await apply(accountA, notice("ONE_TIME_CHARGE", uuid(3)), transaction("t405", "waypoint.credits.1000"));
    expect(commands).toHaveLength(0);
    expect(read(accountA).purchased).toBe(0);
  });

  test("a revoke that arrives before its purchase records it as revoked", async () => {
    await apply(accountA, notice("REVOKE", uuid(2)), transaction("t406", "waypoint.own_it"));
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t406")).status).toBe("revoked");
  });

  test("a revoke of a Family Sharing Own it makes no wallet command, ends only that entitlement and leaves the purchaser's", async () => {
    await record(accountB, transaction("p1", "waypoint.own_it"));
    await record(accountA, transaction("f1", "waypoint.own_it", { inAppOwnershipType: "FAMILY_SHARED" }));
    commands.splice(0);
    await apply(accountA, notice("REVOKE", uuid(2)), transaction("f1", "waypoint.own_it", { inAppOwnershipType: "FAMILY_SHARED" }));
    expect(commands).toHaveLength(0);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "f1")).status).toBe("revoked");
    expect((await one<{ ended_at: number | null }>("SELECT ended_at FROM entitlements WHERE user_id = ? AND source = 'family_share'", A)).ended_at).toBe(NOW);
    expect((await one<{ ended_at: number | null }>("SELECT ended_at FROM entitlements WHERE user_id = ? AND product = 'own_it' AND source = 'purchase'", B)).ended_at).toBeNull();
  });

  test("EXPIRED for the current Plus period expires its rows, resets monthly to 0 and ends the entitlement", async () => {
    const txn = transaction("t1", "waypoint.plus.monthly", { expiresDate: NOW + 30 * DAY });
    await apply(accountA, notice("SUBSCRIBED", uuid(1)), txn);
    await apply(accountA, notice("EXPIRED", uuid(2)), txn);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t1")).status).toBe("expired");
    expect(read(accountA).monthly).toBe(0);
    expect(commands.at(-1)).toEqual({ type: "reset", id: `apple:${uuid(2)}`, credits: 0, resets_at: NOW });
    expect((await one<{ ended_at: number | null }>("SELECT ended_at FROM entitlements WHERE user_id = ? AND product = 'plus'", A)).ended_at).toBe(NOW);
    expect(await planOf(A)).toBe("free");
  });

  test("EXPIRED that arrives after a later period is already active changes nothing", async () => {
    const first = transaction("t1", "waypoint.plus.monthly", { purchaseDate: NOW - 10 * DAY, expiresDate: NOW + 20 * DAY });
    const second = transaction("t2", "waypoint.plus.monthly", {
      originalTransactionId: "t1",
      purchaseDate: NOW - 60 * 60 * 1000,
      expiresDate: NOW + 30 * DAY,
    });
    await record(accountA, first);
    await record(accountA, second);
    commands.splice(0);
    await apply(accountA, notice("EXPIRED", uuid(2)), first);
    expect(commands).toHaveLength(0);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t1")).status).toBe("active");
    expect(await planOf(A)).toBe("plus");
  });

  test("EXPIRED for a Family Sharing Plus ends its entitlement and makes no wallet command", async () => {
    const txn = transaction("t1", "waypoint.plus.monthly", { inAppOwnershipType: "FAMILY_SHARED", expiresDate: NOW + 30 * DAY });
    await record(accountA, txn);
    commands.splice(0);
    await apply(accountA, notice("EXPIRED", uuid(2)), txn);
    expect(commands).toHaveLength(0);
    expect((await one<{ ended_at: number | null }>("SELECT ended_at FROM entitlements WHERE user_id = ? AND source = 'family_share'", A)).ended_at).toBe(NOW);
  });

  test("DID_FAIL_TO_RENEW in its grace period changes nothing", async () => {
    const txn = transaction("t1", "waypoint.plus.monthly", { expiresDate: NOW + 30 * DAY });
    await record(accountA, txn);
    commands.splice(0);
    await apply(accountA, notice("DID_FAIL_TO_RENEW", uuid(2), "GRACE_PERIOD"), txn);
    expect(commands).toHaveLength(0);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t1")).status).toBe("active");
    expect(await planOf(A)).toBe("plus");
  });
});
