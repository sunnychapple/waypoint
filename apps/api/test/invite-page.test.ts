import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { handleError } from "../src/errors.ts";
import { invitePageRoute } from "../src/groups/invite-page.ts";
import { Hono } from "hono";
import type { AppEnv } from "../src/env.ts";

const dummyEnv = {} as AppEnv["Bindings"];

function app() {
  const a = new Hono<AppEnv>();
  a.onError(handleError);
  a.route("/", invitePageRoute());
  return a;
}

describe("GET /i (the token is in the #fragment and never reaches the server)", () => {
  it("serves the page with the security headers", async () => {
    const res = await app().request("/i", {}, dummyEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Join a space on NotePath</title>");
    expect(html).toContain("Open in NotePath");
    expect(html).toContain("Ask the person who invited you for the TestFlight link.");
    expect(html).toContain("location.hash");
    expect(html).toContain("[A-Za-z0-9_-]{43}");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("also answers /i/ with a trailing slash", async () => {
    expect((await app().request("/i/", {}, dummyEnv)).status).toBe(200);
  });

  it("does not take a token in the path", async () => {
    const res = await app().request(`/i/${"a".repeat(43)}`, {}, dummyEnv);
    expect(res.status).toBe(404);
  });

  it("allows only the nonce'd inline script and no external assets", async () => {
    const res = await app().request("/i", {}, dummyEnv);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    const html = await res.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<(link|img|iframe)\b|src=|https?:\/\/|\bon\w+=/);
  });

  it("uses a new nonce on each response", async () => {
    const a = await app().request("/i", {}, dummyEnv);
    const b = await app().request("/i", {}, dummyEnv);
    expect(a.headers.get("Content-Security-Policy")).not.toBe(b.headers.get("Content-Security-Policy"));
  });

  it("is reachable without a session through the full app", async () => {
    const full = createApp({ fetchJwks: async () => ({ keys: [] }), now: () => 0, newId: () => "id" });
    const res = await full.request("/i", {}, dummyEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });
});
