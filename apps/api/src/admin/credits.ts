import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";

// Owner-only credit grant for testing (TestFlight, before App Store products exist). Lives outside /v1, so the
// session and device middleware do not apply; the bearer token is the only gate. Every refusal about the route
// itself answers exactly like an unknown path, so the route does not reveal that it exists.

export const ADMIN_TOKEN_MIN_LENGTH = 32;
export const ADMIN_MAX_CREDITS = 5000;

const GrantRequestSchema = z
  .object({
    // The directory keeps no email (Clerk owns it), so the user is named by Clerk id only.
    clerkId: z.string().min(1).max(128),
    credits: z.number().int().min(1).max(ADMIN_MAX_CREDITS),
    reason: z.string().min(1).max(200),
    key: z.string().min(8).max(100),
  })
  .strict();

const notFound = () => new ApiFailure("not_found", "no such endpoint");

// Compares two strings without returning early on the first differing byte. A length mismatch is folded into the
// result, and the loop always runs over the longer input, so the time does not depend on where they differ.
export function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export function adminCreditsRoute() {
  return new Hono<AppEnv>().post("/admin/credits", async (c) => {
    const token = c.env.ADMIN_TOKEN;
    if (token === undefined || token.length < ADMIN_TOKEN_MIN_LENGTH) throw notFound();
    const header = c.req.header("Authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    if (!constantTimeEqual(presented, token)) throw notFound();

    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new ApiFailure("bad_request", "invalid request");
    }
    const parsed = GrantRequestSchema.safeParse(json);
    if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
    const { clerkId, credits, key } = parsed.data;

    const user = await c.env.DB.prepare("SELECT id, billing_account_id FROM users WHERE clerk_id = ?")
      .bind(clerkId)
      .first<{ id: string; billing_account_id: string }>();
    if (user === null) return c.json({ error: "no_such_user" }, 404);

    const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
    // The command id comes from the key, so a retry with the same key returns the stored result and grants nothing more.
    await wallet.apply({
      type: "grant",
      id: `admin:${key}`,
      bucket: "purchased",
      credits,
      ref: "admin",
      user_id: user.id,
    });
    const view = await wallet.read();
    return c.json({ granted: credits, balance: view.monthly + view.purchased });
  });
}
