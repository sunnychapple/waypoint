import { z } from "zod";

export const PLANS = ["free", "plus", "own"] as const;
export const PRODUCT_KINDS = ["own_it", "plus", "pack"] as const;

export type Plan = (typeof PLANS)[number];
export type ProductKind = (typeof PRODUCT_KINDS)[number];

// The StoreKit 2 transaction's jwsRepresentation, sent as it is.
export const ApplePurchaseRequestSchema = z.strictObject({
  signed_transaction: z.string().min(1).max(16384),
});

// credits: what this transaction gave this account (0 for Family Sharing, an expired period or a repeat).
export const ApplePurchaseResponseSchema = z.strictObject({
  transaction_id: z.string().min(1),
  product: z.enum(PRODUCT_KINDS),
  credits: z.number().int().min(0),
  plan: z.enum(PLANS),
});

export type ApplePurchaseRequest = z.infer<typeof ApplePurchaseRequestSchema>;
export type ApplePurchaseResponse = z.infer<typeof ApplePurchaseResponseSchema>;
