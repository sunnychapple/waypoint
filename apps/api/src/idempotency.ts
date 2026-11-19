import { IDEMPOTENCY_KEY_HEADER, isValidIdempotencyKey } from "@waypoint/contracts";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.ts";
import { ApiFailure } from "./errors.ts";

const CHECKED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const requireIdempotencyKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (CHECKED_METHODS.has(c.req.method) && !isValidIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER))) {
    throw new ApiFailure("bad_request", "Idempotency-Key header required");
  }
  await next();
};
