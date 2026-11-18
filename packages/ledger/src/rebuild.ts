import type { LedgerEntry, WalletState } from "./types.ts";

export function emptyWallet(): WalletState {
  return {
    balances: { monthly: 0, purchased: 0, monthly_resets_at: null },
    holds: {},
    applied: {},
  };
}

export function balancesFromLedger(entries: readonly LedgerEntry[]): {
  monthly: number;
  purchased: number;
} {
  let monthly = 0;
  let purchased = 0;
  for (const entry of entries) {
    if (entry.bucket === "monthly") {
      monthly += entry.credits;
    } else {
      purchased += entry.credits;
    }
  }
  return { monthly, purchased };
}
