import { useEffect } from "react";
import type { ApplePurchaseResponse } from "@waypoint/contracts";
import { ApiCallError } from "@waypoint/api-client";
import { PRODUCTS, PRODUCT_IDS, isProductId, purchaseKey, sendOutcome, shouldFinish, type ProductId, type ProductInfo, type SendOutcome } from "../core/store/products.ts";
import * as Store from "../../modules/waypoint-store/index.ts";
import { api } from "./api.ts";
import { currentUserId, requireApprovedDevice, useDeviceStatus } from "./device.ts";

export type ShopProduct = Store.StoreProduct & { info: ProductInfo };

// The six products with their App Store prices, in PRODUCT_IDS order. Missing ones (not set up in App Store Connect) are left out.
export async function loadProducts(): Promise<ShopProduct[]> {
  const found = await Store.products([...PRODUCT_IDS]);
  const byId = new Map(found.map((p) => [p.id, p]));
  return PRODUCT_IDS.flatMap((id) => {
    const product = byId.get(id);
    return product === undefined ? [] : [{ ...product, info: PRODUCTS[id] }];
  });
}

export type Sent = { outcome: SendOutcome; reply: ApplePurchaseResponse | null };

// Sends one transaction to the server and finishes it when the server has decided. Never throws.
export async function sendTransaction(transaction: Store.StoreTransaction): Promise<Sent> {
  let reply: ApplePurchaseResponse | null = null;
  let outcome: SendOutcome;
  try {
    reply = await api.applePurchase(transaction.jws, purchaseKey(transaction.transactionId));
    outcome = "granted";
  } catch (error) {
    outcome = error instanceof ApiCallError ? sendOutcome({ status: error.status, message: error.message }) : "retry_later";
  }
  if (shouldFinish(outcome)) await Store.finish(transaction.transactionId).catch(() => false);
  return { outcome, reply };
}

export type BuyResult =
  | { kind: "granted"; reply: ApplePurchaseResponse }
  | { kind: "pending" }
  | { kind: "cancelled" }
  | { kind: "not_ready" } // requireApprovedDevice() opened a screen; StoreKit was not started
  | { kind: "other_account" }
  | { kind: "saved" } // paid, but the server could not be reached: sent again on the next launch
  | { kind: "failed" };

export async function buy(productId: ProductId): Promise<BuyResult> {
  if (!requireApprovedDevice()) return { kind: "not_ready" };
  const userId = currentUserId();
  if (userId === null) return { kind: "not_ready" };
  let result: Store.PurchaseResult;
  try {
    result = await Store.purchase(productId, userId);
  } catch {
    return { kind: "failed" };
  }
  if (result.status === "pending") return { kind: "pending" };
  if (result.status !== "purchased") return result.status === "cancelled" ? { kind: "cancelled" } : { kind: "failed" };
  const sent = await sendTransaction(result.transaction);
  if (sent.outcome === "granted" && sent.reply !== null) return { kind: "granted", reply: sent.reply };
  if (sent.outcome === "other_account") return { kind: "other_account" };
  if (sent.outcome === "retry_later") return { kind: "saved" };
  return { kind: "failed" };
}

// Restore (O-board "Restore purchases"): Own it and Plus come back from Transaction.currentEntitlements and are sent
// again; the server grants nothing twice. Returns how many the server accepted.
export async function restorePurchases(): Promise<number> {
  if (!requireApprovedDevice()) return 0;
  const transactions = await Store.restore();
  let accepted = 0;
  for (const transaction of transactions) {
    if (!isProductId(transaction.productId)) continue;
    if ((await sendTransaction(transaction)).outcome === "granted") accepted += 1;
  }
  return accepted;
}

// Called once in (tabs)/_layout.tsx. Once this iPhone is approved: sends what StoreKit still has unfinished (a purchase
// whose reply was lost, an Ask to Buy approved later, a renewal) and listens for new transactions.
export function useStoreSync(): void {
  const status = useDeviceStatus();
  useEffect(() => {
    if (status !== "approved") return;
    void Store.unfinishedTransactions().then(async (transactions) => {
      for (const transaction of transactions) await sendTransaction(transaction);
    }, () => undefined);
    const sub = Store.addTransactionListener((transaction) => void sendTransaction(transaction));
    return () => sub.remove();
  }, [status]);
}
