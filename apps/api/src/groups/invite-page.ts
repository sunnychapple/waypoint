import { Hono } from "hono";
import type { AppEnv } from "../env.ts";

// GET /i: the page an invite link opens in a browser (no session, no database). The link is <host>/i#<token>. The token
// is in the fragment on purpose: a browser never sends it, so it is not in this Worker's request logs, Cloudflare's
// logs or any proxy's (an invite token is a bearer secret and the server is meant to hold only its SHA-256, see
// docs/security.md). The page's script reads location.hash, accepts only the invite format ([A-Za-z0-9_-]{43}), and tries
// the app's own link (waypoint://invite/<token>) at once. The page itself is the same for everyone; the script is allowed
// by a per-response nonce only.
export function invitePageRoute() {
  return new Hono<AppEnv>().get("/i/?", () => {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    return new Response(invitePage(nonce), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
}

// The page itself. `nonce` is base64 (no quotes or angle brackets), so it needs no escaping.
export function invitePage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Join a space on NotePath</title>
<style>
:root { color-scheme: light dark; --bg: #ffffff; --ink: #1c1c1e; --ink2: #5f5f66; --accent: #2f6fed; --on-accent: #ffffff; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #000000; --ink: #f2f2f7; --ink2: #a1a1a6; --accent: #4c8dff; --on-accent: #000000; } }
:root[data-theme="dark"] { --bg: #000000; --ink: #f2f2f7; --ink2: #a1a1a6; --accent: #4c8dff; --on-accent: #000000; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; background: var(--bg); color: var(--ink); font: 17px/1.4 -apple-system, system-ui, sans-serif; }
main { width: 100%; max-width: 420px; text-align: center; }
h1 { font-size: 24px; margin: 0 0 28px; }
.open { display: block; padding: 18px; border-radius: 14px; background: var(--accent); color: var(--on-accent); font-size: 19px; font-weight: 600; text-decoration: none; }
.open[hidden], p[hidden] { display: none; }
p { margin: 20px 0 0; color: var(--ink2); font-size: 15px; }
</style>
</head>
<body>
<main>
<h1>Join a space on NotePath</h1>
<a class="open" id="open" href="#" hidden>Open in NotePath</a>
<p id="bad" hidden>This invite link is incomplete. Ask the person who invited you to send it again.</p>
<p>Don't have NotePath yet? Ask the person who invited you for the TestFlight link.</p>
</main>
<script nonce="${nonce}">
var m = /^#([A-Za-z0-9_-]{43})$/.exec(location.hash);
if (m) {
  var link = "waypoint://invite/" + m[1];
  var a = document.getElementById("open");
  a.href = link;
  a.hidden = false;
  location.href = link;
} else {
  document.getElementById("bad").hidden = false;
}
</script>
</body>
</html>
`;
}
