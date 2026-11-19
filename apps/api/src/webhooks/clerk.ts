import { Hono } from "hono";
import { z } from "zod";
import { loadOrCreateUser } from "../auth/users.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { verifySvix, WebhookSecretError } from "./svix.ts";

export const STARTER_CREDITS = 25;

const ClerkEventSchema = z.object({
  type: z.string().min(1),
  data: z.object({ id: z.string().min(1).max(128) }),
});

export function clerkWebhookRoute(deps: { now: () => number; newId: () => string }) {
  return new Hono<AppEnv>().post("/webhooks/clerk", async (c) => {
    const body = await c.req.text();
    const now = deps.now();
    let verified: boolean;
    try {
      verified = await verifySvix(
        c.env.CLERK_WEBHOOK_SIGNING_SECRET,
        { id: c.req.header("svix-id"), timestamp: c.req.header("svix-timestamp"), signature: c.req.header("svix-signature") },
        body,
        now,
      );
    } catch (err) {
      if (err instanceof WebhookSecretError) throw new ApiFailure("internal", "webhook not configured");
      throw err;
    }
    if (!verified) throw new ApiFailure("unauthorized", "invalid signature");

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new ApiFailure("bad_request", "invalid request");
    }
    const parsed = ClerkEventSchema.safeParse(json);
    if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
    const event = parsed.data;

    if (event.type === "user.created") {
      const user = await loadOrCreateUser(c.env.DB, event.data.id, now, deps.newId);
      const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
      // The command id is the same for every delivery of this user's event, so the wallet grants once.
      await wallet.apply({
        type: "grant",
        id: `starter:${user.id}`,
        bucket: "purchased",
        credits: STARTER_CREDITS,
        ref: "starter",
        user_id: user.id,
      });
    } else if (event.type === "user.deleted") {
      await c.env.DB.prepare("DELETE FROM users WHERE clerk_id = ?").bind(event.data.id).run();
    }
    return c.json({ ok: true });
  });
}
