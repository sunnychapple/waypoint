import type { Plan, ProductKind } from "@waypoint/contracts";
import type { Command, CommandResult } from "@waypoint/ledger";
import type { Db } from "../storage.ts";
import { addMonths, PLUS_MONTHLY_CREDITS, purchaseKind, type AppleProduct } from "./products.ts";
import type { AppleTransaction } from "./transaction.ts";

export type WalletCommands = { apply(command: Command): Promise<CommandResult> };
export type PurchaseAccount = { user_id: string; billing_account_id: string };
export type PurchaseOutcome =
  | { ok: true; product: ProductKind; credits: number; plan: Plan }
  | { ok: false; reason: "other_account" | "refunded" };

type PurchaseRow = { billing_account_id: string; status: "active" | "refunded" | "revoked" | "expired" };

// The wallet command id for everything a transaction grants. The app's POST and Apple's notice share it,
// so a transaction is granted once however often it arrives.
export function transactionCommandId(transactionId: string): string {
  return `apple:txn:${transactionId}`;
}

// Applies a grant, reset or clawback, which only fail by throwing; any other failure is a bug.
export async function applyWalletCommand(wallet: WalletCommands, command: Command): Promise<void> {
  const result = await wallet.apply(command);
  if (!result.ok) throw new Error("wallet command failed");
}

// Sets users.plan from the open entitlements (plus over own over free) and turns zero retention off
// for anyone who is no longer on Plus. Returns the new plan.
export async function refreshPlan(db: Db, userId: string): Promise<Plan> {
  await db
    .prepare(
      `UPDATE users SET plan = CASE
         WHEN EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = users.id AND e.product = 'plus' AND e.ended_at IS NULL) THEN 'plus'
         WHEN EXISTS (SELECT 1 FROM entitlements e WHERE e.user_id = users.id AND e.product = 'own_it' AND e.ended_at IS NULL) THEN 'own'
         ELSE 'free' END
       WHERE id = ?`,
    )
    .bind(userId)
    .run();
  await db.prepare("UPDATE users SET zero_retention = 0 WHERE id = ? AND plan <> 'plus'").bind(userId).run();
  const row = await db.prepare("SELECT plan FROM users WHERE id = ?").bind(userId).first<{ plan: Plan }>();
  if (row === null) throw new Error("user missing");
  return row.plan;
}

// Records one verified transaction for an account and grants what it buys, once per transaction id.
export async function applyTransaction(
  db: Db,
  wallet: WalletCommands,
  account: PurchaseAccount,
  txn: AppleTransaction,
  product: AppleProduct,
  now: number,
): Promise<PurchaseOutcome> {
  if (txn.revocationDate !== undefined) return { ok: false, reason: "refunded" };
  if (txn.inAppOwnershipType === "PURCHASED") {
    // A subscription or purchase belongs to the account that recorded it first, renewals included.
    const owner = await db
      .prepare("SELECT 1 AS found FROM purchases WHERE original_id = ? AND billing_account_id <> ? LIMIT 1")
      .bind(txn.originalTransactionId, account.billing_account_id)
      .first<{ found: number }>();
    if (owner !== null) return { ok: false, reason: "other_account" };
  }
  const expired = product.kind === "plus" && (txn.expiresDate ?? 0) <= now;
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
      expired ? "expired" : "active",
      txn.purchaseDate,
    )
    .run();
  const row = await db
    .prepare("SELECT billing_account_id, status FROM purchases WHERE transaction_id = ?")
    .bind(txn.transactionId)
    .first<PurchaseRow>();
  if (row === null) throw new Error("purchase row missing after insert");
  if (row.billing_account_id !== account.billing_account_id) return { ok: false, reason: "other_account" };
  if (row.status === "refunded" || row.status === "revoked") return { ok: false, reason: "refunded" };

  let credits = 0;
  if (row.status === "active" && !expired) {
    const shared = txn.inAppOwnershipType !== "PURCHASED";
    if (product.kind !== "pack") {
      await db
        .prepare(
          "INSERT INTO entitlements (user_id, product, source, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, product, source) DO UPDATE SET ended_at = NULL",
        )
        .bind(account.user_id, product.kind, shared ? "family_share" : "purchase", now)
        .run();
    }
    if (!shared) {
      const id = transactionCommandId(txn.transactionId);
      const ref = `apple:${txn.transactionId}`;
      if (product.kind === "plus") {
        const end = txn.expiresDate ?? now;
        const resetsAt = product.period === "monthly" ? end : Math.min(addMonths(txn.purchaseDate, 1), end);
        await applyWalletCommand(wallet, { type: "reset", id, credits: PLUS_MONTHLY_CREDITS, resets_at: resetsAt });
        credits = PLUS_MONTHLY_CREDITS;
      } else {
        credits = product.credits * (product.kind === "pack" ? (txn.quantity ?? 1) : 1);
        await applyWalletCommand(wallet, { type: "grant", id, bucket: "purchased", credits, ref, user_id: account.user_id });
      }
    }
  }
  return { ok: true, product: product.kind, credits, plan: await refreshPlan(db, account.user_id) };
}
