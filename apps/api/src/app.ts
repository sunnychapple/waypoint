import { Hono } from "hono";
import type { AppEnv } from "./env.ts";
import { handleError, handleNotFound } from "./errors.ts";
import { requireIdempotencyKey } from "./idempotency.ts";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.notFound(handleNotFound);
  // Middleware, in this order. PR 07 adds the session check here, before the Idempotency-Key check.
  app.use("/v1/*", requireIdempotencyKey);
  // Routes go below this line.
  return app;
}
