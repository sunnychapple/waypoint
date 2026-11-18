# Build plan

Each pull request is one task card: small enough to finish in one sitting without losing context. Cards in the same wave touch different folders and can run in parallel. A wave starts when the one before it is merged. Cards for later waves are written in full when their wave starts, against the code that exists by then.

Every card follows `AGENTS.md`. If a card leaves something unclear, ask in the pull request; do not invent.

Dependency versions to use (exact):

| Package | Version |
|---|---|
| typescript | 7.0.2 (root) |
| vitest | 5.1.1 (root) |
| zod | 4.6.7 |
| hono | 4.13.19 |
| wrangler | 4.164.0 |
| @cloudflare/workers-types | 5.20261118.1 |

## Package template

Every new package in `packages/<name>` has exactly:

```
packages/<name>/package.json
packages/<name>/tsconfig.json
packages/<name>/src/index.ts      (re-exports only)
packages/<name>/src/*.ts
packages/<name>/test/*.test.ts
```

`package.json`:

```json
{
  "name": "@waypoint/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

Add a `"dependencies"` block only if the card lists dependencies. `tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

---

## Wave 1: pure building blocks (no Cloudflare, no network)

### PR 01 · `packages/contracts`: API error shape, task names, quote schemas

Branch `pr/01-contracts`. Dependencies: `zod` 4.6.7. Files: only under `packages/contracts/`.

`src/errors.ts`
- `ERROR_CODES` (readonly tuple): `bad_request`, `unauthorized`, `forbidden`, `plan_required`, `not_found`, `conflict`, `insufficient_credits`, `rate_limited`, `internal`. Type `ErrorCode`.
- `STATUS_FOR_CODE: Record<ErrorCode, number>`: bad_request 400, unauthorized 401, insufficient_credits 402, forbidden 403, plan_required 403, not_found 404, conflict 409, rate_limited 429, internal 500.
- `ApiErrorSchema`: zod object, strict: `code` (enum of `ERROR_CODES`), `message` (non-empty string), `retry_after` (integer ≥ 0, or null). Type `ApiError`.
- `InsufficientCreditsErrorSchema`: `ApiErrorSchema` with `code` fixed to `insufficient_credits` plus `shortfall` (integer ≥ 1). Strict.
- `apiError(code, message, retryAfter = null): ApiError`.

`src/tasks.ts`
- `INSTANT_TASKS`: `explain`, `more_detail`, `double_check`, `read_link`.
- `JOB_TYPES`: `research`, `overview_script`, `video_slides`, `diagram`, `mini_app`, `practice`, `retranscribe`.
- `RESEARCH_DEPTHS`: `quick`, `standard`, `deep`.
- Types `InstantTask`, `JobType`, `ResearchDepth`.

`src/quote.ts`
- `QUOTE_TASKS`: `explain`, `more_detail`, `double_check`, `research`, `overview_script`, `video_slides`, `diagram`, `mini_app`, `practice`, `retranscribe`. (`read_link` is not quotable yet: its price is not decided.)
- `QuoteRequestSchema`: strict object `{ task, minutes?, depth?, fallback_voice? }`. `minutes` is a number > 0. `depth` is a research depth. `fallback_voice` is boolean. Refinements, each with its own error message:
  - `research` requires `depth`; any other task with `depth` is rejected.
  - `retranscribe` requires `minutes`.
  - `fallback_voice: true` is allowed only for `overview_script` and `video_slides`.
  - `overview_script` may carry `minutes` (as in the spec example); every other task except `retranscribe` rejects `minutes`.
- `QuoteResponseSchema`: strict object `{ credits (int ≥ 1), price_table (non-empty string), retention ("standard" | "zero"), balance_after (int ≥ 0), expires_in (int ≥ 1) }`.
- Types `QuoteRequest`, `QuoteResponse`.

`src/headers.ts`
- `IDEMPOTENCY_KEY_HEADER = "Idempotency-Key"`.
- `isValidIdempotencyKey(value: string | null | undefined): boolean`: true only for 16 to 128 characters of `A-Z a-z 0-9 _ -`.

