import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { jwksKeySource } from "./jwks.ts";
import { loadOrCreateUser } from "./users.ts";
import { verifySessionToken } from "./token.ts";

export type SessionDeps = {
  fetchJwks: (url: string) => Promise<unknown>;
  now: () => number;
  newId: () => string;
};

const PUBLIC_PATHS = new Set(["GET /v1/config"]);
// The shared-link web viewer reads a link's locked data without signing in (PR 30).
const PUBLIC_PATTERNS = [/^GET \/v1\/links\/[A-Za-z0-9_-]{22,64}\/data$/];

export function requireSession(deps: SessionDeps): MiddlewareHandler<AppEnv> {
  const keySources = new Map<string, (kid: string) => Promise<JsonWebKey | undefined>>();
  const keySourceFor = (issuer: string): ((kid: string) => Promise<JsonWebKey | undefined>) => {
    let source = keySources.get(issuer);
    if (source === undefined) {
      source = jwksKeySource(issuer, deps.fetchJwks, deps.now);
      keySources.set(issuer, source);
    }
    return source;
  };

  return async (c, next) => {
    const route = `${c.req.method} ${c.req.path}`;
    if (PUBLIC_PATHS.has(route) || PUBLIC_PATTERNS.some((pattern) => pattern.test(route))) return next();

    const header = c.req.header("Authorization") ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    if (match === null) throw new ApiFailure("unauthorized", "sign in required");
    const token = match[1] ?? "";

    const env = c.env;
    const claims = await verifySessionToken(token, {
      issuer: env.CLERK_ISSUER,
      authorizedParties: env.CLERK_AUTHORIZED_PARTIES.split(",").map((part) => part.trim()).filter((part) => part !== ""),
      now: deps.now(),
      getKey: keySourceFor(env.CLERK_ISSUER),
    });
    const user = await loadOrCreateUser(env.DB, claims.sub, deps.now(), deps.newId);
    c.set("user", user);
    await next();
  };
}
