import { Hono } from "hono";
import { requireSession, type SessionDeps } from "./auth/session.ts";
import type { AppEnv } from "./env.ts";
import { APPLE_ROOT_CA_G3_SHA256 } from "./apple/jws.ts";
import { applePurchaseRoute } from "./apple/route.ts";
import { appleWebhookRoute } from "./apple/webhook.ts";
import { configRoute } from "./config/route.ts";
import { devicesRoute } from "./devices/register.ts";
import { memberRoutes } from "./groups/members.ts";
import { groupRoutes } from "./groups/routes.ts";
import { groupKeyRoutes } from "./keys/routes.ts";
import { jobsRoutes } from "./jobs/routes.ts";
import { jobWorkflow } from "./jobs/start.ts";
import { pairingRoutes } from "./devices/pairing.ts";
import { handleError, handleNotFound } from "./errors.ts";
import { requireDeviceSignature } from "./auth/signature.ts";
import { requireIdempotencyKey } from "./idempotency.ts";
import { privacyRoutes } from "./privacy/routes.ts";
import { pushTokenRoute } from "./push/route.ts";
import { recoveryRoute } from "./recovery/route.ts";
import { removeDeviceRoute } from "./devices/remove.ts";
import { doubleCheckRoute } from "./tasks/double-check.ts";
import { explainRoute } from "./tasks/explain.ts";
import { moreDetailRoute } from "./tasks/more-detail.ts";
import { quoteRoute } from "./tasks/quote.ts";
import { syncRoutes } from "./sync/routes.ts";
import { walletRoutes } from "./wallet/route.ts";
import { clerkWebhookRoute } from "./webhooks/clerk.ts";

// The routes merged before S1A that spend or buy credits. Routes written after S1A put
// requireDeviceSignature on the route itself instead (docs/cards/security.md, S1A).
export const SIGNED_BEFORE_S1A = ["/v1/tasks/explain", "/v1/tasks/more-detail", "/v1/tasks/double-check", "/v1/purchases/apple"];

export function createApp(deps: SessionDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.notFound(handleNotFound);
  // Middleware, in this order.
  app.use("/v1/*", requireSession(deps));
  app.use("/v1/*", requireIdempotencyKey);
  // Device signature (S1E). Before the routes, so it runs before a route's own idempotent() store.
  app.on("POST", SIGNED_BEFORE_S1A, requireDeviceSignature(deps));
  // Routes go below this line.
  app.route("/", configRoute);
  app.route("/", quoteRoute);
  app.route("/", explainRoute(deps));
  app.route("/", moreDetailRoute(deps));
  app.route("/", doubleCheckRoute(deps));
  app.route("/", applePurchaseRoute({ now: deps.now, rootSha256: APPLE_ROOT_CA_G3_SHA256 }));
  app.route("/", appleWebhookRoute({ now: deps.now, rootSha256: APPLE_ROOT_CA_G3_SHA256 }));
  app.route("/", walletRoutes(deps));
  app.route("/", clerkWebhookRoute(deps));
  app.route("/", privacyRoutes({ now: deps.now }));
  app.route("/", pushTokenRoute({ now: deps.now }));
  app.route("/", devicesRoute({ now: deps.now }));
  app.route("/", pairingRoutes({ now: deps.now }));
  app.route("/", recoveryRoute({ now: deps.now }));
  app.route("/", removeDeviceRoute({ now: deps.now }));
  app.route("/", groupKeyRoutes({ now: deps.now }));
  app.route("/", jobsRoutes({ now: deps.now, workflows: jobWorkflow }));
  app.route("/", groupRoutes({ now: deps.now }));
  app.route("/", memberRoutes({ now: deps.now }));
  app.route("/", syncRoutes({ now: deps.now }));
  return app;
}