Tests: every schema accepts the spec's quote example and rejects each refinement case above; `STATUS_FOR_CODE` covers every code; idempotency key boundary lengths 15, 16, 128, 129 and a bad character.

Not in this PR: request schemas for any other endpoint.

### PR 02 · `packages/pricing`: credit rule and the price table

Branch `pr/02-pricing`. Dependencies: `zod` 4.6.7. Files: only under `packages/pricing/`. Do not import `@waypoint/contracts` (it is built in parallel).

`src/rule.ts`
- `CREDIT_VALUE_USD = 0.0005`.
- `creditsForCost(costUsd: number): number`: `Math.max(1, Math.ceil(costUsd / CREDIT_VALUE_USD - 1e-9))`. Throws `RangeError` for negative, `NaN` or infinite input.

`src/table.ts`
- `PRICE_KEYS`: `explain`, `double_check`, `more_detail`, `research_quick`, `research_standard`, `research_deep`, `overview_script`, `video_slides`, `diagram`, `mini_app`, `practice`, `retranscribe`, `fallback_voice`. Type `PriceKey`.
- `PriceTableSchema` (zod, strict): `{ version: non-empty string, credits: record of every PriceKey to int ≥ 1 }`. Every key required, no extra keys. Type `PriceTable`.
- `PRICE_TABLE_2026_11_16_2: PriceTable`, version `"2026-11-16.2"`, credits exactly as in `docs/architecture.md` section 7 (`retranscribe` 1, `fallback_voice` 2).

`src/quote.ts`
- `QuoteInput = { task: string; depth?: "quick" | "standard" | "deep"; minutes?: number; fallback_voice?: boolean }`.
- `priceKeyFor(input): PriceKey`: `research` + depth → `research_<depth>`; `retranscribe` → `retranscribe`; any other task that equals a PriceKey other than `fallback_voice` → itself. Throws `Error("unknown task: <task>")` otherwise, and for `research` without depth.
- `quoteCredits(table, input): number`: base credits for the key; for `retranscribe`, credits × `Math.ceil(minutes)` (throws if minutes missing or ≤ 0); add `fallback_voice` credits when `fallback_voice` is true.

Tests: `creditsForCost` for 0 → 1, 0.0005 → 1, 0.00051 → 2, 0.001 → 2, 0.0612 → 123, and each throw; the shipped table parses with `PriceTableSchema`; a table missing a key or with an extra key fails; `quoteCredits` for explain (1), research deep (125), retranscribe 4.2 minutes (5), overview with fallback voice (42), and each throw.

### PR 03 · `packages/ledger`: wallet rules as pure functions

Branch `pr/03-ledger`. No dependencies. Files: only under `packages/ledger/`. No I/O: the Durable Object that stores this comes later.

`src/types.ts`
- `Bucket = "monthly" | "purchased"`.
- `EntryKind = "grant" | "hold" | "settle" | "release" | "refund" | "clawback" | "reset"`.
- `LedgerEntry = { id: string; at: number; user_id: string | null; kind: EntryKind; bucket: Bucket; credits: number; ref: string }`. `credits` is the signed change to that bucket's balance.
- `Hold = { id: string; user_id: string; task: string; credits: number; expires_at: number; from_monthly: number; from_purchased: number }`.
- `WalletState = { balances: { monthly: number; purchased: number; monthly_resets_at: number | null }; holds: Record<string, Hold>; applied: Record<string, CommandResult> }` (`applied` maps command id to its first result).

`src/commands.ts`: one function `apply(state, command, now): { state: WalletState; entries: LedgerEntry[]; result: CommandResult }`. It never mutates its input. Each command has a unique `id`; applying a command whose `id` is already in `applied` returns the stored result, the unchanged state and no entries. Entry ids are `<command id>:<n>` with n from 0. All credit amounts must be positive integers, otherwise throw `RangeError`.

