export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidIdempotencyKey(value: string | null | undefined): boolean {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}
