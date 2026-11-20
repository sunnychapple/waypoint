import { z } from "zod";
import type { FetchLike } from "../push/apns.ts";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const SiteverifySchema = z.object({ success: z.boolean() });

// Asks Turnstile whether a widget token is good. Any failure (network, bad reply, used or old token) is false.
export async function verifyTurnstile(fetchFn: FetchLike, secret: string, token: string, remoteIp: string | null): Promise<boolean> {
  if (token.length < 1 || token.length > 2048) return false;
  try {
    const reply = await fetchFn(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(remoteIp === null ? { secret, response: token } : { secret, response: token, remoteip: remoteIp }),
    });
    if (!reply.ok) return false;
    const parsed = SiteverifySchema.safeParse(await reply.json());
    return parsed.success && parsed.data.success;
  } catch {
    return false;
  }
}
