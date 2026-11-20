import type { WalletResponse } from "@waypoint/contracts";
import { creditsLabel } from "../config/config.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const digits = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// "Dec 19" in the phone's time zone; offsetMinutes is -new Date().getTimezoneOffset().
export function shortDate(ms: number, offsetMinutes: number): string {
  const d = new Date(ms + offsetMinutes * 60_000);
  return `${MONTHS[d.getUTCMonth()] ?? ""} ${d.getUTCDate()}`;
}

export type BalanceSummary = { total: string; detail: string; owed: string | null; renews: string | null };

export function balanceSummary(wallet: WalletResponse, offsetMinutes: number): BalanceSummary {
  const { monthly, purchased, owed, available } = wallet.balance;
  const keep = `${digits(purchased)} yours to keep`;
  return {
    total: creditsLabel(available),
    detail: wallet.plan === "plus" || monthly > 0 ? `${digits(monthly)} this month · ${keep}` : keep,
    owed: owed > 0 ? `${creditsLabel(owed)} owed after a refund. New credits pay this first.` : null,
    renews: wallet.plan === "plus" && wallet.monthly_resets_at !== null ? `Monthly credits renew on ${shortDate(wallet.monthly_resets_at, offsetMinutes)}.` : null,
  };
}

export function ownsOwnIt(wallet: WalletResponse): boolean {
  return wallet.entitlements.some((e) => e.product === "own_it" && e.ended_at === null);
}

// "You need 3 more credits for this." for /plans?need=3; null for anything that is not a whole number from 1 up.
export function needLine(need: string | undefined): string | null {
  if (need === undefined || !/^\d{1,7}$/.test(need) || Number(need) < 1) return null;
  return `You need ${creditsLabel(Number(need))} more for this.`;
}

export type BuyKind = "granted" | "pending" | "cancelled" | "not_ready" | "other_account" | "saved" | "failed";

// What the Plans screen says after a purchase. null: say nothing (cancelled, or another screen was opened).
export function buyMessage(kind: BuyKind, credits: number): string | null {
  switch (kind) {
    case "granted":
      return credits > 0 ? `Added ${creditsLabel(credits)}.` : "Done.";
    case "pending":
      return "Waiting for approval. If a parent needs to say yes, the credits arrive when they do.";
    case "saved":
      return "Paid. The credits arrive as soon as you're back online.";
    case "other_account":
      return "This purchase belongs to another Waypoint account.";
    case "failed":
      return "The purchase didn't go through. If you were charged, Waypoint keeps trying to add it.";
    case "cancelled":
    case "not_ready":
      return null;
  }
}

export function restoreMessage(count: number): string {
  return count === 0 ? "Nothing to restore." : `Restored ${count} ${count === 1 ? "purchase" : "purchases"}.`;
}
