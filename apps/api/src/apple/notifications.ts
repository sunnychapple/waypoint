import { z } from "zod";
import type { Db } from "../storage.ts";
import { purchaseKind, type AppleProduct } from "./products.ts";
import {
  applyTransaction,
  applyWalletCommand,
  refreshPlan,
  type PurchaseAccount,
  type WalletCommands,
} from "./purchases.ts";
import type { AppleTransaction } from "./transaction.ts";

// The decoded signedPayload (responseBodyV2DecodedPayload). Unknown keys are allowed.
export const AppleNotificationSchema = z.looseObject({
  notificationType: z.string().min(1).max(64),
  subtype: z.string().max(64).optional(),
  notificationUUID: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  signedDate: z.number().int().min(0),
  data: z
    .looseObject({
      bundleId: z.string(),
      environment: z.string(),
      appAppleId: z.number().int().optional(),
      signedTransactionInfo: z.string().max(16384).optional(),
    })
    .optional(),
});

export type AppleNotification = z.infer<typeof AppleNotificationSchema>;

// Notices that start or continue service: the transaction is applied exactly as POST /v1/purchases/apple does.
const GRANTS = new Set(["SUBSCRIBED", "DID_RENEW", "ONE_TIME_CHARGE", "OFFER_REDEEMED"]);

export type NoticeAction = "grant" | "refund" | "revoke" | "lapse" | "none";

export function actionFor(type: string, subtype: string | undefined): NoticeAction {
  if (GRANTS.has(type)) return "grant";
  if (type === "DID_CHANGE_RENEWAL_PREF" && subtype === "UPGRADE") return "grant";
  if (type === "REFUND") return "refund";
  if (type === "REVOKE") return "revoke";
  if (type === "EXPIRED" || type === "GRACE_PERIOD_EXPIRED") return "lapse";
  if (type === "DID_FAIL_TO_RENEW" && subtype === undefined) return "lapse";
  return "none";
}

const ACCOUNT_BY = (column: "transaction_id" | "original_id"): string =>
  `SELECT u.id AS user_id, u.billing_account_id FROM purchases p JOIN users u ON u.billing_account_id = p.billing_account_id WHERE p.${column} = ? ORDER BY u.created_at, u.id LIMIT 1`;

// The account a transaction belongs to: the one that recorded this transaction, else the one that recorded
// its subscription or purchase, else the user whose id the app put in appAccountToken. null when none is known.
export async function findAccount(db: Db, txn: AppleTransaction): Promise<PurchaseAccount | null> {
  const byTransaction = await db.prepare(ACCOUNT_BY("transaction_id")).bind(txn.transactionId).first<PurchaseAccount>();
  if (byTransaction !== null) return byTransaction;
  const byOriginal = await db.prepare(ACCOUNT_BY("original_id")).bind(txn.originalTransactionId).first<PurchaseAccount>();
  if (byOriginal !== null) return byOriginal;
  if (txn.appAccountToken === undefined) return null;
  return db
    .prepare("SELECT id AS user_id, billing_account_id FROM users WHERE id = ?")
    .bind(txn.appAccountToken.toLowerCase())
    .first<PurchaseAccount>();
}

// Credits a refund takes back from a pack or Own it: all of them, or the refunded share of a prorated refund.
export function refundCredits(product: AppleProduct, txn: AppleTransaction): number {
  if (product.kind === "plus") return 0;
  const credits = product.credits * (product.kind === "pack" ? (txn.quantity ?? 1) : 1);
  if (txn.revocationType === "REFUND_PRORATED" && txn.revocationPercentage !== undefined) {
    return Math.ceil((credits * txn.revocationPercentage) / 100000);
  }
  return credits;
}

async function endEntitlement(
  db: Db,
  account: PurchaseAccount,
  product: AppleProduct,
  txn: AppleTransaction,
  now: number,
): Promise<void> {
  if (product.kind === "pack") return;
  await db
    .prepare("UPDATE entitlements SET ended_at = ? WHERE user_id = ? AND product = ? AND source = ? AND ended_at IS NULL")
    .bind(now, account.user_id, product.kind, txn.inAppOwnershipType === "PURCHASED" ? "purchase" : "family_share")
    .run();
}

export type NoticeInput = {
  db: Db;
  wallet: WalletCommands;
  account: PurchaseAccount;
  notification: AppleNotification;
  txn: AppleTransaction;
  product: AppleProduct;
  now: number;
};

// Applies one verified notice. Safe to run again for the same notice: every wallet command has a fixed id.
export async function applyNotice(input: NoticeInput): Promise<void> {
  const { db, wallet, account, notification, txn, product, now } = input;
  const action = actionFor(notification.notificationType, notification.subtype);
  const commandId = `apple:${notification.notificationUUID}`;
  const purchased = txn.inAppOwnershipType === "PURCHASED";

  if (action === "grant") {
    await applyTransaction(db, wallet, account, txn, product, now);
    return;
  }

  if (action === "refund" || action === "revoke") {
    const row = await db
      .prepare("SELECT status FROM purchases WHERE transaction_id = ? AND billing_account_id = ?")
      .bind(txn.transactionId, account.billing_account_id)
      .first<{ status: string }>();
    if (row === null) {
      // Never granted here. Record it as refunded or revoked, so a grant that arrives later
      // (a retried purchase notice, or the app's own request) finds the row and grants nothing.
      await db
        .prepare(
          "INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (transaction_id) DO NOTHING",
        )
        .bind(
          txn.transactionId,
          txn.originalTransactionId,
          account.billing_account_id,
          txn.productId,
          purchaseKind(product.kind),
          action === "refund" ? "refunded" : "revoked",
          txn.purchaseDate,
        )
        .run();
      return;
    }
    if (row.status === "active" && purchased) {
      if (product.kind === "plus") {
        await applyWalletCommand(wallet, { type: "reset", id: commandId, credits: 0, resets_at: now });
      } else {
        const credits = refundCredits(product, txn);
        if (credits > 0) {
          await applyWalletCommand(wallet, { type: "clawback", id: commandId, credits, ref: `apple:${txn.transactionId}` });
        }
      }
    }
    await db
      .prepare("UPDATE purchases SET status = ? WHERE transaction_id = ? AND status IN ('active', 'expired')")
      .bind(action === "refund" ? "refunded" : "revoked", txn.transactionId)
      .run();
    await endEntitlement(db, account, product, txn, now);
    await refreshPlan(db, account.user_id);
    return;
  }

  if (action === "lapse" && product.kind === "plus") {
    const later = await db
      .prepare("SELECT 1 AS found FROM purchases WHERE original_id = ? AND status = 'active' AND purchased_at > ? LIMIT 1")
      .bind(txn.originalTransactionId, txn.purchaseDate)
      .first<{ found: number }>();
    if (later !== null) return; // a later period is already active: this notice is out of date
    await db
      .prepare("UPDATE purchases SET status = 'expired' WHERE original_id = ? AND status = 'active'")
      .bind(txn.originalTransactionId)
      .run();
    if (purchased) await applyWalletCommand(wallet, { type: "reset", id: commandId, credits: 0, resets_at: now });
    await endEntitlement(db, account, product, txn, now);
    await refreshPlan(db, account.user_id);
  }
}
