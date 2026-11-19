import { Hono } from "hono";
import { requireSession, type SessionDeps } from "./auth/session.ts";
import type { AppEnv } from "./env.ts";
import { handleError, handleNotFound } from "./errors.ts";
import { requireIdempotencyKey } from "./idempotency.ts";

export function createApp(deps: SessionDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.notFound(handleNotFound);
  // Middleware, in this order.
  app.use("/v1/*", requireSession(deps));
  app.use("/v1/*", requireIdempotencyKey);
  // Routes go below this line.
  return app;
}