Commands:
- `grant { id, bucket, credits, ref, user_id? }`: add to the bucket. Result `{ ok: true }`.
- `hold { id, hold_id, user_id, task, credits, expires_at }`: if monthly + purchased < credits, result `{ ok: false, shortfall }` and nothing changes. Otherwise take from monthly first, then purchased; store the split on the hold; one `hold` entry per bucket touched (negative credits); result `{ ok: true }`. A `hold_id` that already exists throws.
- `settle { id, hold_id, actual }`: `actual` is an integer ≥ 0. Charged = min(actual, hold credits); never more than the hold. Return the rest to purchased first (up to what purchased gave), then monthly; one `settle` entry per bucket that gets credits back; delete the hold; result `{ ok: true, charged }`. Unknown hold: result `{ ok: false, reason: "unknown_hold" }`.
- `release { id, hold_id }`: return the hold's full split to the buckets it came from (`release` entries), delete it. Unknown hold: `{ ok: false, reason: "unknown_hold" }`.
- `release_expired { id }`: release every hold with `expires_at <= now`, in hold id order. Result `{ ok: true, released: string[] }`.
- `refund { id, bucket, credits, ref, user_id? }`: give credits back to a bucket (a task failed after settle). Result `{ ok: true }`.
- `clawback { id, credits, ref }`: remove credits from purchased, never below 0; one `clawback` entry for the amount actually removed (skip the entry if 0). Result `{ ok: true, removed }`.
- `reset { id, credits, resets_at }`: set monthly to `credits` (unused monthly does not roll over) with one `reset` entry for the difference (skip if 0); set `monthly_resets_at`. Credits may be 0 here. Result `{ ok: true }`.

`src/rebuild.ts`
- `emptyWallet(): WalletState`.
- `balancesFromLedger(entries): { monthly: number; purchased: number }`: sum of credits per bucket.

Tests: one test per command and per failure case; duplicate command id; hold that spans both buckets then settle with partial actual; settle with actual above the hold charges only the hold; a 200-step seeded sequence of random valid commands after which `balancesFromLedger(all entries)` equals `state.balances` and no balance is ever negative.

Not in this PR: storage, plans, monthly scheduling, Apple.

### PR 04 · `db/d1`: the D1 directory schema

Branch `pr/04-d1-schema`. No dependencies. Files: only under `db/d1/`. Tests run with Node's built-in `node:sqlite` and `node --test`, not vitest.

```
db/d1/package.json            name @waypoint/d1-schema; scripts: { "test": "node --test test/*.test.mjs" }; no typecheck script
db/d1/migrations/0001_directory.sql
db/d1/test/schema.test.mjs
```

`0001_directory.sql` creates the 12 tables in `docs/architecture.md` section 5 with exactly those columns, no others. Types and rules:
- Ids and keys are `TEXT`. Timestamps are `INTEGER` (Unix ms). Booleans are `INTEGER NOT NULL DEFAULT 0 CHECK (x IN (0, 1))`. Counts are `INTEGER NOT NULL DEFAULT 0`.
- Primary keys: `users.id`, `devices.id`, `recovery.user_id`, `groups.id`, `memberships (group_id, user_id)`, `entitlements (user_id, product, source)`, `key_envelopes (group_id, key_version, device_id)`, `invites.token_hash`, `links.id`, `purchases.transaction_id`, `jobs.id`, `activity.id`.
- `users.clerk_id` is `UNIQUE NOT NULL`. `users.plan` is `NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus', 'own'))`.
- `entitlements.source` `CHECK IN ('purchase', 'family_share')`; `media_cap_gb INTEGER NOT NULL DEFAULT 3`.
- `groups.kind` `CHECK IN ('personal', 'shared')`; `key_version INTEGER NOT NULL DEFAULT 1`.
- `memberships.role` and `invites.role` `CHECK IN ('owner', 'editor', 'viewer')`.
- `purchases.kind` `CHECK IN ('consumable', 'subscription', 'non_consumable')`; `status` `CHECK IN ('active', 'refunded', 'revoked', 'expired')`.
- `jobs.type` `CHECK IN` the 7 job types; `jobs.state` `CHECK IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')`; `quoted INTEGER NOT NULL`; `spent`, `route`, `result_key`, `expires_at` nullable.
- `activity.retention` `CHECK IN ('standard', 'zero')`.
- Foreign keys: every `user_id`, `created_by` and `accepted_by` references `users(id)`; every `group_id` references `groups(id)`; `key_envelopes.device_id` references `devices(id)`.
- Indexes: `devices(user_id)`, `memberships(user_id)`, `purchases(original_id)`, `purchases(billing_account_id)`, `jobs(user_id, created_at)`, `activity(user_id, at)`, `links(group_id)`.
- Every other column is `NOT NULL` unless the spec makes it an end or optional time (`ended_at`, `removed_at`, `verified_at`, `ends_at`, `left_at`, `accepted_by`, `passcode_hash`, `expires_at` on links, `revoked_at`) or this card says nullable.

