#!/usr/bin/env node
// Validates ops/config/*.json against the Worker's own config schemas, then prints (or, with --apply, runs) the
// wrangler commands that write them to the CONFIG KV namespace.
//
//   node ops/seed-config.mjs           validate and print the commands (touches nothing remote)
//   node ops/seed-config.mjs --apply   validate, then write every key with `wrangler kv key put --remote`
//
// Needs Node 24 (it imports the TypeScript sources directly) and `npm install` at the repo root (for zod).

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configDir = path.join(root, "ops", "config");
const wranglerConfig = path.join(root, "apps", "api", "wrangler.jsonc");

const { ConfigCurrentSchema, FlagsSchema, MinNativeSchema, RouterConfigSchema, VoicePackSchema } = await import(
  path.join(root, "apps/api/src/config/schemas.ts")
);
const { loadConfig } = await import(path.join(root, "apps/api/src/config/load.ts"));
const { PriceTableSchema, PRICE_TABLE_2026_11_16_2 } = await import(path.join(root, "packages/pricing/src/index.ts"));
const { RouteTableSchema, FIXED_TASKS, TIERS, decideRoute } = await import(path.join(root, "packages/router/src/index.ts"));

const apply = process.argv.includes("--apply");
const errors = [];
const fail = (message) => errors.push(message);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(path.join(configDir, file), "utf8"));
  } catch (err) {
    fail(`${file}: cannot read or parse (${err.message})`);
    return undefined;
  }
}

function check(key, file, schema) {
  const value = readJson(file);
  if (value === undefined) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) fail(`${key} (${file}): ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return undefined;
  }
  console.log(`ok    ${key.padEnd(30)} ${file}`);
  return value;
}

// 1. config:current names the price and route versions; every other key maps to one file.
const current = check("config:current", "current.json", ConfigCurrentSchema);
if (current === undefined) {
  for (const e of errors) console.error(`FAIL  ${e}`);
  process.exit(1);
}
const entries = [
  { key: `config:prices:${current.prices}`, file: `prices-${current.prices}.json`, schema: PriceTableSchema },
  { key: `config:routes:${current.routes}`, file: `routes-${current.routes}.json`, schema: RouteTableSchema },
  { key: "config:router", file: "router.json", schema: RouterConfigSchema },
  { key: "config:flags", file: "flags.json", schema: FlagsSchema },
  { key: "config:min-native", file: "min-native.json", schema: MinNativeSchema },
  { key: "config:voice-pack", file: "voice-pack.json", schema: VoicePackSchema },
  // Written last, so it never points at versions that are not in KV yet.
  { key: "config:current", file: "current.json", schema: ConfigCurrentSchema },
];

const values = { "config:current": current };
for (const entry of entries.slice(0, -1)) values[entry.key] = check(entry.key, entry.file, entry.schema);

const known = new Set(entries.map((e) => e.file));
for (const file of readdirSync(configDir)) {
  if (file.endsWith(".json") && !known.has(file)) fail(`${file}: not referenced by current.json (stale version?)`);
}

// 2. Production checks the schemas do not make.
const prices = values[`config:prices:${current.prices}`];
const routes = values[`config:routes:${current.routes}`];
const router = values["config:router"];
if (prices !== undefined) {
  if (prices.version !== current.prices) fail(`prices version ${prices.version} does not match config:current ${current.prices}`);
  if (prices.version === PRICE_TABLE_2026_11_16_2.version) {
    const want = JSON.stringify(Object.entries(PRICE_TABLE_2026_11_16_2.credits).sort());
    const got = JSON.stringify(Object.entries(prices.credits).sort());
    if (want !== got) fail(`prices ${prices.version} differ from PRICE_TABLE_2026_11_16_2; publish a new version instead`);
  }
}
if (routes !== undefined) {
  if (routes.version !== current.routes) fail(`routes version ${routes.version} does not match config:current ${current.routes}`);
  for (const tier of TIERS) {
    for (const entry of routes.tiers[tier]) {
      if (!entry.model.startsWith("@cf/")) fail(`routes ${tier}: ${entry.model} is not a Workers AI id (@cf/...)`);
    }
  }
}
if (router !== undefined && !router.model.startsWith("@cf/")) fail(`router model ${router.model} is not a Workers AI id (@cf/...)`);
const appVersion = JSON.parse(readFileSync(path.join(root, "apps/mobile/app.json"), "utf8")).expo.version;
const minNative = values["config:min-native"];
if (minNative !== undefined && minNative.ios !== appVersion) {
  console.log(`note  min-native ${minNative.ios} differs from apps/mobile/app.json ${appVersion}`);
}

// 3. The Worker's own loader, over an in-memory KV holding exactly these values.
if (errors.length === 0) {
  const kv = { get: async (key) => (Object.hasOwn(values, key) ? structuredClone(values[key]) : null) };
  try {
    const loaded = await loadConfig(kv);
    console.log(`ok    loadConfig()                   prices ${loaded.prices.version}, routes ${loaded.routes.version}`);
    const minConfidence = loaded.router.min_confidence;
    for (const task of FIXED_TASKS) {
      const d = decideRoute({ task, zeroRetention: false, routes: loaded.routes, minConfidence });
      console.log(`route ${task.padEnd(16)} ${d.ok ? `${d.tier.padEnd(8)} ${d.model}` : d.reason}`);
    }
    for (const tier of TIERS) console.log(`route explain/${tier.padEnd(8)} ${tier.padEnd(8)} ${loaded.routes.tiers[tier][0].model}`);
    console.log(`route router           -        ${loaded.router.model} (min_confidence ${minConfidence})`);
    console.log(`route retranscribe     light    @cf/openai/whisper-large-v3-turbo (fixed in apps/api/src/jobs/start.ts)`);
  } catch (err) {
    fail(`loadConfig: ${err.message}`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL  ${e}`);
  console.error(`\nvalidation FAILED (${errors.length} problem${errors.length === 1 ? "" : "s"}); nothing written`);
  process.exit(1);
}
console.log("\nvalidation passed");

// 4. The commands, in write order.
const rel = (p) => path.relative(root, p);
const commands = entries.map(({ key, file }) => [
  "wrangler", "kv", "key", "put", key,
  "--binding", "CONFIG", "--remote",
  "--config", rel(wranglerConfig),
  "--path", rel(path.join(configDir, file)),
]);

if (!apply) {
  console.log("\nRun from the repo root (or re-run this script with --apply):\n");
  for (const args of commands) console.log(`npx ${args.join(" ")}`);
  process.exit(0);
}

const wrangler = readFileSync(wranglerConfig, "utf8");
if (/"binding":\s*"CONFIG",\s*"id":\s*"0{32}"/.test(wrangler)) {
  console.error("\napply refused: the CONFIG namespace id in apps/api/wrangler.jsonc is still the placeholder.");
  process.exit(1);
}
for (const args of commands) {
  console.log(`\n$ npx ${args.join(" ")}`);
  const run = spawnSync("npx", args, { cwd: root, stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`\napply stopped: that command exited with ${run.status}. Keys before it were written; config:current was not changed.`);
    process.exit(run.status ?? 1);
  }
}
console.log("\nall keys written");
