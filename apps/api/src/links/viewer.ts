import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";

// The page's only script is its own; Turnstile's script and frame are allowed for passcode links (docs/security.md
// section 15, R10). Nothing else loads, and no other site may frame the page.
export const VIEWER_CSP =
  "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; " +
  "connect-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// GET /l/:id: the shared-link viewer (V1), from Workers static assets. The key stays in the URL fragment, which the
// browser never sends.
export function viewerRoute() {
  return new Hono<AppEnv>().get("/l/:id", async (c) => {
    if (!/^[A-Za-z0-9_-]{22,64}$/.test(c.req.param("id"))) throw new ApiFailure("not_found", "no such link");
    const page = await c.env.ASSETS.fetch(new Request(new URL("/viewer.html", c.req.url)));
    if (!page.ok) throw new ApiFailure("internal", "viewer unavailable");
    return new Response(page.body, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": VIEWER_CSP,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
}
