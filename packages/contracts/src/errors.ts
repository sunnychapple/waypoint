import { z } from "zod";

export const ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "forbidden",
  "plan_required",
  "not_found",
  "conflict",
  "insufficient_credits",
  "rate_limited",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  insufficient_credits: 402,
  forbidden: 403,
  plan_required: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export const ApiErrorSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  message: z.string().min(1),
  retry_after: z.number().int().min(0).nullable(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const InsufficientCreditsErrorSchema = ApiErrorSchema.extend({
  code: z.literal("insufficient_credits"),
  shortfall: z.number().int().min(1),
});

export function apiError(
  code: ErrorCode,
  message: string,
  retryAfter: number | null = null,
): ApiError {
  return { code, message, retry_after: retryAfter };
}
