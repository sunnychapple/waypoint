import { SYNC_DAILY_BYTES, SYNC_DAILY_LIMIT_MESSAGE, SYNC_EXTRA_BYTES, SYNC_EXTRA_CREDITS } from "@waypoint/contracts";
import { bytesLabel } from "../settings/format.ts";

const HOUR_MS = 3_600_000;

// While today's sync budget is used up (open question 55): the time (Unix ms) sending may start again.
export const SYNC_LIMIT_KEY = "sync_limit_until";

// The server's 429 when today's budget is used up (POST /v1/groups/:id/changes, POST /v1/links).
export function isSyncLimit(status: number, message: string): boolean {
  return status === 429 && message === SYNC_DAILY_LIMIT_MESSAGE;
}

// When sending may start again: after the reply's retry_after (the next 00:00 UTC), or in an hour without one.
export function limitUntil(now: number, retryAfterSeconds: number | null): number {
  return now + (retryAfterSeconds === null ? HOUR_MS : retryAfterSeconds * 1000);
}

// Whether sending waits: a stored SYNC_LIMIT_KEY time still ahead.
export function sendingPaused(stored: string | null, now: number): boolean {
  return stored !== null && Number(stored) > now;
}

// What an error reply from POST /v1/sync/extra means for the next tap (D5):
// - "bought": an earlier tap with this key bought it and its reply was lost (409 "request already finished"). Done:
//   never pay again.
// - "price_changed": the server charges another price (409 "price changed"). Nothing was charged; this key can never buy.
// - "new_key": nothing was charged and this key can never buy (a 500 whose message asks for a new Idempotency-Key).
// - "same_key": anything else (out of credits, still in progress, any other server error). The next tap sends the same
//   key, so one purchase is never paid twice.
export type ExtraOutcome = "bought" | "price_changed" | "new_key" | "same_key";

export function extraOutcome(status: number, message: string): ExtraOutcome {
  if (status === 409 && message === "request already finished") return "bought";
  if (status === 409 && message === "price changed") return "price_changed";
  if (status === 500 && message.endsWith("new Idempotency-Key")) return "new_key";
  return "same_key";
}

// The sheet's words. `againAt` is when sync starts again, as the screen shows a time.
export function syncLimitCopy(againAt: string): { title: string; body: string; buy: string; priceChanged: string } {
  const extra = `${SYNC_EXTRA_BYTES / 1_000_000_000} GB`;
  return {
    title: `You've synced ${bytesLabel(SYNC_DAILY_BYTES)} today`,
    body: `Add ${extra} more for today for ${SYNC_EXTRA_CREDITS} credits, or wait until ${againAt}, when sync starts again. Your notes stay on this iPhone meanwhile.`,
    buy: `Add ${extra} · ${SYNC_EXTRA_CREDITS} credits`,
    priceChanged: "The price of more sync has changed, and nothing was charged. Update NotePath to see the new price.",
  };
}
