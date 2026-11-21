#!/usr/bin/env node
// Adds purchased credits to one account through the owner-only POST /admin/credits route (testing only).
//
//   NOTEPATH_ADMIN_TOKEN=... node ops/grant-credits.mjs --clerk-id user_abc --credits 500 --reason "TestFlight"
//   options: --api <url> (default https://waypoint-api.sunnychapple30.workers.dev), --key <8-100 chars> (default random)
//
// The API finds users by Clerk user id, which the directory stores; it has no email. Look the id up in the Clerk
// dashboard (Users, then the user's id). No dependencies: Node 18 or later.

import { randomBytes } from "node:crypto";

const DEFAULT_API = "https://waypoint-api.sunnychapple30.workers.dev";

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(
    'usage: NOTEPATH_ADMIN_TOKEN=... node ops/grant-credits.mjs --clerk-id <id> --credits <1-5000> --reason "<text>" [--api <url>] [--key <key>]',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag?.startsWith("--")) usage(`unexpected argument ${flag}`);
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    options[flag.slice(2)] = value;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if ("email" in options) {
  usage("--email is not supported: the API finds users by Clerk user id; pass --clerk-id");
}
const clerkId = options["clerk-id"];
if (!clerkId) usage("--clerk-id is required");
const credits = Number(options.credits);
if (!Number.isInteger(credits) || credits < 1 || credits > 5000) usage("--credits must be a whole number from 1 to 5000");
const reason = options.reason;
if (!reason || reason.length > 200) usage("--reason is required (1 to 200 characters)");
const key = options.key ?? randomBytes(16).toString("base64url");
if (key.length < 8 || key.length > 100) usage("--key must be 8 to 100 characters");
const api = (options.api ?? DEFAULT_API).replace(/\/+$/, "");
const token = process.env.NOTEPATH_ADMIN_TOKEN;
if (!token) usage("set NOTEPATH_ADMIN_TOKEN to the ADMIN_TOKEN secret");

const res = await fetch(`${api}/admin/credits`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ clerkId, credits, reason, key }),
});
const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}
if (!res.ok) {
  console.error(`HTTP ${res.status}`, typeof body === "string" ? body : JSON.stringify(body));
  if (res.status === 404 && body?.error === undefined) console.error("(the route is hidden: check the token and that ADMIN_TOKEN is set)");
  process.exit(1);
}
console.log(JSON.stringify({ ...body, key }, null, 2));
console.log(`To retry this exact grant safely, re-run with --key ${key}`);
