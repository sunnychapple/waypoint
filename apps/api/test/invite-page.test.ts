import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { handleError } from "../src/errors.ts";
import { invitePageRoute } from "../src/groups/invite-page.ts";
import { Hono } from "hono";
import type { AppEnv } from "../src/env.ts";

const TOKEN = "a".repeat(43);
const dummyEnv = {} as AppEnv["Bindings"];

function app() {
  const a = new Hono<AppEnv>();
  a.onError(handleError);
  a.route("/", invitePageRoute());
  return a;
}

describe("GET /i/:token", () => {
  it("serves the page with the app link and the security headers", async () => {
    const res = await app().request(`/i/${TOKEN}`, {}, dummyEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Join a space on NotePath</title>");
    expect(html).toContain(`href="waypoint://invite/${TOKEN}"`);
    expect(html).toContain("Open in NotePath");
    expect(html).toContain("Ask the person who invited you for the TestFlight link.");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("allows only the nonce'd inline script and no external assets", async () => {
    const res = await app().request(`/i/${TOKEN}`, {}, dummyEnv);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain(`<script nonce="${nonce}">location.href = "waypoint://invite/${TOKEN}";</script>`);
    expect(html).not.toMatch(/<(link|img|iframe)\b|src=|https?:\/\//);
  });

  it("uses a new nonce on each response", async () => {
    const a = await app().request(`/i/${TOKEN}`, {}, dummyEnv);
    const b = await app().request(`/i/${TOKEN}`, {}, dummyEnv);
    expect(a.headers.get("Content-Security-Policy")).not.toBe(b.headers.get("Content-Security-Policy"));
  });

  it.each([
    ["too short", "a".repeat(42)],
    ["too long", "a".repeat(44)],
    ["bad characters", `${"a".repeat(41)}<>`],
    ["quote", `${"a".repeat(42)}"`],
    ["dot", `${"a".repeat(42)}.`],
  ])("a token that is %s is 404", async (_name, token) => {
    const res = await app().request(`/i/${encodeURIComponent(token)}`, {}, dummyEnv);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("waypoint://");
  });

  it("is reachable without a session through the full app", async () => {
    const full = createApp({ fetchJwks: async () => ({ keys: [] }), now: () => 0, newId: () => "id" });
    const res = await full.request(`/i/${TOKEN}`, {}, dummyEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });
});
