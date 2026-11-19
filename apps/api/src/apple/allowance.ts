import type { Db } from "../storage.ts";
import { addMonths, APPLE_PRODUCTS, PLUS_MONTHLY_CREDITS } from "./products.ts";
import type { WalletCommands } from "./purchases.ts";

const YEARLY_PLUS = Object.entries(APPLE_PRODUCTS)
  .filter(([, product]) => product.kind === "plus" && product.period === "yearly")
  .map(([id]) => id);

type YearlyRow = { transaction_id: string; billing_account_id: string; purchased_at: number };

// Plus yearly renews once a year, but its allowance is monthly. For each yearly subscription still active,
// in month k (1 to 11) of its year, reset monthly to 2,000 once, with command id plus-month:<transaction id>:<k>.
// Month 0 was reset when the year was bought (PR 17). Family Sharing members get no credits, so only accounts
// with an open Plus entitlement from a purchase are topped up. Returns how many resets were applied.
export async function topUpYearlyPlus(db: Db, walletFor: (billingAccountId: string) => WalletCommands, now: number): Promise<number> {
  if (YEARLY_PLUS.length === 0) return 0;
  const { results } = await db
    .prepare(
      `SELECT p.transaction_id, p.billing_account_id, p.purchased_at FROM purchases p
       WHERE p.product_id IN (${YEARLY_PLUS.map(() => "?").join(", ")}) AND p.status = 'active'
         AND p.purchased_at = (SELECT MAX(q.purchased_at) FROM purchases q WHERE q.original_id = p.original_id)
         AND EXISTS (SELECT 1 FROM users u JOIN entitlements e ON e.user_id = u.id
                     WHERE u.billing_account_id = p.billing_account_id AND e.product = 'plus'
                       AND e.source = 'purchase' AND e.ended_at IS NULL)`,
    )
    .bind(...YEARLY_PLUS)
    .all<YearlyRow>();
  let applied = 0;
  for (const row of results) {
    let month = 0;
    while (month < 11 && addMonths(row.purchased_at, month + 1) <= now) month++;
    if (month === 0) continue;
    const result = await walletFor(row.billing_account_id).apply({
      type: "reset",
      id: `plus-month:${row.transaction_id}:${month}`,
      credits: PLUS_MONTHLY_CREDITS,
      resets_at: addMonths(row.purchased_at, month + 1),
    });
    if (result.ok) applied++;
  }
  return applied;
}
