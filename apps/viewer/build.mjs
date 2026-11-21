import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

// Builds the viewer into dist/ for Workers static assets (apps/api/wrangler.jsonc "assets"). TURNSTILE_SITE_KEY comes
// from the environment; without it, Cloudflare's always-passing test key is used (development only).
const siteKey = process.env.TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";
if (!/^[0-9A-Za-z_-]{1,64}$/.test(siteKey)) throw new Error("bad TURNSTILE_SITE_KEY");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/viewer", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "none",
  outfile: "dist/viewer/viewer.js",
  define: { TURNSTILE_SITE_KEY: JSON.stringify(siteKey) },
});
copyFileSync("static/viewer.html", "dist/viewer.html");
copyFileSync("static/viewer.css", "dist/viewer/viewer.css");
// Served by Workers static assets as response headers for /viewer.html (it bypasses the Worker); not served as a file.
copyFileSync("static/_headers", "dist/_headers");
