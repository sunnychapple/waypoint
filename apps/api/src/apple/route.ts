import { ApplePurchaseRequestSchema, type ApplePurchaseResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import type { Db } from "../storage.ts";
import { AppleJwsError, verifyAppleJws } from "./jws.ts";
import { appleProduct } from "./products.ts";
import { applyTransaction } from "./purchases.ts";
import { allowedEnvironments, AppleTransactionSchema } from "./transaction.ts";

export type ApplePurchaseDeps = { now: () => number; rootSha256: string };

// True when the account named by `token` no longer exists and rows of this purchase were released (open question 7).
async function releasedByDeletedAccount(db: Db, originalId: string, token: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS found FROM purchases WHERE original_id = ? AND released_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = ?) LIMIT 1")
    .bind(originalId, token)
    .first<{ found: number }>();
  return row !== null;
}

export function applePurchaseRoute(deps: ApplePurchaseDeps): Hono<AppEnv> {
  return new Hono<AppEnv>().post("/v1/purchases/apple", idempotent(deps), async (c) => {
    const user = c.get("user");
    const body: unknown = await c.req.json().catch(() => {
      throw new ApiFailure("bad_request", "invalid request");
    });
    const request = ApplePurchaseRequestSchema.safeParse(body);
    if (!request.success) throw new ApiFailure("bad_request", "invalid request");

    const payload = await verifyAppleJws(request.data.signed_transaction, deps.rootSha256).catch((err: unknown) => {
      if (err instanceof AppleJwsError) throw new ApiFailure("bad_request", "invalid purchase");
      throw err;
    });
    const parsed = AppleTransactionSchema.safeParse(payload);
    if (!parsed.success) throw new ApiFailure("bad_request", "invalid purchase");
    const txn = parsed.data;
    if (txn.bundleId !== c.env.APPLE_BUNDLE_ID) throw new ApiFailure("bad_request", "invalid purchase");
    if (!allowedEnvironments(c.env.APPLE_ENVIRONMENTS).includes(txn.environment)) {
      throw new ApiFailure("bad_request", "invalid purchase");
    }
    const product = appleProduct(txn.productId);
    if (product === undefined || product.appleType !== txn.type) throw new ApiFailure("bad_request", "unknown product");
    // Another person's token is refused, unless that account is gone and released this purchase (open question 7):
    // then applyTransaction decides who may claim it.
    if (
      txn.inAppOwnershipType === "PURCHASED" &&
      txn.appAccountToken !== undefined &&
      txn.appAccountToken.toLowerCase() !== user.id.toLowerCase() &&
      !(await releasedByDeletedAccount(c.env.DB, txn.originalTransactionId, txn.appAccountToken.toLowerCase()))
    ) {
      throw new ApiFailure("conflict", "purchase belongs to another account");
    }

    const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
    const outcome = await applyTransaction(
      c.env.DB,
      wallet,
      { user_id: user.id, billing_account_id: user.billing_account_id },
      txn,
      product,
      deps.now(),
    );
    if (!outcome.ok) {
      throw new ApiFailure(
        "conflict",
        outcome.reason === "other_account" ? "purchase belongs to another account" : "purchase was refunded",
      );
    }
    const reply: ApplePurchaseResponse = {
      transaction_id: txn.transactionId,
      product: outcome.product,
      credits: outcome.credits,
      plan: outcome.plan,
    };
    return c.json(reply);
  });
}
