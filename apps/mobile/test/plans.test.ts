import type { WalletResponse } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { balanceSummary, buyMessage, needLine, ownsOwnIt, restoreMessage, shortDate } from "../src/core/store/plans.ts";

function wallet(over: Partial<WalletResponse> = {}, balance: Partial<WalletResponse["balance"]> = {}): WalletResponse {
  return {
    balance: { monthly: 0, purchased: 25, held: 0, owed: 0, available: 25, ...balance },
    monthly_resets_at: null,
    plan: "free",
    entitlements: [],
    ...over,
  };
}

describe("plans copy", () => {
  it("balance for a free account", () => {
    expect(balanceSummary(wallet(), 0)).toEqual({ total: "25 credits", detail: "25 yours to keep", owed: null, renews: null });
  });
  it("balance for Plus, with a renewal date and a balance owed", () => {
    const w = wallet({ plan: "plus", monthly_resets_at: Date.UTC(2026, 11, 19, 12) }, { monthly: 1500, purchased: 2000, available: 3500, owed: 40 });
    expect(balanceSummary(w, 0)).toEqual({
      total: "3,500 credits",
      detail: "1,500 this month · 2,000 yours to keep",
      owed: "40 credits owed after a refund. New credits pay this first.",
      renews: "Monthly credits renew on Dec 19.",
    });
  });
  it("shortDate uses the given offset", () => {
    expect(shortDate(Date.UTC(2026, 0, 1, 2), -180)).toBe("Dec 31");
    expect(shortDate(Date.UTC(2026, 0, 1, 2), 0)).toBe("Jan 1");
  });
  it("ownsOwnIt only for an open own_it entitlement", () => {
    const e = { product: "own_it", source: "purchase" as const, media_cap_gb: 3, granted_at: 1, ended_at: null };
    expect(ownsOwnIt(wallet({ entitlements: [e] }))).toBe(true);
    expect(ownsOwnIt(wallet({ entitlements: [{ ...e, ended_at: 5 }] }))).toBe(false);
    expect(ownsOwnIt(wallet())).toBe(false);
  });
  it("needLine", () => {
    expect(needLine("1")).toBe("You need 1 credit more for this.");
    expect(needLine("15")).toBe("You need 15 credits more for this.");
    for (const bad of [undefined, "0", "-1", "1.5", "abc", "99999999"]) expect(needLine(bad)).toBeNull();
  });
  it("buy and restore messages", () => {
    expect(buyMessage("granted", 1000)).toBe("Added 1,000 credits.");
    expect(buyMessage("granted", 0)).toBe("Done.");
    expect(buyMessage("cancelled", 0)).toBeNull();
    expect(buyMessage("cancelled", 0, false)).toBeNull();
    expect(buyMessage("cancelled", 0, true)).toBe("Nothing was charged.");
    // A failed purchase is not known to be uncharged, so it never says "Nothing was charged", with or without ?need=.
    expect(buyMessage("failed", 0, true)).toBe(buyMessage("failed", 0));
    expect(buyMessage("failed", 0, true)).not.toMatch(/Nothing was charged/);
    expect(buyMessage("not_ready", 0, true)).toBeNull();
    expect(buyMessage("granted", 5000, true)).toBe("Added 5,000 credits.");
    expect(buyMessage("pending", 0)).toMatch(/^Waiting for approval/);
    expect(restoreMessage(0)).toBe("Nothing to restore.");
    expect(restoreMessage(1)).toBe("Restored 1 purchase.");
    expect(restoreMessage(2)).toBe("Restored 2 purchases.");
  });
});
