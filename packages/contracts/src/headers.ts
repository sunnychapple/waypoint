export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

// 64 so a wallet command id "<op>:<user id>:<key>" fits the ledger's 128.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function isValidIdempotencyKey(value: string | null | undefined): boolean {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}
