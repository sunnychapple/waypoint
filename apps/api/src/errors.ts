import { apiError, STATUS_FOR_CODE, type ErrorCode } from "@waypoint/contracts";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./env.ts";

export class ApiFailure extends Error {
  readonly code: ErrorCode;
  readonly retryAfter: number | null;

  constructor(code: ErrorCode, message: string, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiFailure";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export class InsufficientCredits extends ApiFailure {
  constructor(readonly shortfall: number) {
    super("insufficient_credits", "not enough credits");
  }
}

const CODE_FOR_HTTP_STATUS: Partial<Record<number, ErrorCode>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};

export const handleError: ErrorHandler<AppEnv> = (err, c) => {
  let code: ErrorCode = "internal";
  let message = "something went wrong";
  let retryAfter: number | null = null;
  if (err instanceof InsufficientCredits) {
    return c.json(
      { ...apiError("insufficient_credits", err.message), shortfall: err.shortfall },
      STATUS_FOR_CODE.insufficient_credits as ContentfulStatusCode,
    );
  }
  if (err instanceof ApiFailure) {
    code = err.code;
    message = err.message;
    retryAfter = err.retryAfter;
  } else if (err instanceof HTTPException) {
    code = CODE_FOR_HTTP_STATUS[err.status] ?? "internal";
    message = "request failed";
  }
  if (retryAfter !== null) c.header("Retry-After", String(retryAfter));
  return c.json(apiError(code, message, retryAfter), STATUS_FOR_CODE[code] as ContentfulStatusCode);
};

export const handleNotFound: NotFoundHandler<AppEnv> = (c) =>
  c.json(apiError("not_found", "no such endpoint"), STATUS_FOR_CODE.not_found as ContentfulStatusCode);
