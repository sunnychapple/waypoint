import { QuoteRequestSchema, type QuoteResponse } from "@waypoint/contracts";
import { shortfall } from "@waypoint/ledger";
import { quoteCredits } from "@waypoint/pricing";
import { Hono } from "hono";
import { ConfigError, loadConfig } from "../config/load.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure, InsufficientCredits } from "../errors.ts";

export const quoteRoute = new Hono<AppEnv>().post("/v1/tasks/quote", async (c) => {
  const user = c.get("user");

  const body: unknown = await c.req.json().catch(() => {
    throw new ApiFailure("bad_request", "invalid request");
  });
  const parsed = QuoteRequestSchema.safeParse(body);
  if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");

  const config = await loadConfig(c.env.CONFIG).catch((err: unknown) => {
    if (err instanceof ConfigError) throw new ApiFailure("internal", "config unavailable");
    throw err;
  });

  let credits: number;
  try {
    credits = quoteCredits(config.prices, parsed.data);
  } catch {
    throw new ApiFailure("bad_request", "invalid request");
  }

  const view = await c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id)).read();
  const short = shortfall(view, credits);
  if (short > 0) throw new InsufficientCredits(short);

  const reply: QuoteResponse = {
    credits,
    price_table: config.prices.version,
    retention: user.zero_retention ? "zero" : "standard",
    balance_after: view.monthly + view.purchased - credits,
    expires_in: 300,
  };
  return c.json(reply);
});
