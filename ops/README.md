# ops: production KV config

`ops/config/*.json` holds one file per key in the `CONFIG` KV namespace. `node ops/seed-config.mjs` checks every file
against the Worker's own schemas (`apps/api/src/config/schemas.ts`, `packages/pricing`, `packages/router`), runs the
real `loadConfig` over them, prints the route each task gets, and prints the `wrangler kv key put` commands.
`--apply` runs them (`config:current` last). It refuses while the KV id in `apps/api/wrangler.jsonc` is the placeholder.
Needs Node 24 and `npm install` at the repo root.

| File | KV key |
|---|---|
| `current.json` | `config:current` |
| `prices-2026-11-16.2.json` | `config:prices:2026-11-16.2` (the table in `docs/architecture.md` section 7) |
| `routes-2026-11-20.1.json` | `config:routes:2026-11-20.1` |
| `router.json` | `config:router` |
| `flags.json` | `config:flags` |
| `min-native.json` | `config:min-native` (`0.1.0`, from `apps/mobile/app.json`) |
| `voice-pack.json` | `config:voice-pack` (placeholder: nothing in the app reads it yet) |

Model ids were checked against the Workers AI catalog on 2026-11-20.

## AI jobs: model and Cloudflare product

Every model call is `env.AI.run(model, …, { gateway: { id: AI_GATEWAY_ID, collectLog: false, skipCache: true } })`,
so every row also needs **Workers AI** and an **AI Gateway** whose id equals `AI_GATEWAY_ID` (`waypoint`), log collection off.

| Job (endpoint) | Route | Model | Also needs |
|---|---|---|---|
| Router for Explain | `config:router` | `@cf/cloudflare/clef-flash` | see unknown 1 |
| Explain (`POST /v1/tasks/explain`, streamed) | router picks light / standard / strong | `@cf/zai-org/glm-4.7-flash` / `@cf/deepseek-ai/deepseek-v4.1-flash-1017` / same | Workers Paid (DeepSeek V4.1 Flash is paid-only) |
| More detail (streamed) | fixed standard | `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | Workers Paid |
| Double-check | fixed strong | `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | Workers Paid |
| Research job (quick / standard / deep) | plan + page notes: `read_link` (light); answer: `research` (standard) | `@cf/zai-org/glm-4.7-flash`, then `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | Workflows (`waypoint-research`), **Web Search API** via `env.AI.websearch` with provider `ceramic` (AI Gateway credits / Unified Billing loaded, Ceramic.ai terms accepted, $0.25 per 1,000 searches), **Browser Run** (`env.BROWSER.quickAction("markdown")`, compatibility date ≥ 2026-03-24), Workers Paid |
| Overview script, video slides, diagram, mini app | fixed strong | `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | Workflows (`waypoint-write`), R2, Workers Paid |
| Practice set | fixed standard | `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | Workflows (`waypoint-write`), R2, Workers Paid |
| Problem help (`problem_help`) | standard: the code's default (`OPTIONAL_FIXED_TIERS`) until a routes version lists it | `@cf/deepseek-ai/deepseek-v4.1-flash-1017` | Workflows (`waypoint-write`), R2, Workers Paid |
| Second transcript (retranscribe) | not routed | `@cf/openai/whisper-large-v3-turbo` (hard-coded in `apps/api/src/jobs/start.ts`) | Workflows (`waypoint-retranscribe`), R2 (audio upload), Workers Paid (base64 of one audio part needs more than Free's 10 ms CPU per step) |
| Every job | | | Queues `waypoint-usage` and `waypoint-push`, Durable Objects (Wallet), D1, KV, Analytics Engine, rate limit `JOB_STARTS` |

Not served by the API today: reading a pasted link (`read_link` as its own task has no endpoint and no price,
open question 5; the route is only used inside research), the cloud fallback voice (MeloTTS; `POST /v1/jobs` refuses
`fallback_voice: true`, open question 36). Video overviews are `video_slides`: text slides, voiced on the iPhone.

All routes are `retention: "standard"`. The catalog lists zero data retention for every model above, but marking a route
`"zero"` is open question 1 (owner decision); until then a Plus user with zero retention on gets 403 for every cloud task.

## Unknown: check on staging before relying on it

1. **Clef-flash as the router** (open question 3). The real id is `@cf/cloudflare/clef-flash`. Its documented input is
   `{ model: "clef-flash", state, questions }` (typed `noul` / `choice` / `score` questions) and its reply is
   `{ model, answers, usage }`. `askRouter` (`apps/api/src/ai/router.ts`) sends chat `messages` with `response_format`
   and reads `choices[0].message.content`, so expect every router call to fail: the usage event says `router: "failed"`
   and every Explain runs on the **strong** tier. Explain still works and still costs the person 1 credit; only the
   provider cost is higher. Fixing it needs a code card that speaks Clef's format.
2. **Reasoning and token caps.** The code turns reasoning off with `chat_template_kwargs: { enable_thinking: false }`,
   which the catalog does not document for these models (DeepSeek V4.1 Flash documents `reasoning_effort`, default `high`,
   with `none` available). If reasoning stays on and counts against `max_tokens` (500 for Explain, 1,200 to 3,500 for
   jobs), answers come back empty and the task is refunded as "model failed". Test Explain and one diagram first.
3. **Strong tier.** The plan's strong model, `@cf/moonshotai/kimi-k2.6`, is marked **Deprecated 11/20/2026** on its
   catalog page, as are `@cf/deepseek-ai/deepseek-v4-pro-0813`, `@cf/moonshotai/kimi-k2.7-code` and
   `@cf/zai-org/glm-5.3-flash`. The remaining planned candidate, `@cf/zai-org/glm-5.3`, cannot turn reasoning off
   (default `max`), which makes unknown 2 near-certain. So strong uses DeepSeek V4.1 Flash, the same as standard, until
   flow 8 picks one; swap the strong entry to `@cf/zai-org/glm-5.3` once unknown 2 is settled.
4. **Whisper output.** The catalog lists `segments` and `transcription_info` without their fields; the code needs
   `transcription_info.duration` to charge per minute (without it the full quote is charged).
5. **AI Gateway `waypoint`.** Create it in the dashboard (log collection off) before the first call.

## Feature flags

`mini_app_viewer` and `diagram_viewer` are the only flags the code reads (app only). They stay `false` until M25c's
device gate passes on a real iPhone (`docs/cards/hardening-2.md`). With them off the API still runs diagram and mini app
jobs, but the app hides those buttons and will not open a saved one. Flip both to `true` in `flags.json` and re-run the
script after the gate passes.

## Worker vars and secrets for a first deploy

| Name | Kind | First deploy | Can stay placeholder for an AI test? |
|---|---|---|---|
| `CLERK_ISSUER` | var | The Clerk instance's issuer URL | **No.** Every signed-in request fails |
| `CLERK_AUTHORIZED_PARTIES` | var | Empty is fine (the `azp` check is then skipped) | Yes |
| `CLERK_WEBHOOK_SIGNING_SECRET` | secret | From the Clerk webhook to `/webhooks/clerk` (`user.created`, `user.deleted`) | **No.** The 25 starter credits are granted only by `user.created`; without them every AI task answers 402. Set the webhook up before the first sign-up |
| `AI_GATEWAY_ID` | var | `waypoint` (must match the gateway's name) | No |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` | var | From the APNs key and the bundle id | Yes: only the "job ready" push fails; results are still fetched |
| `APNS_PRIVATE_KEY` | secret | The `.p8` key | Yes, as above |
| `APPLE_BUNDLE_ID` | var | The real bundle id | Yes, unless testing purchases |
| `APPLE_ENVIRONMENTS` | var | `Production,Sandbox` | Yes |
| `APPLE_APP_APPLE_ID` | var | App Store Connect numeric id | Yes (`0` only refuses production notices) |
| `LINK_PASSCODE_PEPPER` | secret | 32 random bytes, base64url | Yes: only shared links |
| `TURNSTILE_SECRET_KEY` | secret | From the Turnstile widget | Yes: only shared links |

