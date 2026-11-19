import { z } from "zod";

// Apple adds fields over time, so unknown keys are allowed (looseObject); the ones used here are checked.
const AppleId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const AppleTransactionSchema = z.looseObject({
  transactionId: AppleId,
  originalTransactionId: AppleId,
  bundleId: z.string(),
  productId: z.string(),
  type: z.string(),
  inAppOwnershipType: z.string(),
  environment: z.string(),
  purchaseDate: z.number().int().min(0),
  signedDate: z.number().int().min(0),
  expiresDate: z.number().int().min(0).optional(),
  quantity: z.number().int().min(1).max(100).optional(),
  appAccountToken: z.string().optional(),
  revocationDate: z.number().int().min(0).optional(),
  revocationType: z.string().optional(),
  revocationPercentage: z.number().int().min(0).max(100000).optional(),
});

export type AppleTransaction = z.infer<typeof AppleTransactionSchema>;

// The comma-separated APPLE_ENVIRONMENTS var as a list, for example "Production,Sandbox".
export function allowedEnvironments(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter((part) => part !== "");
}
