import { describe, expect, test } from "vitest";
import { LedgerResponseSchema, WalletResponseSchema } from "../src/wallet.ts";

const GOOD_WALLET = {
  balance: { monthly: 10, purchased: 5, held: 2, owed: 0, available: 15 },
  monthly_resets_at: 1_800_000_000_000,
  plan: "plus",
  entitlements: [
    { product: "sync", source: "purchase", media_cap_gb: 3, granted_at: 1_700_000_000_000, ended_at: null },
  ],
};

const GOOD_LEDGER = {
  entries: [
    {
      id: "g1",
      at: 1_700_000_000_000,
      user_id: "user-1",
      kind: "grant",
      bucket: "monthly",
      credits: 10,
      ref: "plan",
    },
  ],
  next: 1,
  open_holds: ["h1"],
};

describe("WalletResponseSchema", () => {
  test("a full good wallet reply parses", () => {
    expect(WalletResponseSchema.safeParse(GOOD_WALLET).success).toBe(true);
  });

  test("negative owed fails", () => {
    const body = { ...GOOD_WALLET, balance: { ...GOOD_WALLET.balance, owed: -1 } };
    expect(WalletResponseSchema.safeParse(body).success).toBe(false);
  });

  test("a plan of gold fails", () => {
    expect(WalletResponseSchema.safeParse({ ...GOOD_WALLET, plan: "gold" }).success).toBe(false);
  });

  test("an entitlement source of gift fails", () => {
    const entitlements = [{ ...GOOD_WALLET.entitlements[0], source: "gift" }];
    expect(WalletResponseSchema.safeParse({ ...GOOD_WALLET, entitlements }).success).toBe(false);
  });

  test("an extra key fails", () => {
    expect(WalletResponseSchema.safeParse({ ...GOOD_WALLET, extra: 1 }).success).toBe(false);
  });
});

describe("LedgerResponseSchema", () => {
  test("a good ledger reply parses", () => {
    expect(LedgerResponseSchema.safeParse(GOOD_LEDGER).success).toBe(true);
  });

  test("a ledger entry with kind spend fails", () => {
    const entries = [{ ...GOOD_LEDGER.entries[0], kind: "spend" }];
    expect(LedgerResponseSchema.safeParse({ ...GOOD_LEDGER, entries }).success).toBe(false);
  });

  test("a ledger entry with negative credits passes", () => {
    const entries = [{ ...GOOD_LEDGER.entries[0], credits: -7 }];
    expect(LedgerResponseSchema.safeParse({ ...GOOD_LEDGER, entries }).success).toBe(true);
  });
});