**Credits for a test.** A new account gets 25 credits. Extra testing credits come from the owner grant below. That covers Explain, more detail,
double-check, practice (8), diagram (18) or quick research (15), but not an overview (40), slides (50), mini app (40)
or standard/deep research. More credits come only from a purchase (a Sandbox purchase of `waypoint.credits.1000`
needs the App Store Connect products and the real `APPLE_BUNDLE_ID`). Problem help is 5 credits (1 when the problem can't be read). Its price and route are defaults in code (`OPTIONAL_PRICES`, `OPTIONAL_FIXED_TIERS`) until a new price table and routes version list `problem_help`.

Placeholders in `wrangler.jsonc` that must be real before `wrangler deploy`: the D1 `database_id`, the KV `id`, and the
rate limit `namespace_id`s if 1001 to 1003 are taken in the account. Build the viewer first
(`npm run build --prefix apps/viewer`): the `assets` directory is `apps/viewer/dist`.

## Owner credit grant (testing)

Until the App Store products exist, a TestFlight tester can get more credits only from the owner. `POST /admin/credits`
adds purchased credits to one account. It sits outside `/v1`, is gated by the `ADMIN_TOKEN` secret, and answers 404
for every refusal (including an unset or short token), so it looks like a missing route to anyone else.

Set the secret once (32 or more characters; keep the output somewhere safe, because the script needs it too):

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put ADMIN_TOKEN
```

Grant credits (the Clerk user id is in the Clerk dashboard under Users; the API has no email lookup):

```sh
export NOTEPATH_ADMIN_TOKEN='<the same value>'
node ops/grant-credits.mjs --clerk-id user_abc123 --credits 500 --reason "TestFlight"
```

`--api` defaults to `https://waypoint-api.sunnychapple30.workers.dev`. The script makes a random `--key` and prints it;
re-running with the same `--key` grants nothing more, so a retry after a timeout is safe. Each call is one grant of
1 to 5000 credits, logged in the wallet ledger with ref `admin`.
