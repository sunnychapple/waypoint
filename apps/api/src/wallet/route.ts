import { LEDGER_PAGE_DEFAULT, LEDGER_PAGE_MAX, type LedgerResponse, type WalletResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";

type EntitlementRow = WalletResponse["entitlements"][number];

// A query value of 1 to 15 digits, or the fallback when it is absent.
function queryInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d{1,15}$/.test(value)) throw new ApiFailure("bad_request", "invalid request");
  return Number(value);
}

export function walletRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .get("/v1/wallet", async (c) => {
      const user = c.get("user");
      const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
      const [view, rows] = await Promise.all([
        wallet.read(),
        c.env.DB.prepare(
          "SELECT product, source, media_cap_gb, granted_at, ended_at FROM entitlements WHERE user_id = ? AND (ended_at IS NULL OR ended_at > ?) ORDER BY granted_at, product, source",
        )
          .bind(user.id, deps.now())
          .all<EntitlementRow>(),
      ]);
      const reply: WalletResponse = {
        balance: {
          monthly: view.monthly,
          purchased: view.purchased,
          held: view.holds.reduce((sum, hold) => sum + hold.credits, 0),
          owed: view.owed,
          available: view.monthly + view.purchased,
        },
        monthly_resets_at: view.monthly_resets_at,
        plan: user.plan,
        entitlements: rows.results,
      };
      return c.json(reply);
    })
    .get("/v1/wallet/ledger", async (c) => {
      const user = c.get("user");
      const after = queryInt(c.req.query("after"), 0);
      const limit = queryInt(c.req.query("limit"), LEDGER_PAGE_DEFAULT);
      if (limit < 1 || limit > LEDGER_PAGE_MAX) throw new ApiFailure("bad_request", "invalid request");
      const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
      const [page, view] = await Promise.all([wallet.ledger(after, limit), wallet.read()]);
      const reply: LedgerResponse = {
        entries: page.entries,
        next: page.next,
        open_holds: view.holds.map((hold) => hold.id),
      };
      return c.json(reply);
    });
}
