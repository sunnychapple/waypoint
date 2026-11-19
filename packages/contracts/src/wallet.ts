import { z } from "zod";

const credits = z.number().int().min(0);
const time = z.number().int().min(0);

// GET /v1/wallet. monthly and purchased are what is free to spend now (open holds are already taken
// out of them); held is the total of open holds; available is monthly + purchased; owed is the
// balance owed, which the next credits coming in pay first.
export const WalletResponseSchema = z.strictObject({
  balance: z.strictObject({
    monthly: credits,
    purchased: credits,
    held: credits,
    owed: credits,
    available: credits,
  }),
  monthly_resets_at: time.nullable(),
  plan: z.enum(["free", "plus", "own"]),
  entitlements: z.array(
    z.strictObject({
      product: z.string().min(1),
      source: z.enum(["purchase", "family_share"]),
      media_cap_gb: credits,
      granted_at: time,
      ended_at: time.nullable(),
    }),
  ),
});

export type WalletResponse = z.infer<typeof WalletResponseSchema>;

export const LEDGER_PAGE_DEFAULT = 50;
export const LEDGER_PAGE_MAX = 100;

// GET /v1/wallet/ledger?after=<seq>&limit=<n>. Ask again with after=next until entries is empty.
export const LedgerResponseSchema = z.strictObject({
  entries: z.array(
    z.strictObject({
      id: z.string().min(1),
      at: time,
      user_id: z.string().min(1).nullable(),
      kind: z.enum(["grant", "hold", "settle", "release", "refund", "clawback", "reset"]),
      bucket: z.enum(["monthly", "purchased", "owed"]),
      credits: z.number().int(),
      ref: z.string(),
    }),
  ),
  next: time,
  open_holds: z.array(z.string().min(1)),
});

export type LedgerResponse = z.infer<typeof LedgerResponseSchema>;
