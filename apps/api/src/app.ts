import { Hono } from "hono";
import { requireSession, type SessionDeps } from "./auth/session.ts";
import type { AppEnv } from "./env.ts";
import { APPLE_ROOT_CA_G3_SHA256 } from "./apple/jws.ts";
import { applePurchaseRoute } from "./apple/route.ts";
import { configRoute } from "./config/route.ts";
import { devicesRoute } from "./devices/register.ts";
import { pairingRoutes } from "./devices/pairing.ts";
import { handleError, handleNotFound } from "./errors.ts";
import { requireIdempotencyKey } from "./idempotency.ts";
import { privacyRoutes } from "./privacy/routes.ts";
import { pushTokenRoute } from "./push/route.ts";
import { doubleCheckRoute } from "./tasks/double-check.ts";
import { explainRoute } from "./tasks/explain.ts";
import { moreDetailRoute } from "./tasks/more-detail.ts";
import { quoteRoute } from "./tasks/quote.ts";
import { walletRoutes } from "./wallet/route.ts";
import { clerkWebhookRoute } from "./webhooks/clerk.ts";

export function createApp(deps: SessionDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.notFound(handleNotFound);
  // Middleware, in this order.
  app.use("/v1/*", requireSession(deps));
  app.use("/v1/*", requireIdempotencyKey);
  // Routes go below this line.
  app.route("/", configRoute);
  app.route("/", quoteRoute);
  app.route("/", explainRoute(deps));
  app.route("/", moreDetailRoute(deps));
  app.route("/", doubleCheckRoute(deps));
  app.route("/", applePurchaseRoute({ now: deps.now, rootSha256: APPLE_ROOT_CA_G3_SHA256 }));
  app.route("/", walletRoutes(deps));
  app.route("/", clerkWebhookRoute(deps));
  app.route("/", privacyRoutes({ now: deps.now }));
  app.route("/", pushTokenRoute({ now: deps.now }));
  app.route("/", devicesRoute({ now: deps.now }));
  app.route("/", pairingRoutes({ now: deps.now }));
  return app;
}
