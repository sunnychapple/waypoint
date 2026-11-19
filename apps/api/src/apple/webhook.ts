import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { AppleJwsError, verifyAppleJws } from "./jws.ts";
import { AppleNotificationSchema, applyNotice, findAccount } from "./notifications.ts";
import { appleProduct } from "./products.ts";
import { allowedEnvironments, AppleTransactionSchema } from "./transaction.ts";

export type AppleWebhookDeps = { now: () => number; rootSha256: string };

const BodySchema = z.looseObject({ signedPayload: z.string().min(1).max(65536) });

function invalid(): never {
  throw new ApiFailure("bad_request", "invalid notification");
}

async function verified(jws: string, rootSha256: string): Promise<Record<string, unknown>> {
  return verifyAppleJws(jws, rootSha256).catch((err: unknown) => {
    if (err instanceof AppleJwsError) invalid();
    throw err;
  });
}

// POST /webhooks/apple: App Store Server Notifications V2. Not under /v1, so no session and no Idempotency-Key;
// notificationUUID makes it run once. Replies 200 with no body once handled; any 4xx or 5xx makes Apple retry.
export function appleWebhookRoute(deps: AppleWebhookDeps): Hono<AppEnv> {
  return new Hono<AppEnv>().post("/webhooks/apple", async (c) => {
    const db = c.env.DB;
    const body: unknown = await c.req.json().catch(() => invalid());
    const request = BodySchema.safeParse(body);
    if (!request.success) invalid();
    const parsed = AppleNotificationSchema.safeParse(await verified(request.data.signedPayload, deps.rootSha256));
    if (!parsed.success) invalid();
    const notification = parsed.data;

    const seen = await db
      .prepare("SELECT 1 AS found FROM apple_notifications WHERE notification_uuid = ?")
      .bind(notification.notificationUUID)
      .first<{ found: number }>();
    if (seen !== null) return c.body(null, 200);

    const data = notification.data;
    if (data !== undefined) {
      if (data.bundleId !== c.env.APPLE_BUNDLE_ID) invalid();
      if (!allowedEnvironments(c.env.APPLE_ENVIRONMENTS).includes(data.environment)) invalid();
      if (data.environment === "Production" && data.appAppleId !== Number(c.env.APPLE_APP_APPLE_ID)) invalid();
    }
    if (data?.signedTransactionInfo !== undefined) {
      const txnParsed = AppleTransactionSchema.safeParse(await verified(data.signedTransactionInfo, deps.rootSha256));
      if (!txnParsed.success || txnParsed.data.bundleId !== c.env.APPLE_BUNDLE_ID) invalid();
      const txn = txnParsed.data;
      const product = appleProduct(txn.productId);
      const account = product === undefined ? null : await findAccount(db, txn);
      if (product !== undefined && account !== null) {
        const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(account.billing_account_id));
        await applyNotice({ db, wallet, account, notification, txn, product, now: deps.now() });
      }
    }

    await db
      .prepare(
        "INSERT INTO apple_notifications (notification_uuid, notification_type, received_at) VALUES (?, ?, ?) ON CONFLICT (notification_uuid) DO NOTHING",
      )
      .bind(notification.notificationUUID, notification.notificationType, deps.now())
      .run();
    return c.body(null, 200);
  });
}
