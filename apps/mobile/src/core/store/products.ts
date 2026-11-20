// The App Store products (docs/architecture.md section 7). Ids must match App Store Connect and the server's
// APPLE_PRODUCTS (apps/api/src/apple/products.ts).
export const PRODUCT_IDS = [
  "waypoint.own_it",
  "waypoint.plus.monthly",
  "waypoint.plus.yearly",
  "waypoint.credits.1000",
  "waypoint.credits.5000",
  "waypoint.credits.20000",
] as const;

export type ProductId = (typeof PRODUCT_IDS)[number];
export type ProductInfo = { id: ProductId; kind: "own_it" | "plus" | "pack"; credits: number; period: "monthly" | "yearly" | null };

export const PRODUCTS: Readonly<Record<ProductId, ProductInfo>> = {
  "waypoint.own_it": { id: "waypoint.own_it", kind: "own_it", credits: 2000, period: null },
  "waypoint.plus.monthly": { id: "waypoint.plus.monthly", kind: "plus", credits: 2000, period: "monthly" },
  "waypoint.plus.yearly": { id: "waypoint.plus.yearly", kind: "plus", credits: 2000, period: "yearly" },
  "waypoint.credits.1000": { id: "waypoint.credits.1000", kind: "pack", credits: 1000, period: null },
  "waypoint.credits.5000": { id: "waypoint.credits.5000", kind: "pack", credits: 5000, period: null },
  "waypoint.credits.20000": { id: "waypoint.credits.20000", kind: "pack", credits: 20000, period: null },
};

export function isProductId(id: string): id is ProductId {
  return (PRODUCT_IDS as readonly string[]).includes(id);
}

// One Idempotency-Key per App Store transaction, so a transaction sent again (next launch, restore, Transaction.updates)
// replays the server's first reply instead of running twice. Transaction ids are decimal.
export function purchaseKey(transactionId: string): string {
  if (!/^\d{1,50}$/.test(transactionId)) throw new RangeError("bad transaction id");
  return `apple_txn_${transactionId.padStart(6, "0")}`;
}

// What the server's answer to POST /v1/purchases/apple means for the transaction on the phone.
export type SendOutcome = "granted" | "other_account" | "refunded" | "invalid" | "retry_later";

export function sendOutcome(failure: { status: number; message: string } | null): SendOutcome {
  if (failure === null) return "granted";
  if (failure.status === 409 && failure.message === "purchase belongs to another account") return "other_account";
  if (failure.status === 409 && failure.message === "purchase was refunded") return "refunded";
  if (failure.status === 400) return "invalid";
  return "retry_later";
}

// Finish (tell StoreKit we are done) only when the server has decided. "invalid" stays unfinished so it can be looked at
// (for example a sandbox purchase sent to a production server); "retry_later" is sent again on the next launch.
export function shouldFinish(outcome: SendOutcome): boolean {
  return outcome === "granted" || outcome === "other_account" || outcome === "refunded";
}
