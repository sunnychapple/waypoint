import { NativeModule, requireNativeModule, type EventSubscription } from "expo";

export type StoreProduct = {
  id: string;
  displayName: string;
  displayPrice: string; // in the person's own currency, from the App Store
  kind: "consumable" | "non_consumable" | "subscription" | "other";
  familyShareable: boolean;
};
// jws is the transaction's jwsRepresentation: what POST /v1/purchases/apple takes as signed_transaction.
export type StoreTransaction = { jws: string; transactionId: string; productId: string; familyShared: boolean };
export type PurchaseResult =
  | { status: "purchased"; transaction: StoreTransaction }
  | { status: "pending" } // Ask to Buy, or a payment that needs action
  | { status: "cancelled" }
  | { status: "unverified" }; // Apple's signature did not check out on the phone; nothing is sent

type Events = { onTransaction(transaction: StoreTransaction): void };

declare class WaypointStoreNative extends NativeModule<Events> {
  products(ids: string[]): Promise<StoreProduct[]>;
  purchase(productId: string, appAccountToken: string): Promise<PurchaseResult>;
  unfinishedTransactions(): Promise<StoreTransaction[]>;
  finish(transactionId: string): Promise<boolean>;
  restore(): Promise<StoreTransaction[]>;
}

const native = requireNativeModule<WaypointStoreNative>("WaypointStore");

// Errors carry error.code: "bad_token", "unknown_product", "no_window", "purchase_failed".
export const products = (ids: string[]): Promise<StoreProduct[]> => native.products(ids);
export const purchase = (productId: string, appAccountToken: string): Promise<PurchaseResult> => native.purchase(productId, appAccountToken);
export const unfinishedTransactions = (): Promise<StoreTransaction[]> => native.unfinishedTransactions();
export const finish = (transactionId: string): Promise<boolean> => native.finish(transactionId);
export const restore = (): Promise<StoreTransaction[]> => native.restore();
export const addTransactionListener = (listener: (transaction: StoreTransaction) => void): EventSubscription =>
  native.addListener("onTransaction", listener);