`schema.test.mjs`: applies the migration to a fresh in-memory database with `PRAGMA foreign_keys = ON`; checks the 12 tables and their column names match the spec exactly; checks a bad `plan`, `role`, `kind`, `state` and `retention` are rejected; checks a duplicate `clerk_id` is rejected; checks a membership for a missing group is rejected; checks no column anywhere is named `text`, `content`, `body`, `transcript` or `note`.

### PR 05 · `packages/router`: turning router answers into a route

Branch `pr/05-router`. Dependencies: `zod` 4.6.7. Files: only under `packages/router/`. No network: the call to Clef comes later.

`src/questions.ts`
- `ROUTER_QUESTIONS`: constant describing the four questions exactly as in `docs/architecture.md` section 6 (`difficulty` score 1–5, `needs_web` yes/no, `subject` choice of `math | science | language | history | other`, `unsafe` yes/no).
- `RouterAnswersSchema` (zod, strict): `{ difficulty: { value: int 1–5, p }, needs_web: { value: boolean, p }, subject: { value: subject, p }, unsafe: { value: boolean, p } }`, every `p` a number from 0 to 1. Type `RouterAnswers`.

`src/routes.ts`
- `TIERS = ["light", "standard", "strong"]`. Type `Tier`.
- `RouteEntry = { model: string; retention: "standard" | "zero" }`.
- `RouteTableSchema` (zod, strict): `{ version: non-empty string, tiers: { light: RouteEntry[], standard: RouteEntry[], strong: RouteEntry[] } (each at least one entry), fixed: partial record from task name to Tier }`. Type `RouteTable`.
- `DEFAULT_ROUTES: RouteTable`, version `"2026-11-16.1"`. One entry per tier with the planning models, all `retention: "standard"` (no route is confirmed zero-retention yet): light `"workers-ai/glm-4.7-flash"`, standard `"workers-ai/deepseek-v4.1-flash"`, strong `"workers-ai/kimi-k2.6"`. These ids are placeholders until flow 8; leave a one-line comment saying so. `fixed`: `more_detail` standard, `double_check` strong, `research_read` light, `research_write` standard, `overview_script` strong, `video_slides` strong, `diagram` strong, `mini_app` strong, `practice` standard. `explain` is not fixed: the router picks.

`src/decide.ts`
- `chooseTier(answers, minConfidence = 0.6): Tier`: if `difficulty.p < minConfidence` → strong; otherwise 1–2 light, 3–4 standard, 5 strong.
- `decideRoute({ task, answers?, zeroRetention, routes, minConfidence? })` returns either `{ ok: true, tier, model, retention, offerResearch, unsafe }` or `{ ok: false, reason: "no_zero_retention_route" | "answers_required" }`.
  - Tier: `routes.fixed[task]` if present; otherwise `chooseTier(answers)`; if there is no fixed tier and no answers → `answers_required`.
  - Model: the first entry of that tier. If `zeroRetention`, the first entry with `retention: "zero"` in that tier, else in the next stronger tiers (light → standard → strong); none at all → `no_zero_retention_route`. Never fall back to a `standard` entry when `zeroRetention` is on.
  - `offerResearch`: `needs_web.value && needs_web.p >= minConfidence` (false without answers).
  - `unsafe`: `unsafe.value && unsafe.p >= minConfidence` (false without answers). Report it only; do not change the route (what to do with it is not decided).

Tests: each difficulty band; low confidence goes strong; fixed tasks ignore answers; zero retention with no zero routes fails; zero retention picks a zero entry from a stronger tier; `DEFAULT_ROUTES` parses; invalid answers (p > 1, difficulty 6) fail the schema.

