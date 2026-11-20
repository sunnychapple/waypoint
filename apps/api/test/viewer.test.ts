import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { VIEWER_CSP, viewerRoute } from "../src/links/viewer.ts";

function app() {
  const a = new Hono<AppEnv>();
  a.onError(handleError);
  a.route("/", viewerRoute());
  return a;
}
const LINK = "a".repeat(22);
const assets = (status: number) => ({
  fetch: async (request: Request) => (new URL(request.url).pathname === "/viewer.html" ? new Response("<html>viewer</html>", { status }) : new Response("no", { status: 404 })),
});
const envWith = (status: number) => ({ ASSETS: assets(status) });

describe("GET /l/:id", () => {
  it("serves the viewer page with its security headers", async () => {
    const res = await app().request(`/l/${LINK}`, {}, envWith(200));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>viewer</html>");
    expect(res.headers.get("Content-Security-Policy")).toBe(VIEWER_CSP);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("a malformed id is 404 without reading assets", async () => {
    const res = await app().request("/l/short", {}, envWith(200));
    expect(res.status).toBe(404);
  });
  it("missing assets is 500", async () => {
    const res = await app().request(`/l/${LINK}`, {}, envWith(404));
    expect(res.status).toBe(500);
  });
});