---

## Wave 2: the API Worker's spine (cards written when wave 1 is merged)

| PR | Title | Builds on |
|---|---|---|
| 06 | `apps/api` skeleton: Hono app, wrangler config with all bindings, one error handler using the contracts error shape, 404, Idempotency-Key required on writes (header check only) | 01 |
| 07 | Clerk session check middleware (JWT verified against JWKS, user loaded or created in D1) | 04, 06 |
| 08 | Wallet Durable Object: stores `packages/ledger` state in DO SQLite, RPC methods for each command | 03, 06 |
| 09 | `GET /v1/config` and the KV config loader (prices, routes, router, flags, min-native, voice-pack), validated with the package schemas | 02, 05, 06 |
| 10 | Group room Durable Object: `changes` and `cursors`, append with next seq, fetch after seq (no sockets yet) | 06 |

## Wave 3: endpoints and flows

| PR | Title |
|---|---|
| 11 | Idempotency store: replay the first response for a repeated key (D1 or DO, decided in the card) |
| 12 | `POST /v1/tasks/quote` |
| 13 | Clef router call through AI Gateway, using `packages/router` |
| 14 | `POST /v1/tasks/explain`: hold, route, stream through AI Gateway with logging off, settle, usage event |
| 15 | `POST /v1/tasks/more-detail` and `POST /v1/tasks/double-check` |
| 16 | `GET /v1/wallet`, `GET /v1/wallet/ledger` |
| 17 | `POST /v1/purchases/apple`: verify the signed transaction, grant once per transaction id |
| 18 | `POST /webhooks/apple`: renewal, refund, revoke; monthly allowance and clawback |
| 19 | `POST /webhooks/clerk` |
| 20 | Jobs API: `POST /v1/jobs`, `GET /v1/jobs/:id`, `GET /v1/jobs/:id/result`, `DELETE /v1/jobs/:id` |
| 21 | `GET /v1/jobs/:id/events` stream |
| 22 | Workflow: `overview_script` |
| 23 | Workflow: `retranscribe` (signed audio upload, Whisper in chunks, delete audio) |
| 24 | Workflow: `research` (search API, Browser Run, light reads, standard writes) |
| 25 | Workflows: `video_slides`, `diagram`, `mini_app`, `practice` |
| 26 | `POST /v1/tasks/read-link` (needs a price decision first) |
| 27 | Groups, invites and membership endpoints |
| 28 | Sync endpoints and the group socket |
| 29 | Blobs: signed upload and download URLs, paid plans only for media |
| 30 | Shared links API, Turnstile and passcode rate limits |
| 31 | Push: push-token endpoint and the queue consumer that calls Apple |
| 32 | `PUT /v1/settings/zero-retention` (Plus only) and `GET /v1/activity` |
| 33 | Usage events to Analytics Engine; cleanup cron for `results/` (7 days) and `tmp/audio/` |

## Blocked until a security owner signs off

| PR | Title |
|---|---|
| S1 | Devices: `POST /v1/devices`, approval with a 6-digit code, `DELETE`, `GET` |
| S2 | Group key envelopes and `POST /v1/groups/:id/keys` (key version bump on member removal) |
| S3 | `PUT /v1/recovery` and the 12-word recovery key |
| S4 | Sealing task results to one device |

## Mobile and web (separate track)

iOS builds and native modules need Xcode, which the current build machine does not have. These cards are written once that is in place.

| PR | Title |
|---|---|
| M1 | `apps/mobile` host shell: React Native, Hermes, Metro, `@module-federation/metro`, sign-in |
| M2 | Zephyr: `zephyr-metro-plugin`, one remote per feature, tag per native version |
| M3 | `packages/api-client`: typed client for the API using `packages/contracts` (testable in Node) |
| M4 | Device SQLite schema and migrations |
| M5+ | One card per native module and per feature bundle |
| V1 | `apps/viewer`: shared-link viewer that unlocks in the browser |

## Model choice (flow 8)

| PR | Title |
|---|---|
| E1 | `tools/model-eval`: run a task on candidate models, grade with Clef, write a report. Test set from public material only. |
