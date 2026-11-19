# Build plan

Each pull request is one task card: small enough to finish in one sitting without losing context. Cards in the same wave touch different folders and can run in parallel. A wave starts when the one before it is merged. Cards for later waves are written in full when their wave starts, against the code that exists by then.

From wave 3 on, cards live in four files under `docs/cards/` (server: `wave-3-ai-wallet.md`, `wave-3-apple-push-privacy.md`, `security.md`; app: `mobile.md`). Which card runs when, and in which order they merge, is the "Build order" section at the end of this file, with the conventions for cards not yet written, the owner's setup list and the open questions.

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
- `isValidIdempotencyKey(value: string | null | undefined): boolean`: true only for 16 to 64 characters of `A-Z a-z 0-9 _ -` (64 since the wave-1 follow-up; it was 128).

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
- `DEFAULT_ROUTES: RouteTable`, version `"2026-11-16.1"`. One entry per tier with the planning models, all `retention: "standard"` (no route is confirmed zero-retention yet): light `"workers-ai/glm-4.7-flash"`, standard `"workers-ai/deepseek-v4.1-flash"`, strong `"workers-ai/kimi-k2.6"`. These ids are placeholders until flow 8; leave a one-line comment saying so. `fixed`: `more_detail` standard, `double_check` strong, `read_link` light, `research` standard, `overview_script` strong, `video_slides` strong, `diagram` strong, `mini_app` strong, `practice` standard. `explain` is not fixed: the router picks.

`src/decide.ts`
- `chooseTier(answers, minConfidence = 0.6): Tier`: if `difficulty.p < minConfidence` → strong; otherwise 1–2 light, 3–4 standard, 5 strong.
- `decideRoute({ task, answers?, zeroRetention, routes, minConfidence? })` returns either `{ ok: true, tier, model, retention, offerResearch, unsafe }` or `{ ok: false, reason: "no_zero_retention_route" | "answers_required" }`.
  - Tier: `routes.fixed[task]` if present; otherwise `chooseTier(answers)`; if there is no fixed tier and no answers → `answers_required`.
  - Model: the first entry of that tier. If `zeroRetention`, the first entry with `retention: "zero"` in that tier, else in the next stronger tiers (light → standard → strong); none at all → `no_zero_retention_route`. Never fall back to a `standard` entry when `zeroRetention` is on.
  - `offerResearch`: `needs_web.value && needs_web.p >= minConfidence` (false without answers).
  - `unsafe`: `unsafe.value && unsafe.p >= minConfidence` (false without answers). Report it only; do not change the route (what to do with it is not decided).

Tests: each difficulty band; low confidence goes strong; fixed tasks ignore answers; zero retention with no zero routes fails; zero retention picks a zero entry from a stronger tier; `DEFAULT_ROUTES` parses; invalid answers (p > 1, difficulty 6) fail the schema.

---

## Wave 1 fix cards (after the Sonnet review)

Each wave-1 pull request gets one fix round on its own branch. Where a fix card and the original card disagree, the fix card wins. Fix only what the fix card lists; the review comment on the pull request explains each item.

Decisions made on 18 Nov 2026 (also written into `docs/architecture.md`):

- **D1 Monthly credits held across a reset are forfeited.** When a hold that took monthly credits is settled or released after a later reset, its monthly part is not returned.
- **D2 Balance owed.** A clawback larger than the purchased balance records the rest as a balance owed. Any credits that later come into the wallet (grants, refunds, settle and release returns, resets) pay the balance owed first.
- **D3 Hold expiry outlives the task.** A hold's `expires_at` is always later than the task's own time limit, and the server stops work on a task whose hold is gone. (The API cards will enforce this; the ledger just keeps its rules.)
- **D4 The +2 fallback voice applies to audio and video overviews**, and to nothing else.
- **D5 Failed commands are not recorded.** Only successful results are remembered by command id, so the app can retry the same request after buying credits.

### PR 01 fix · contracts

Branch `pr/01-contracts`.
- `minutes`: also at most 600 (a 10-hour cap).
- Document `retry_after` as seconds in a one-line comment on the schema.
- `InsufficientCreditsErrorSchema` is the body of every 402. Leave the schemas as they are.
- Add tests: `retranscribe` with `minutes` accepted; `video_slides` and `diagram` with `minutes` rejected; `minutes` 600 accepted and 600.5 rejected; `fallback_voice: true` accepted on `video_slides` and rejected on `retranscribe`; `fallback_voice: false` accepted on `retranscribe`; `ApiErrorSchema` rejects a missing `retry_after` key and accepts `retry_after: 0`; `InsufficientCreditsErrorSchema` rejects `shortfall: 1.5` and `0`; `QuoteResponseSchema` accepts `credits: 1` and `balance_after: 0`, rejects `credits: 1.5` and `expires_in: 0`.

### PR 02 fix · pricing

Branch `pr/02-pricing`.
- `priceKeyFor` throws `Error("unknown task: <task>")` when the built key is not a real `PriceKey` (for example `research` with depth `"huge"`). Use an own-property check (`Object.hasOwn`), so inherited names like `toString` are unknown too.
- `quoteCredits` throws `RangeError` when `minutes` is not finite, ≤ 0 or > 600.
- `quoteCredits` throws `Error("fallback_voice is only for overviews")` when `fallback_voice` is true and the task is not `overview_script` or `video_slides` (D4).
- `creditsForCost` throws `RangeError` when the result is not a safe integer. Keep the `1e-9` epsilon: it is there so `0.0015` gives 3, not 4. Say so in a one-line comment.
- Derive the schema's `credits` shape from `PRICE_KEYS`, so the two cannot drift.
- Add tests: every price in the shipped table equals section 7 exactly; a quote for every task; each new throw; schema rejects `0`, `1.5` and an empty `version`.

### PR 03 fix · ledger

Branch `pr/03-ledger`.
- **Command ids.** `applied` stores `{ type, result }`. A known id with a different `type` throws `Error("command id reused for a different command")`. Same id and type returns the stored result as before.
- **D5.** Store only results with `ok: true`. A failed hold (shortfall) or an unknown hold is returned but not remembered, so the same id can succeed later.
- **Ids.** Every `id` and `hold_id` must match `^[A-Za-z0-9_:-]{1,128}$` and must not be `__proto__`, `constructor` or `prototype`; otherwise `RangeError`. Use `Object.hasOwn` for every lookup in `holds` and `applied`.
- **Times.** `now`, `expires_at` and `resets_at` must be safe integers ≥ 0; otherwise `RangeError`.
- **Overflow.** Throw `RangeError` if any balance would go above `Number.MAX_SAFE_INTEGER`.
- **Unknown command type** at runtime throws `Error("unknown command type")`.
- **Results are frozen** (`Object.freeze`, including the `released` array), so a caller cannot change a stored result.
- **D1, monthly periods.** Add `monthly_period: number` (starts at 0) to `balances`. Each `reset` adds 1. A hold stores the `monthly_period` it was made in. On settle or release, the monthly part goes back only if the hold's period equals the current one; otherwise it is dropped, with no entry, and the result carries `forfeited_monthly: <credits>` (0 when nothing was dropped). On settle, credits still go back to purchased first.
- **D2, balance owed.** Add `owed: number` (starts at 0) to `balances`. Ledger entries gain the bucket `"owed"`, whose credits are the signed change to the amount owed. `clawback` removes what it can from purchased (a `clawback` entry on `purchased`), then adds the rest to owed (a `clawback` entry on `owed`, positive). Whenever credits come into the wallet (grant, refund, reset, settle and release returns), they first pay off owed: an entry with the same kind on `owed` (negative), and only the rest goes to the bucket. `clawback`'s result is `{ ok: true, removed, owed }`. `balancesFromLedger` returns `{ monthly, purchased, owed }`. For reset: the new allowance pays owed first, and monthly is set to what is left.
- Keep exporting `ApplyOutput`, `Command` and `CommandResult`; they are needed.
- **Tests.** One test per new rule, including: the reset-while-held scenario (monthly 10, hold 8, reset to 10, release → monthly stays 10 and `forfeited_monthly` is 8); the clawback-while-held scenario (purchased 100, hold 90, clawback 100 → purchased 0, owed 90; release → owed 0, purchased 0); a retry with the same id after a shortfall succeeds once credits are granted. Strengthen the 200-step sequence: at least half the holds must succeed (grant more often), include resets and clawbacks while holds are open, and check after every step that `balancesFromLedger(entries)` equals all three balances and that no balance is negative, and check for every settle and release that charged + credits returned (to buckets or to owed) + `forfeited_monthly` equals the hold's credits.

### PR 04 fix · D1 schema

Branch `pr/04-d1-schema`.
- `groups.name_locked` is `TEXT NOT NULL`: the group's name, encrypted with the group key. It is not a flag.
- Keys and public keys (`sign_pub`, `box_pub`, `wrapped_key`, `wrapped_account_key`) are base64url `TEXT`. No change needed if they already are.
- `users.billing_account_id` stays `NOT NULL`; it is set to the user's own id at sign-up.
- **Deleting.** Make `groups.created_by` nullable. Foreign keys get:
  - `ON DELETE CASCADE`: every `user_id` column (`entitlements`, `devices`, `recovery`, `memberships`, `jobs`, `activity`), every `group_id` column (`memberships`, `key_envelopes`, `invites`, `links`) and `key_envelopes.device_id`.
  - `ON DELETE SET NULL`: `groups.created_by`, `invites.accepted_by`.
  - `purchases` has no user foreign key; purchase records are kept.
- Add indexes `key_envelopes(device_id)` and `invites(group_id)`.
- **Tests.** Check column types and `NOT NULL` from `PRAGMA table_info`; check every index exists (`PRAGMA index_list`); check every CHECK list rejects a bad value (`invites.role`, `entitlements.source`, `purchases.kind`, `purchases.status`, `jobs.type` and each 0/1 flag); check every foreign key rejects a missing parent; check deleting a user removes their devices, memberships and jobs, and sets `created_by` to null on a group they made; check deleting a group removes its memberships, invites and links. Drop the test that only reads back the pragma it set.

### PR 05 fix · router

Branch `pr/05-router`.
- `fixed` uses only task names from `@waypoint/contracts`: `more_detail` standard, `double_check` strong, `read_link` light, `research` standard, `overview_script` strong, `video_slides` strong, `diagram` strong, `mini_app` strong, `practice` standard. Remove `research_read` and `research_write`; the research workflow picks its own reading tier. `retranscribe` is not routed (it always uses Whisper). `explain` is still the only task the router picks for.
- Look up `fixed` with `Object.hasOwn`, so `constructor`, `toString` and `__proto__` are not fixed tasks.
- `minConfidence` must be a finite number with 0 < value ≤ 1; otherwise `RangeError`, in both `chooseTier` and `decideRoute`.
- `tier` in the result is the tier of the entry actually used. Add `requested_tier` for the tier asked for. They differ only when zero retention moves up a tier.
- "Unsure" means only `difficulty.p < minConfidence`. Add a one-line comment.
- `RouteEntry.model` must be a non-empty string.
- Exporting `SUBJECTS`, `RouteDecision` and `DecideRouteInput` is fine.
- Add tests: zero retention on a fixed task; a stronger tier with only standard entries; the zero entry in a weaker tier is never used; `unsafe` at exactly 0.6; a custom `minConfidence`; a bad `minConfidence`; `constructor` and `__proto__` as tasks; schema for p = 0, p = 1, extra keys, difficulty 0 and 2.5; an empty model string.

## Wave 1 follow-up (after the Fable review)

A second review of wave 1 (19 Nov 2026), checked against the merged code, left two small fix pull requests. Both branch from `main` and can run one after the other. Where these cards and the wave 1 cards disagree, these win.

### PR F1 · ledger: shortfall counts the balance owed; a replayed hold must still be open

Branch `pr/fix-w1-ledger`. Files: `packages/ledger/src/types.ts`, `packages/ledger/src/commands.ts`, `packages/ledger/test/commands.test.ts`. No other files.

`src/types.ts`
- Add `| { ok: false; reason: "hold_closed" }` to `CommandResult`.
- In the `grant` and `refund` commands, change `user_id?: string` to `user_id?: string | undefined`.

`src/commands.ts`
1. Add this exported function above `execute`, exactly:
   ```ts
   // Credits to buy before a hold of this size succeeds: 0 when it fits now. A purchase pays the
   // balance owed first, so owed is added to what is missing.
   export function shortfall(balances: { monthly: number; purchased: number; owed: number }, credits: number): number {
     const available = balances.monthly + balances.purchased;
     return available >= credits ? 0 : credits - available + balances.owed;
   }
   ```
   In `hold`, replace the two `available` lines with `const short = shortfall(d.balances, command.credits); if (short > 0) return { ok: false, shortfall: short };`.
2. Add a module constant `const HOLD_CLOSED: CommandResult = Object.freeze({ ok: false, reason: "hold_closed" });`.
3. In `apply`, after the "command id reused for a different command" type check and before `return { state, entries: [], result: prior.result }`, add exactly:
   ```ts
   if (command.type === "hold") {
     // A replayed hold is ok only while that same hold is still open; otherwise the task would run unpaid.
     const open = Object.hasOwn(state.holds, command.hold_id) ? state.holds[command.hold_id] : undefined;
     if (open === undefined) return { state, entries: [], result: HOLD_CLOSED };
     if (open.user_id !== command.user_id || open.task !== command.task || open.credits !== command.credits) {
       throw new Error("command id reused for a different command");
     }
   }
   ```
   Do not compare `expires_at`: a real retry works out a new one.

Tests (`test/commands.test.ts`), each its own test:
- `shortfall`: `{monthly 5, purchased 0, owed 0}` and 5 → 0; `{0, 3, 0}` and 5 → 2; `{50, 0, 90}` and 10 → 0 (owed does not block a hold that fits); `{0, 3, 7}` and 5 → 9.
- Buy and retry: grant purchased 90, clawback 180 (owed 90), hold `h1` of 10 → `{ ok: false, shortfall: 100 }`; grant purchased 100 → owed 0, purchased 10; the same `h1` again → `{ ok: true }`, purchased 0.
- Replay of an open hold with the same id and fields returns `{ ok: true }` and no entries.
- Replay after the hold was settled → `{ ok: false, reason: "hold_closed" }`, no entries, state equal to before, `applied` unchanged.
- Replay after `release_expired` released it → `hold_closed`.
- Replay while the hold is open but with other `credits`, and with another `task` → throws "command id reused for a different command".
- Same command id with a new `hold_id` → `hold_closed`, and the new hold is not created.
- A `grant` whose `user_id` comes from a variable typed `string | undefined` and set to `undefined` compiles, and its entry's `user_id` is `null`.
- Plus refund with existing commands only: reset 2000, hold 40, then `reset { id: "apple-refund-1", credits: 0, resets_at: <now> }` → monthly 0; settle that hold with actual 10 → `charged: 10, forfeited_monthly: 30`, monthly still 0.

Run `npm run typecheck` and `npm test` from the root; every other package's tests, including `apps/api`, must pass unchanged.

### PR F2 · optional fields, the routes table's fixed tasks, Idempotency-Key length

Branch `pr/fix-w1-types-routes`. Files: `packages/pricing/src/quote.ts`, `packages/pricing/test/quote.test.ts`; `packages/router/src/routes.ts`, `packages/router/src/decide.ts`, `packages/router/test/routes.test.ts`, `packages/router/test/decide.test.ts`; `packages/contracts/src/headers.ts`, `packages/contracts/test/headers.test.ts`. If a test file named here does not exist, add the tests to the package's existing test file for that source file instead. No other files.

The repo uses `exactOptionalPropertyTypes`, so a zod-parsed object with an optional field (type `T | undefined`) cannot be passed where the field is declared `?: T`.

pricing
- `QuoteInput`: `depth?: "quick" | "standard" | "deep" | undefined; minutes?: number | undefined; fallback_voice?: boolean | undefined`.
- Test: a variable with those fields typed `| undefined` and all set to `undefined`, `task: "explain"`, gives `quoteCredits` → 1.

router `src/routes.ts`
- `export const FIXED_TASKS = ["more_detail", "double_check", "read_link", "research", "overview_script", "video_slides", "diagram", "mini_app", "practice"] as const;` with the comment `// explain is not here (the router picks its tier); retranscribe is never routed.`
- `fixed` in `RouteTableSchema` becomes:
  ```ts
  z.partialRecord(z.enum(FIXED_TASKS), TierSchema).refine(
    (fixed) => FIXED_TASKS.every((task) => Object.hasOwn(fixed, task)),
    "fixed must list every fixed task",
  )
  ```
  so a typo, a missing task, `fixed: {}`, `explain` or `retranscribe` in `fixed` are all rejected.

router `src/decide.ts`
- `DecideRouteInput`: `answers?: RouterAnswers | undefined; minConfidence?: number | undefined`.
- Replace the fixed lookup with:
  ```ts
  const fixed: Readonly<Record<string, Tier | undefined>> = input.routes.fixed;
  const fixedTier = Object.hasOwn(fixed, input.task) ? fixed[input.task] : undefined;
  ```

Router tests: `DEFAULT_ROUTES` parses; these are rejected: `fixed` with `double_check` renamed to `doble_check`; `fixed: {}`; `fixed` without `double_check`; `fixed` plus `explain: "light"`; `fixed` plus `retranscribe: "light"`. `decideRoute({ task: "diagram", answers: maybe, minConfidence: undefined, ... })` with `maybe` typed `RouterAnswers | undefined` and set to `undefined` compiles and gives `ok` with tier `strong`. Update existing fixtures only where the new schema needs every fixed task listed.

contracts `src/headers.ts`
- Pattern `^[A-Za-z0-9_-]{16,64}$`, with the comment `// 64 so a wallet command id "<op>:<user id>:<key>" fits the ledger's 128.`
- Test boundaries: 15 rejected, 16 accepted, 64 accepted, 65 rejected (replace the 128 and 129 cases).

Run `npm run typecheck` and `npm test` from the root; every other package's tests must pass unchanged.

## Wave 2: the API Worker's spine

PR 06 goes first and is merged before the others start. PRs 07 to 10 each branch from `main` after 06 is merged. They all add lines to `apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/api/src/app.ts` or `apps/api/wrangler.jsonc`; add only your own lines there and leave the rest as it is. Conflicts are sorted out when merging.

Rules for every wave-2 card, on top of `AGENTS.md`:
- Files: only under `apps/api/`, plus `package-lock.json`, unless the card names another path.
- Nothing in `apps/api/src/` imports a `node:` module. Tests may.
- Durable Object classes stay thin: all logic is in a plain module that takes a `SqlStore` (from `src/storage.ts`), and the tests run that module against `createTestStore()`. Test files never import `cloudflare:workers` or a file that does.
- Handlers and middleware are tested through `app.request(path, init, env)` with a hand-made `env` object. No Miniflare, no `wrangler dev`, no network.
- Error replies always use `ApiFailure` or the error handler from PR 06, never a hand-built JSON body.
- Never log request bodies, tokens or note text.
- Before opening the pull request, also run `npm run bundle -w @waypoint/api` and paste its last lines. It must succeed.

### PR 06 · `apps/api`: Worker skeleton, error shape, Idempotency-Key check, test stand-ins

Branch `pr/06-api-skeleton`. Files: only under `apps/api/`, plus `package-lock.json`.

`apps/api/package.json`: the package template, name `@waypoint/api`, plus:
- `"scripts"`: `"test": "vitest run"`, `"typecheck": "tsc -p tsconfig.json"`, `"bundle": "wrangler deploy --dry-run --outdir dist"`.
- `"dependencies"`: `"@waypoint/contracts": "0.0.0"`, `"hono": "4.13.19"`.
- `"devDependencies"`: `"@cloudflare/workers-types": "5.20261118.1"`, `"@types/node": "24.19.2"`, `"wrangler": "4.164.0"`.

`apps/api/tsconfig.json`, exactly:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types", "node"] },
  "include": ["src", "test"]
}
```

`apps/api/wrangler.jsonc`, exactly (the ids are placeholders until the real resources exist; they are not secrets):

```jsonc
{
  "name": "waypoint-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "waypoint",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "../../db/d1/migrations"
    }
  ],
  "kv_namespaces": [{ "binding": "CONFIG", "id": "00000000000000000000000000000000" }]
}
```

`src/env.ts`
- `export type Env = { DB: D1Database; CONFIG: KVNamespace };`
- `export type AppEnv = { Bindings: Env };`

`src/storage.ts`, exactly:

```ts
// The parts of D1 this Worker uses. D1Database satisfies this type.
export type DbStatement = {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
};

export type Db = { prepare(query: string): DbStatement };

export type SqlValue = string | number | null | ArrayBuffer;

// The parts of Durable Object storage this Worker uses. DurableObjectStorage satisfies this type.
export type SqlStore = {
  sql: { exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, SqlValue>[] } };
  transactionSync<T>(fn: () => T): T;
};
```

`src/errors.ts`
- `export class ApiFailure extends Error` with `readonly code: ErrorCode` and `readonly retryAfter: number | null`. Constructor `(code: ErrorCode, message: string, retryAfter: number | null = null)`.
- `export function handleError(err, c)`, with the parameter types Hono's `app.onError` expects:
  - `ApiFailure`: status `STATUS_FOR_CODE[code]`, body `apiError(code, message, retryAfter)`.
  - Hono `HTTPException`: map status 400 to `bad_request`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`, 409 `conflict`, 429 `rate_limited`; any other status becomes 500 `internal`. Message: `"request failed"`.
  - Anything else: 500 `internal`, message `"something went wrong"`. Never put `err.message` or a stack in the reply.
- `export function handleNotFound(c)`, typed for `app.notFound`: 404 `not_found`, message `"no such endpoint"`.
- When `retry_after` is not null, also set the `Retry-After` header to that number.

`src/idempotency.ts`
- `export const requireIdempotencyKey: MiddlewareHandler<AppEnv>`. For `POST`, `PUT`, `PATCH` and `DELETE`: if `isValidIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER))` is false, throw `ApiFailure("bad_request", "Idempotency-Key header required")`. Other methods pass through. This checks the header only; storing and replaying responses is PR 11.

`src/app.ts`, exactly this shape:

```ts
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.notFound(handleNotFound);
  // Middleware, in this order. PR 07 adds the session check here, before the Idempotency-Key check.
  app.use("/v1/*", requireIdempotencyKey);
  // Routes go below this line.
  return app;
}
```

`/webhooks/*` paths are not under `/v1/*`, so they never need an Idempotency-Key.

`src/index.ts`: `export default createApp();` and nothing else.

`test/helpers/d1.ts` and `test/helpers/sql.ts`: copy these exactly. They are the only D1 and Durable Object stand-ins; later cards reuse them and must not write their own.

```ts
// test/helpers/d1.ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Db, DbStatement } from "../../src/storage.ts";

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../db/d1/migrations/0001_directory.sql",
);

function toInput(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new TypeError(`unsupported bind value: ${typeof value}`);
}

// An in-memory D1 stand-in on node:sqlite, with the directory schema applied.
export function createTestDb(): Db {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(MIGRATION, "utf8"));
  const statement = (query: string, values: SQLInputValue[]): DbStatement => ({
    bind: (...next) => statement(query, next.map(toInput)),
    first: async <T,>() => (db.prepare(query).get(...values) ?? null) as T | null,
    all: async <T,>() => ({ results: db.prepare(query).all(...values) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(query).run(...values).changes) } }),
  });
  return { prepare: (query) => statement(query, []) };
}
```

```ts
// test/helpers/sql.ts
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlStore, SqlValue } from "../../src/storage.ts";

function toInput(value: SqlValue): SQLInputValue {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

function fromOutput(value: unknown): SqlValue {
  if (value instanceof Uint8Array) return value.slice().buffer;
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  throw new TypeError(`unsupported column value: ${typeof value}`);
}

// An in-memory stand-in for Durable Object SQLite storage on node:sqlite.
export function createTestStore(): SqlStore {
  const db = new DatabaseSync(":memory:");
  return {
    sql: {
      exec(query, ...bindings) {
        const rows = db.prepare(query).all(...bindings.map(toInput));
        return {
          toArray: () =>
            rows.map((row) =>
              Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fromOutput(value)])),
            ),
        };
      },
    },
    transactionSync(fn) {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
```

Tests (`test/`):
- `helpers.test.ts`: the two compile-time checks below, plus: `createTestDb()` has the users table (insert a user, read `plan` back as `"free"`), `first()` gives `null` for no row, `all()` gives `results`, foreign keys are on (a device for a missing user is rejected); `createTestStore()` returns a BLOB as an `ArrayBuffer`, and a `transactionSync` that throws leaves no rows behind.

  ```ts
  export const d1Fits: (db: D1Database) => Db = (db) => db;
  export const doStorageFits: (storage: DurableObjectStorage) => SqlStore = (storage) => storage;
  ```
- `app.test.ts`, using `createApp()` and adding throwaway routes inside the test only:
  - an unknown path gives 404 with exactly `{ code: "not_found", message: "no such endpoint", retry_after: null }`;
  - a route that throws `ApiFailure("rate_limited", "slow down", 30)` gives 429, that body, and `Retry-After: 30`;
  - a route that throws a plain `Error("secret detail")` gives 500 `internal` and the reply body does not contain `secret detail`;
  - a route that throws `new HTTPException(401)` gives 401 `unauthorized`; `HTTPException(418)` gives 500 `internal`;
  - every error body passes `ApiErrorSchema.parse`;
  - `POST /v1/x` with no Idempotency-Key gives 400 `bad_request`; with a 15-character key gives 400; with a valid key reaches the route; the same for `PUT`, `PATCH` and `DELETE`; `GET /v1/x` with no key reaches the route; `POST /webhooks/x` with no key reaches the route.

Not in this PR: any real endpoint, auth, Durable Objects, KV reads, CORS, rate limits.

### PR 07 · Clerk session check

Branch `pr/07-clerk-session`. Builds on 04 and 06. No new dependencies: verify the token with Web Crypto (`crypto.subtle`), which Workers and Node both have.

This card is done in two sittings on the same branch. Part A is `src/auth/token.ts` and `src/auth/jwks.ts` with their tests; commit and push. Part B is the rest.

**Part A**

`src/auth/token.ts`
- `export type SessionClaims = { sub: string; sid: string | null };`
- `export type VerifyOptions = { issuer: string; authorizedParties: readonly string[]; now: number; getKey: (kid: string) => Promise<JsonWebKey | undefined> };` (`now` is Unix ms.)
- `export async function verifySessionToken(token: string, options: VerifyOptions): Promise<SessionClaims>`. Throws `ApiFailure("unauthorized", "sign in required")` for every failure, with no detail about which check failed. It checks, in order:
  1. three dot-separated base64url parts that decode, and header and payload are JSON objects;
  2. header `alg` is exactly `"RS256"` and `kid` is a non-empty string (reject `"none"`, `HS256` and anything else);
  3. `getKey(kid)` returns a key, imported as `{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }` for `verify`, and the signature over `<header>.<payload>` is valid;
  4. `iss` equals `options.issuer` exactly;
  5. `exp` and `nbf` are numbers (seconds); the token is good when `nbf - 5 <= now/1000 < exp + 5` (5 seconds of clock skew);
  6. `sub` is a non-empty string;
  7. if `azp` is present it must be in `authorizedParties`; if `authorizedParties` is empty, any `azp` passes.
  Returns `sub` and `sid` (`sid` is `null` when absent or not a string).

`src/auth/jwks.ts`
- `export function jwksKeySource(issuer: string, fetchJwks: (url: string) => Promise<unknown>, now: () => number): (kid: string) => Promise<JsonWebKey | undefined>`.
- The URL is `<issuer>/.well-known/jwks.json` (no double slash if `issuer` ends with `/`).
- The response must be `{ keys: [...] }`; keep only keys with `kty: "RSA"` and a string `kid`. Anything else counts as no keys.
- Cache the keys for 10 minutes. When asked for a `kid` that is not in the cache, fetch again, but at most once every 60 seconds; between fetches an unknown `kid` returns `undefined`.
- If a fetch throws, keep the old keys and return what they have.
- The cache lives in the closure returned by `jwksKeySource`, nowhere else.

Part A tests (`test/token.test.ts`, `test/jwks.test.ts`): make a key pair in the test with `crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])` (under these types it returns `CryptoKeyPair | CryptoKey`; narrow with `if (!("privateKey" in pair)) throw new Error()`), and a small `signToken(header, payload)` helper in the test file. Cases: a good token; each check above failing on its own (bad shape, `alg: "none"`, `HS256`, missing `kid`, unknown `kid`, signature from another key, a changed payload, wrong `iss`, expired, `exp` 4 s ago passes, not yet valid, missing `sub`, `azp` not allowed, `azp` absent passes); every failure is `ApiFailure` with code `unauthorized` and message `sign in required`. JWKS: the URL built from an issuer with and without a trailing slash; keys are fetched once and reused within 10 minutes; fetched again after 10 minutes; an unknown `kid` fetches again only after 60 s; a failed fetch keeps the old keys; a bad response gives no keys.

**Part B**

`src/env.ts`: add `CLERK_ISSUER: string` and `CLERK_AUTHORIZED_PARTIES: string` (comma-separated, may be empty) to `Env`, and add `Variables: { user: SessionUser }` to `AppEnv`.

`wrangler.jsonc`: add `"vars": { "CLERK_ISSUER": "https://clerk.example.com", "CLERK_AUTHORIZED_PARTIES": "" }`.

`src/auth/users.ts`
- `export type SessionUser = { id: string; clerk_id: string; plan: "free" | "plus" | "own"; billing_account_id: string; zero_retention: boolean };`
- `export async function loadOrCreateUser(db: Db, clerkId: string, now: number, newId: () => string): Promise<SessionUser>`. Runs `INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?) ON CONFLICT (clerk_id) DO NOTHING` with a new id as both `id` and `billing_account_id`, then selects the row by `clerk_id`. Two calls at once for the same Clerk user end up with one row. `zero_retention` comes back as a boolean. No email, name or other Clerk profile data is stored.

`src/auth/session.ts`
- `export function requireSession(deps: { fetchJwks: (url: string) => Promise<unknown>; now: () => number; newId: () => string }): MiddlewareHandler<AppEnv>`.
- Reads `Authorization: Bearer <token>`. Missing or another scheme: `ApiFailure("unauthorized", "sign in required")`.
- Verifies with `verifySessionToken`, using `env.CLERK_ISSUER`, `env.CLERK_AUTHORIZED_PARTIES` split on commas (trimmed, empty parts dropped) and one `jwksKeySource` per issuer, created once and kept for the life of the middleware.
- Then `loadOrCreateUser(env.DB, claims.sub, ...)` and `c.set("user", user)`.
- `GET /v1/config` skips the check (the app reads it before sign-in; it holds no personal data). Every other `/v1/*` request needs it.

`src/app.ts`: `createApp` takes `deps` with the same shape as `requireSession`'s and registers `app.use("/v1/*", requireSession(deps))` before the Idempotency-Key line. `src/index.ts`: `export default createApp({ fetchJwks: (url) => fetch(url).then((r) => r.json()), now: Date.now, newId: () => crypto.randomUUID() });`. Update the PR 06 tests only as needed to pass `deps` and a valid session.

Part B tests: `loadOrCreateUser` creates a user with `billing_account_id` equal to its id, plan `free`, `zero_retention` false; a second call returns the same user and adds no row; two calls in a row with different `newId` values keep the first id. Middleware through `app.request`, with `createTestDb()` as `DB` and a `fetchJwks` stub (count its calls): no header gives 401; `Basic` gives 401; a bad token gives 401; a good token reaches the route and `c.get("user")` has the D1 user; a second request reuses the JWKS (one fetch); `GET /v1/config` with no header is not 401 (it is 404 until PR 09); a write with a good token and no Idempotency-Key gives 400; a write with no token and no key gives 401.

Not in this PR: the starter 25 credits (PR 19, with the Clerk webhook), web cookies, device signatures, rate limits.

### PR 08 · Wallet Durable Object

Branch `pr/08-wallet-do`. Builds on 03 and 06. Dependencies: add `"@waypoint/ledger": "0.0.0"` to `apps/api`.

Storage, created with `CREATE TABLE IF NOT EXISTS` when the object starts:

```
balances (bucket TEXT PRIMARY KEY CHECK (bucket IN ('monthly','purchased','owed')),
          credits INTEGER NOT NULL,
          resets_at INTEGER,          -- monthly row only, else NULL
          period INTEGER NOT NULL DEFAULT 0)  -- monthly row only: the ledger's monthly_period
holds    (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task TEXT NOT NULL, credits INTEGER NOT NULL,
          expires_at INTEGER NOT NULL, from_monthly INTEGER NOT NULL, from_purchased INTEGER NOT NULL,
          monthly_period INTEGER NOT NULL)
ledger   (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, at INTEGER NOT NULL, user_id TEXT, kind TEXT NOT NULL, bucket TEXT NOT NULL,
          credits INTEGER NOT NULL, ref TEXT NOT NULL)
applied  (command_id TEXT PRIMARY KEY, type TEXT NOT NULL, result TEXT NOT NULL, at INTEGER NOT NULL)
```

The three balance rows are inserted with 0 credits if missing. `ledger.seq` is the order entries were written in (largest plus 1, worked out inside the transaction). `applied.result` is the `CommandResult` as JSON.

`src/wallet/store.ts`
- `export function createWalletStore(store: SqlStore): { apply(command: Command, now: number): CommandResult; read(): WalletView; ledger(after: number, limit: number): { entries: LedgerEntry[]; next: number }; nextExpiry(): number | null }`.
- `export type WalletView = { monthly: number; purchased: number; owed: number; monthly_resets_at: number | null; holds: Hold[] }` (holds in id order).
- `apply`, all inside one `store.transactionSync`:
  1. Build a `WalletState` from the tables: the balance rows, all holds, and in `applied` only the row for `command.id` if there is one (the ledger package looks up nothing else).
  2. Call the ledger's `apply(state, command, now)`. Errors it throws pass through unchanged and nothing is written.
  3. If it returned the stored result (the id was already applied), write nothing.
  4. Otherwise write the new balance rows, delete holds that are gone, insert holds that are new, insert every ledger entry, and insert the `applied` row only if `result.ok` is true.
- `ledger(after, limit)`: entries with `seq > after`, in `seq` order, at most `limit`. `next` is the `seq` of the last entry returned, or `after` when none. `after` a safe integer ≥ 0 and `limit` 1 to 500, else `RangeError`.
- `nextExpiry()`: the smallest hold `expires_at`, or `null`.

`src/wallet/object.ts`
- `export class Wallet extends DurableObject<Env>` (`import { DurableObject } from "cloudflare:workers"`). The constructor creates the store from `ctx.storage` inside `ctx.blockConcurrencyWhile`.
- RPC methods: `apply(command: Command): Promise<CommandResult>` (uses `Date.now()`, then sets the alarm to `nextExpiry()` if there is one, or deletes it), `read(): Promise<WalletView>`, `ledger(after: number, limit: number): Promise<{ entries: LedgerEntry[]; next: number }>`.
- `alarm()`: applies `{ type: "release_expired", id: "expire-" + crypto.randomUUID() }` with `Date.now()`, then sets the alarm to the next expiry, if any.
- No other methods, no `fetch` handler.

`src/env.ts`: add `WALLET: DurableObjectNamespace<Wallet>`. `src/index.ts`: add `export { Wallet } from "./wallet/object.ts";`. `wrangler.jsonc`: add `"durable_objects": { "bindings": [{ "name": "WALLET", "class_name": "Wallet" }] }` and `"migrations": [{ "tag": "v1-wallet", "new_sqlite_classes": ["Wallet"] }]`.

Tests (`test/wallet-store.test.ts`, on `createTestStore()`; never import `object.ts`):
- grant then `read()`; hold then settle with a partial actual; release; clawback beyond purchased gives `owed`; reset;
- a repeated command id writes nothing new (row counts unchanged) and returns the first result; the same id with another type throws;
- a failed hold (shortfall) writes nothing and the same id later succeeds after a grant;
- an invalid command (for example credits 0) throws and writes nothing;
- a new store on the same `SqlStore` sees the same state (it survives a restart);
- after a 200-step seeded random sequence of commands, `read()` equals the result of running the same commands through the ledger package's `apply` in memory, and `balancesFromLedger` over every entry (read page by page from `ledger(0, 50)` on) equals the stored balances;
- `ledger` paging and its `RangeError`; `nextExpiry` with no holds, and with two holds.

Not in this PR: HTTP endpoints for the wallet (PR 16), who may call which command, Apple.

### PR 09 · `GET /v1/config` and the KV config loader

Branch `pr/09-config`. Builds on 02, 05 and 06. Dependencies: add `"@waypoint/pricing": "0.0.0"`, `"@waypoint/router": "0.0.0"` and `"zod": "4.6.7"` to `apps/api`. Also adds `packages/contracts/src/config.ts` and its export from `packages/contracts/src/index.ts`, and a test in `packages/contracts/test/`.

KV keys (all JSON), as in `docs/architecture.md` section 5:

| Key | Shape | Schema |
|---|---|---|
| `config:current` | `{ "prices": "<version>", "routes": "<version>" }` | in `src/config/schemas.ts` |
| `config:prices:{version}` | price table | `PriceTableSchema` from `@waypoint/pricing` |
| `config:routes:{version}` | route table | `RouteTableSchema` from `@waypoint/router` |
| `config:router` | `{ "model": string (non-empty), "min_confidence": number, 0 < x ≤ 1 }` | in `src/config/schemas.ts` |
| `config:flags` | `{ [name]: boolean }`, names `^[a-z0-9_]{1,64}$` | in `src/config/schemas.ts` |
| `config:min-native` | `{ "ios": "<major>.<minor>.<patch>" }` | in `src/config/schemas.ts` |
| `config:voice-pack` | `{ "version": string, "url": https URL, "sha256": 64 lowercase hex, "size": integer > 0 }` | in `src/config/schemas.ts` |

The table's `version` inside `config:prices:{version}` and `config:routes:{version}` must equal the `{version}` in the key.

`src/config/schemas.ts`: the five schemas above, all `z.strictObject` (flags is a `z.record`).

`src/config/load.ts`
- `export type ConfigKv = { get(key: string, options: { type: "json"; cacheTtl: number }): Promise<unknown> };`
- `export type LoadedConfig = { prices: PriceTable; routes: RouteTable; router: RouterConfig; flags: Record<string, boolean>; min_native: { ios: string }; voice_pack: VoicePack };`
- `export class ConfigError extends Error` with a `key: string` field.
- `export async function loadConfig(kv: ConfigKv): Promise<LoadedConfig>`: reads `config:current` first, then the other six keys at once (`Promise.all`), each with `cacheTtl: 60`. A missing key (`null`), a value that fails its schema, or a version mismatch throws `ConfigError` naming the key. No defaults, no fallback to the tables in the packages.

`packages/contracts/src/config.ts`
- `export const ConfigResponseSchema = z.strictObject({ prices: z.strictObject({ version: z.string().min(1), credits: z.record(z.string(), z.number().int().min(1)) }), routes_version: z.string().min(1), flags: z.record(z.string(), z.boolean()), min_native: z.strictObject({ ios: z.string().min(1) }), voice_pack: z.strictObject({ version: z.string().min(1), url: z.string().url(), sha256: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().min(1) }) });` and `export type ConfigResponse`.

`src/config/route.ts`: `export const configRoute = new Hono<AppEnv>().get("/v1/config", ...)`, and one line in `src/app.ts` under "Routes go below this line": `app.route("/", configRoute);`. `GET /v1/config` returns `ConfigResponse`: the price table, the routes version (not the models), flags, min native version and voice pack. The router config is not sent. Header `Cache-Control: public, max-age=60`. A `ConfigError` becomes `ApiFailure("internal", "config unavailable")`; the key name is not in the reply.

`src/env.ts` already has `CONFIG: KVNamespace`; nothing to add.

Tests:
- `packages/contracts/test/config.test.ts`: a good response parses; extra keys, a bad sha256 and size 0 fail.
- `test/config.test.ts`, with a `Map`-backed `ConfigKv` stub in the test that records the options it was called with:
  - compile-time check `export const kvFits: (kv: KVNamespace) => ConfigKv = (kv) => kv;`;
  - a full good config loads; every read uses `type: "json"` and `cacheTtl: 60`;
  - each of the seven keys missing gives `ConfigError` with that key;
  - each schema rejects one bad value (for example `min_confidence: 0`, `ios: "1.4"`, `sha256` in capitals, an `http://` URL, a flag name with a capital letter, a price of 0);
  - the price-table version not matching `config:current` gives `ConfigError`;
  - the route, tested on a fresh `new Hono<AppEnv>()` with `handleError` as `onError` and `configRoute` mounted (not through `createApp`, which PR 07 changes): `GET /v1/config` gives 200, a body that passes `ConfigResponseSchema`, no `router` key and no model ids anywhere in it, and the `Cache-Control` header; with one key missing it gives 500 `internal` and the body does not contain the key name.


Not in this PR: writing config to KV, a seed script, the quote endpoint (PR 12).

### PR 10 · Group room Durable Object

Branch `pr/10-group-room`. Builds on 06. No new dependencies.

Storage, created with `CREATE TABLE IF NOT EXISTS` when the object starts:

```
changes (seq INTEGER PRIMARY KEY, device_id TEXT NOT NULL, key_version INTEGER NOT NULL, kind TEXT NOT NULL,
         locked_bytes BLOB NOT NULL, blob_key TEXT, at INTEGER NOT NULL)
cursors (device_id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL, seen_at INTEGER NOT NULL)
```

The room never reads inside `locked_bytes`; it stores and returns the bytes as they are.

`src/room/store.ts`
- `export type NewChange = { device_id: string; key_version: number; kind: string; locked_bytes: ArrayBuffer; blob_key: string | null };`
- `export type Change = NewChange & { seq: number; at: number };`
- `export function createRoomStore(store: SqlStore): { append(change: NewChange, now: number): { seq: number }; after(seq: number, limit: number): { changes: Change[]; last_seq: number }; ack(deviceId: string, seq: number, now: number): void }`.
- `append`: checks, else `RangeError`: `device_id` matches `^[A-Za-z0-9_:-]{1,128}$`; `key_version` is a safe integer ≥ 1; `kind` matches `^[a-z_]{1,32}$`; `locked_bytes` is 1 to 1,048,576 bytes (bigger goes to R2 by `blob_key`); `blob_key` is `null` or 1 to 512 characters. The new `seq` is the current largest `seq` plus 1 (1 for the first), worked out and inserted inside one `transactionSync`.
- `after(seq, limit)`: changes with `seq` greater than the given one, in `seq` order, at most `limit` (1 to 500, else `RangeError`; `seq` a safe integer ≥ 0, else `RangeError`). `last_seq` is the room's largest `seq` (0 when empty), so the caller knows whether there is more.
- `ack(deviceId, seq, now)`: `deviceId` checked as above; `seq` a safe integer from 0 to the largest `seq`, else `RangeError`. Sets the device's `last_seq` to the larger of the stored and the given value, and `seen_at` to `now`.

`src/room/object.ts`
- `export class GroupRoom extends DurableObject<Env>`, store created in `ctx.blockConcurrencyWhile`.
- RPC methods `append(change: NewChange)`, `after(seq: number, limit: number)` and `ack(deviceId: string, seq: number)`, using `Date.now()`. No `fetch` handler, no sockets, no presence.

`src/env.ts`: add `GROUP_ROOM: DurableObjectNamespace<GroupRoom>`. `src/index.ts`: add `export { GroupRoom } from "./room/object.ts";`. `wrangler.jsonc`: add `{ "name": "GROUP_ROOM", "class_name": "GroupRoom" }` to the Durable Object bindings and `{ "tag": "v2-group-room", "new_sqlite_classes": ["GroupRoom"] }` to `migrations`, after the wallet entries (create the two keys if PR 08 is not merged yet).

Tests (`test/room-store.test.ts`, on `createTestStore()`; never import `object.ts`):
- the first append gets seq 1, the next 2; bytes come back byte-for-byte equal; `blob_key` null and set;
- each `append` check fails on its own, including exactly 1,048,576 bytes passing and 1,048,577 failing, and 0 bytes failing; a failed append does not use up a seq;
- `after(0, 2)` on 3 changes gives seq 1 and 2 with `last_seq` 3; `after(3, 10)` gives none; bad `seq` and `limit` throw;
- `ack` keeps the larger value, updates `seen_at`, and rejects a seq above the largest;
- a new store on the same `SqlStore` continues from the last seq.

Not in this PR: sockets, presence, push, membership checks, the HTTP sync endpoints (PR 28).

## Wave 3: endpoints and flows

| PR | Title | Full card |
|---|---|---|
| 11 | Idempotency store: replay the first response for a repeated key (D1 or DO, decided in the card) | this file (merged) |
| 12 | `POST /v1/tasks/quote` | this file (merged) |
| 13 | Clef router call through AI Gateway, using `packages/router` | `docs/cards/wave-3-ai-wallet.md` |
| 14 | `POST /v1/tasks/explain`: hold, route, stream through AI Gateway with logging off, settle, usage event | `docs/cards/wave-3-ai-wallet.md` |
| 15 | `POST /v1/tasks/more-detail` and `POST /v1/tasks/double-check` | `docs/cards/wave-3-ai-wallet.md` |
| 16 | `GET /v1/wallet`, `GET /v1/wallet/ledger` | `docs/cards/wave-3-ai-wallet.md` |
| 17 | `POST /v1/purchases/apple`: verify the signed transaction, grant once per transaction id | `docs/cards/wave-3-apple-push-privacy.md` |
| 18 | `POST /webhooks/apple`: renewal, refund, revoke; monthly allowance and clawback | `docs/cards/wave-3-apple-push-privacy.md` |
| 19 | `POST /webhooks/clerk`, and the 25 starter credits for a new account | `docs/cards/wave-3-ai-wallet.md` |
| 20 | Jobs API: `POST /v1/jobs`, `GET /v1/jobs/:id`, `GET /v1/jobs/:id/result`, `DELETE /v1/jobs/:id` | to be written (see "Conventions for the cards still to write") |
| 21 | `GET /v1/jobs/:id/events` stream | to be written |
| 22 | Workflow: `overview_script` | to be written |
| 23 | Workflow: `retranscribe` (signed audio upload, Whisper in chunks, delete audio) | to be written |
| 24 | Workflow: `research` (search API, Browser Run, light reads, standard writes) | to be written |
| 25 | Workflows: `video_slides`, `diagram`, `mini_app`, `practice` | to be written |
| 26 | `POST /v1/tasks/read-link` (needs a price decision first) | to be written |
| 27 | Groups, invites and membership endpoints | to be written |
| 28 | Sync endpoints and the group socket | to be written |
| 29 | Blobs: signed upload and download URLs, paid plans only for media | to be written |
| 30 | Shared links API, Turnstile and passcode rate limits | to be written |
| 31 | Push: push-token endpoint and the queue consumer that calls Apple | `docs/cards/wave-3-apple-push-privacy.md` |
| 32 | `PUT /v1/settings/zero-retention` (Plus only) and `GET /v1/activity` | `docs/cards/wave-3-apple-push-privacy.md` |
| 33 | Usage events to D1 `activity` and Analytics Engine; hourly cron for `results/` (7 days), `tmp/audio/`, old idempotency rows and request nonces, Plus yearly top-ups; adds R2 | `docs/cards/wave-3-apple-push-privacy.md` |

Notes the wave 3 cards must carry (from the wave 1 follow-up review):

- **PR 11:** store a hash of method, path and body with each key; the same key with another body is 409 `conflict`. Store every final response except a 402, so buy and retry works (D5). Wallet command ids are `<op>:<user_id>:<key>`, with `op` at most 24 characters.
- **PR 12:** the 402 shortfall is the ledger's `shortfall(wallet.read(), credits)`. When it is 0, `balance_after` is monthly + purchased − credits.
- **PR 14, 15, 20:** a hold result of `hold_closed` is 409 `conflict` ("request already finished"); never run a task without an ok hold. `expires_at` is now + the task's time limit + a margin (D3). Write the settle result's `charged` into `jobs.spent` and the usage event.
- **PR 16:** `GET /v1/wallet/ledger` returns the ledger rows and the open hold ids. What each task cost comes from `activity` and `jobs.spent`, not from adding up ledger rows.
- **PR 18:** a refunded or revoked Plus month is `reset { id: "apple:<notification uuid>", credits: 0, resets_at: now }`, never a clawback. A credit pack or Own it refund is a `clawback` of that purchase's credits. A renewal is `reset { credits: 2000, resets_at: <next period> }`.
- **The first card that writes `activity`:** `task` comes from the typed task list, never from request text.

## Wave 3, first cards: PR 11 and PR 12

Both branch from `main` and touch different files, so they can be built one after the other and merged in either order. The wave 2 rules (top of "Wave 2") still apply: files only where the card says, no `node:` imports in `apps/api/src`, tests through `app.request` with hand-made `env` objects, no network, run `npm run bundle -w @waypoint/api` before opening the pull request.

Route tests in both cards build a fresh app instead of using `createApp`, so they need no Clerk token:

```ts
const app = new Hono<AppEnv>();
app.onError(handleError);
app.use(async (c, next) => {
  c.set("user", user);
  await next();
});
// then mount the middleware or route under test
```

### PR 11 · Idempotency store

Branch `pr/11-idempotency-store`. No new dependencies. Files: `db/d1/migrations/0002_idempotency.sql`, `db/d1/test/schema.test.mjs`, `apps/api/test/helpers/d1.ts`, `apps/api/src/idempotency.ts`, `apps/api/test/idempotency-store.test.ts`. No other files.

Why it looks like this: a repeated write must not run twice, but the server must never store readable note content. So responses are stored only for write endpoints whose replies hold no note content (purchases, groups, invites, links, jobs created, settings). Endpoints that answer with content (`explain`, `more_detail`, `double_check`, `read_link`, a job's result) never use this store; the wallet hold, whose command id comes from the key, protects them instead (see the wave 3 notes on `hold_closed`). No route uses the store in this pull request; later cards add it to their own routes.

`db/d1/migrations/0002_idempotency.sql`, exactly:

```sql
-- Stored replies for repeated write requests (PR 11). Never holds note content: only routes whose
-- replies have none use this table. Rows older than 24 hours are ignored and cleaned up later (PR 33).
CREATE TABLE idempotency (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'done')),
  status INTEGER,
  body TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX idempotency_created_at ON idempotency (created_at);
```

`db/d1/test/schema.test.mjs`: apply every `.sql` file in `migrations/` in name order instead of only `0001`. Add `idempotency` to the expected tables and columns, and tests that: `state` rejects `'other'`; a row for a missing user is rejected; deleting the user deletes their rows; the index exists. Keep every existing test.

`apps/api/test/helpers/d1.ts`: apply every `.sql` file in `db/d1/migrations/` in name order (`readdirSync`, sorted) instead of only `0001_directory.sql`. Change nothing else in the file.

`apps/api/src/idempotency.ts`: keep `requireIdempotencyKey` as it is and add:

```ts
export const IDEMPOTENCY_KEEP_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_PENDING_MS = 60 * 1000;
export const IDEMPOTENCY_MAX_BODY_BYTES = 16384;
export function idempotent(deps: { now: () => number }): MiddlewareHandler<AppEnv>
```

What `idempotent` does, in order:
1. `key` is the `Idempotency-Key` header; if `isValidIdempotencyKey` is false, throw `ApiFailure("bad_request", "Idempotency-Key header required")`. `userId` is `c.get("user").id`.
2. `request_hash` is the lowercase hex SHA-256 (`crypto.subtle.digest`) of the bytes of `<METHOD>\n<pathname + search>\n` followed by the request body bytes (`c.req.arrayBuffer()`; the handler can still read the body afterwards).
3. `INSERT INTO idempotency (user_id, key, request_hash, state, status, body, created_at) VALUES (?, ?, ?, 'pending', NULL, NULL, ?) ON CONFLICT (user_id, key) DO NOTHING`. If one row changed, go to step 5.
4. Otherwise read the row. Then:
   - If it is older than `IDEMPOTENCY_KEEP_MS`, or it is `pending` and older than `IDEMPOTENCY_PENDING_MS` (a request that died): delete it with `WHERE user_id = ? AND key = ? AND created_at = ?` (its old `created_at`), and run the insert from step 3 once more. If that changes one row, go to step 5; if not, throw `ApiFailure("conflict", "request in progress", 1)`.
   - If `request_hash` differs: throw `ApiFailure("conflict", "Idempotency-Key reused with a different request")`.
   - If `pending`: throw `ApiFailure("conflict", "request in progress", 1)`.
   - If `done`: return the stored reply without running the handler: `new Response(body, { status, headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" } })`.
5. `await next()`. Then look at `c.res` (Hono has already turned a thrown error into a reply by this point):
   - The reply is stored only if its status is 200–299, 400, 404 or 409, its `Content-Type` starts with `application/json`, and its body (read from `c.res.clone()`) is at most `IDEMPOTENCY_MAX_BODY_BYTES` bytes. Then `UPDATE idempotency SET state = 'done', status = ?, body = ? WHERE user_id = ? AND key = ?`.
   - Otherwise delete the row, so the same request can be sent again. This covers 402 (buy credits and retry, D5), 401, 403, 429 and every 5xx.
   - If the update or delete itself throws, still return the handler's reply unchanged.
6. Never store or log the request body; only its hash.

Tests (`apps/api/test/idempotency-store.test.ts`), using `createTestDb()` with one user inserted, the fresh app above, `idempotent({ now })` with a test clock, and throwaway routes that count how often they run:
- First `POST` runs the handler and returns its reply; the same key and body again returns the same status and body with `Idempotent-Replayed: true`, and the handler count is still 1.
- The handler can read the JSON body after the middleware hashed it.
- Same key, different body → 409 `conflict`, handler not run. Same key, different path → 409. Same key, different query string → 409.
- Same key used by a different user runs normally (keys are per user).
- A second request while the first is still `pending` (insert the pending row by hand) → 409 with `retry_after` 1 and a `Retry-After: 1` header.
- A `pending` row older than 60 s is taken over: the handler runs and the reply is stored.
- A `done` row older than 24 hours is ignored: the handler runs again.
- A handler that throws `ApiFailure("insufficient_credits", ...)` (402): the row is deleted, and the same request again runs the handler.
- A handler that throws a plain `Error` (500): row deleted. One that returns 403: row deleted.
- A handler that returns 400, 404 and 409: stored and replayed.
- A handler that returns `c.text("ok")`: not stored (row deleted).
- A JSON reply over 16,384 bytes: not stored (row deleted); exactly 16,384 bytes: stored.
- A missing or 15-character key → 400 `bad_request`.
- The stored `request_hash` is 64 lowercase hex characters, and no column holds the request body (send a body with a marker string and check that no column of the row contains it).
- If the D1 update fails (wrap the test DB so `UPDATE` throws), the handler's reply is still returned.

Not in this PR: adding the middleware to any route, the cleanup cron (PR 33), storing replies for content endpoints (never).

### PR 12 · `POST /v1/tasks/quote`

Branch `pr/12-quote`. No new dependencies (`@waypoint/contracts`, `@waypoint/pricing` and `@waypoint/ledger` are already in `apps/api`). Files: `apps/api/src/errors.ts`, `apps/api/src/tasks/quote.ts`, `apps/api/src/app.ts` (one import and one line), `apps/api/test/quote.test.ts`, `apps/api/test/app.test.ts` (new tests only). No other files.

`src/errors.ts`: add

```ts
export class InsufficientCredits extends ApiFailure {
  constructor(readonly shortfall: number) {
    super("insufficient_credits", "not enough credits");
  }
}
```

and in `handleError`, an `InsufficientCredits` reply is the usual 402 body plus `shortfall` (it must pass `InsufficientCreditsErrorSchema`). Check `InsufficientCredits` before the plain `ApiFailure` branch.

`src/tasks/quote.ts`: `export const quoteRoute = new Hono<AppEnv>().post("/v1/tasks/quote", handler)`. The handler, in order:
1. Read the body with `c.req.json()`. Bad JSON, or a body `QuoteRequestSchema.safeParse` rejects → `ApiFailure("bad_request", "invalid request")`. Do not echo the body or zod's messages.
2. `loadConfig(c.env.CONFIG)`; a `ConfigError` → `ApiFailure("internal", "config unavailable")`, anything else is rethrown (same as `src/config/route.ts`).
3. `credits = quoteCredits(config.prices, request)`; if it throws → `ApiFailure("bad_request", "invalid request")`.
4. Read the wallet: `c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id)).read()`.
5. `const short = shortfall(view, credits)` (from `@waypoint/ledger`). If `short > 0`, throw `new InsufficientCredits(short)`.
6. Reply 200 with a `QuoteResponse`: `{ credits, price_table: config.prices.version, retention: user.zero_retention ? "zero" : "standard", balance_after: view.monthly + view.purchased - credits, expires_in: 300 }`.

The quote is read-only: it does not hold credits, write to D1 or use the PR 11 store. The global Idempotency-Key header check still applies because it is a `POST`.

`src/app.ts`: `app.route("/", quoteRoute);` under "Routes go below this line", after the config route.

Tests (`test/quote.test.ts`), with the fresh app above and `quoteRoute` mounted. `env.CONFIG` is a small `Map`-backed stub holding a full good config built from `PRICE_TABLE_2026_11_16_2` and `DEFAULT_ROUTES` (and `config:current`, router, flags, min-native, voice pack values that pass the schemas). `env.WALLET` is a stub `{ idFromName: (name: string) => name, get: (id: string) => ({ read: async () => view }) }` that records the name it was given. Cases:
- `explain` with monthly 10 → 200, credits 1, `balance_after` 9, `price_table` `"2026-11-16.2"`, `retention` `"standard"`, `expires_in` 300; the body passes `QuoteResponseSchema`; the wallet was looked up by the user's `billing_account_id`.
- `overview_script` with `fallback_voice: true` → 42; `retranscribe` with `minutes: 4` → 4; `research` with `depth: "deep"` → 125.
- A user with `zero_retention: true` → `retention: "zero"`.
- Monthly 1 and purchased 2, `more_detail` (3) → 200 with `balance_after` 0.
- Purchased 3 and owed 7, `double_check` (4) → 402 with `shortfall` 8; the body passes `InsufficientCreditsErrorSchema`.
- Monthly 50 and owed 90, `explain` → 200 (owed does not block a quote that fits).
- Bad JSON → 400; `{ "task": "nope" }` → 400; `research` without `depth` → 400; `fallback_voice: true` on `explain` → 400; extra key → 400. None of the 400 bodies contain the request text.
- `config:current` missing → 500 `internal` "config unavailable".

`test/app.test.ts` (add, change nothing else): a route throwing `new InsufficientCredits(5)` gives 402 with `shortfall` 5 passing `InsufficientCreditsErrorSchema`; through `createApp`, `POST /v1/tasks/quote` with no `Authorization` header gives 401 (the route is behind the session check).

Not in this PR: holding credits, the router call, quotes for `read_link` (no price yet).

## Security (S0 to S4)

The product owner decided on 19 Nov 2026 to build the end-to-end encryption and device signatures now, with only well-known algorithms and the platform's own crypto, and to have the design reviewed by an outside security reviewer **before real students use the app**. The design is `docs/security.md`; the items for the reviewer are its section 17 (R1 to R14). The full cards are in `docs/cards/security.md`.

| Card | Title | Full card |
|---|---|---|
| S0A | `packages/crypto`: bytes, contexts, keys, HPKE | `docs/cards/security.md` |
| S0B | `packages/crypto`: Waypoint formats and published test vectors | `docs/cards/security.md` |
| S1A | Migration `0005_security.sql`, `BatchDb`, the device signature check | `docs/cards/security.md` |
| S1B | `POST /v1/devices`, `GET /v1/devices` | `docs/cards/security.md` |
| S1C | Pairing with the 6-digit code, and approval | `docs/cards/security.md` |
| S1D | `DELETE /v1/devices/:id` (account key rotation, key version bump) | `docs/cards/security.md` |
| S1E | Device signatures on the paid routes merged before S1A (explain, more detail, double-check, Apple purchases) | `docs/cards/security.md` |
| S1F | Push notices for device pairing; deleting a removed device's push token | `docs/cards/security.md` (outline; written in full after S1D) |
| S2 | Group key envelopes and `POST /v1/groups/:id/keys` | `docs/cards/security.md` |
| S3 | `PUT /v1/recovery`, `GET /v1/recovery` | `docs/cards/security.md` |
| S4 | Sealing job results to one device | `docs/cards/security.md` |

## Mobile and web (separate track)

The iPhone app is built with Expo (SDK 58). Setup, the stage 1 cards in full and an outline of stages 2 to 4 are in `docs/cards/mobile.md`. Builds and device checks need Xcode 27.2, which needs macOS Tahoe 26.6 or later on the build Mac (section 0 of that file); Node-testable parts can be built before that.

| Card | Title | Full card |
|---|---|---|
| M1a | App shell: Expo app, routes, tabs, theme | `docs/cards/mobile.md` |
| M1b | Sign-in with Clerk | `docs/cards/mobile.md` |
| M4 | Device SQLite: schema, migrations, spaces, settings | `docs/cards/mobile.md` |
| M5 to M9b | Native modules (audio, speech, pages, on-device model, search index) and the search screen | `docs/cards/mobile.md` |
| M10a to M12 | Capture, Study and Settings screens | `docs/cards/mobile.md` |
| M3, M13 to M21, M26, M27a | Stage 2: API client, device keys and registering this iPhone, config, purchases, plans, Explain, questions for later, second transcript, research, push, activity | outline in `docs/cards/mobile.md`; to be written |
| M22 to M25 | Stage 3: voices and overviews | outline in `docs/cards/mobile.md`; to be written |
| M27b to M32, M2 | Stage 4: more devices and recovery, sync, sharing, Zephyr, system targets | outline in `docs/cards/mobile.md`; to be written |
| V1 | `apps/viewer`: shared-link viewer that unlocks in the browser | to be written |

## Model choice (flow 8)

| PR | Title |
|---|---|
| E1 | `tools/model-eval`: run a task on candidate models, grade with Clef, write a report. Test set from public material only. |

## Build order

Written 19 Nov 2026, when the four card files were reconciled. A batch is a set of cards that touch different files, or only add lines to the shared files listed below, so they can be built at the same time. A card starts as soon as the cards in its "after" column are merged; it does not wait for its whole batch. Within a batch, merge in the order given. The mobile track touches only `apps/mobile/` (and `package-lock.json`), so it runs beside every server batch.

| Batch | Cards (after) | Merge order |
|---|---|---|
| 0, being built | PR 13, PR 16, PR 19, S0A, M1a | PR 16, PR 19, PR 13, S0A, M1a |
| 1 | PR 14 A+B (13), PR 17 A+B, PR 31 A+B, PR 32, S0B (S0A); M1b, M4 (M1a) | PR 32, PR 14, PR 17, PR 31, S0B; M1b, M4 |
| 2 | PR 15 (14), PR 18 (17), S1A (S0B); M5, M7, M8, M9a (M4), M10a (M1b, M4) | PR 15, PR 18, S1A |
| 3 | S1B (S1A), S4 (S1A), S1E (S1A, 14, 15, 17), PR 33 A+B (14, 17, 31, S1A); M6 (M5), M9b (M9a), M10c (M7, M10a) | S4, S1B, S1E, PR 33 |
| 4 | S1C (S1B), S3 (S1B); M10b (M6, M10a), M11a (M8, M10c) | S1C, S3 |
| 5 | S1D (S1C), S2 (S1C); M11b (M11a), M12 (M10b, M11a, M9a) | S1D, S2 |
| 6, cards to write first | S1F (S1D, 31); PR 20 (S1A, S4, 33); PR 27 (S1A); mobile stage 2 (below) | in the order written |
| 7 and on | PR 21 (20); PR 22 to 25 (20, S4); PR 28 (27, S2); PR 29 (27, 33); PR 30 (27, 29); PR 26 (price decided); V1 (30); E1 any time | |

Mobile stage 2, once its server cards are merged: M3 (contracts from PR 14, 16, 17, 31, 32 and S1B; runs in Node, no Xcode), M13, M26 (Swift `Core` tested with `swift test`, no Xcode), M27a (M26, M3, S1B), then M14 (M27a, PR 17, S1E), M15, M16 (M27a, PR 15), M17, M20 (M27a, PR 31), M21 (PR 32), M18 and M19 (PR 20, 23, 24). Stages 3 and 4 follow their server cards (PR 22, 25; S1C, S1D, S2, S3, PR 27 to 30).

**Xcode.** Every mobile card can be written, type-checked, tested in Node (`src/core`, `packages/api-client`), bundled (`npm run export:ios`) and have its Swift `Core` tested with `swift test` on the current Mac. The "Device check" steps need macOS Tahoe 26.6 or later and Xcode 27.2 (`docs/cards/mobile.md`, section 0); until then a card is merged with them marked "not run: no Xcode yet", and they are run on the iPhone once Xcode is in place, in card order.

### Shared files: what each card adds, and how merges are resolved

- **`apps/api/src/app.ts`.** Route lines go at the end of the list under "Routes go below this line"; their order does not matter (no two routes share a method and path). Middleware lines only above that line, and only S1E adds one. Keep every card's import and line.
- **`apps/api/src/env.ts`.** One line per binding or var. Names in use: `DB`, `CONFIG`, `WALLET`, `GROUP_ROOM`, `CLERK_ISSUER`, `CLERK_AUTHORIZED_PARTIES` (merged); `AI`, `AI_GATEWAY_ID` (PR 13); `USAGE_QUEUE` (PR 14); `CLERK_WEBHOOK_SIGNING_SECRET` (PR 19); `APPLE_BUNDLE_ID`, `APPLE_ENVIRONMENTS` (PR 17); `APPLE_APP_APPLE_ID` (PR 18); `PUSH_QUEUE`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_PRIVATE_KEY` (PR 31); `ANALYTICS`, `BUCKET` (PR 33). S1A changes only `Variables` (adds `device`).
- **`apps/api/wrangler.jsonc`.** One block per key, never two. `vars` is one line until PR 17 makes it multi-line (keeping PR 13's `AI_GATEWAY_ID`); later cards add lines to it. `queues` is created by PR 14 (usage producer); PR 31 adds the push producer and consumer; PR 33 adds the usage consumer. `ai` (PR 13), `analytics_engine_datasets`, `r2_buckets`, `triggers` (PR 33) appear once each.
- **`apps/api/src/index.ts`.** Until PR 31 it is `export default createApp(...)`. PR 31 makes it `export default { fetch, queue } satisfies ExportedHandler<Env>`, PR 33 adds `scheduled`. Keep the `export { GroupRoom }` and `export { Wallet }` lines; later cards add Durable Object and Workflow class exports and `queue` branches, and never go back to the old shape. No card before PR 31 edits this file.
- **`packages/contracts/src/index.ts`.** One `export * from` line per new file: `instant.ts` (PR 14), `wallet.ts` (PR 16), `purchases.ts` (PR 17), `push.ts` (PR 31), `privacy.ts` (PR 32), `keys.ts` (S1B; S1C, S1D, S2 and S3 append to that file in merge order). No two files export the same name (checked).
- **D1 migrations and `db/d1/test/schema.test.mjs`.** Numbers are fixed:

  | File | Card |
  |---|---|
  | `0001_directory.sql` | PR 04 (merged) |
  | `0002_idempotency.sql` | PR 11 (merged) |
  | `0003_push_tokens.sql` | PR 31 |
  | `0004_apple_notifications.sql` | PR 18 |
  | `0005_security.sql` | S1A |
  | `0006` on | the next free number when the card is written, in build order |

  PR 31 renames the table-count test to "creates exactly the expected tables" and removes its fixed count; every migration card after it only adds its tables to `EXPECTED` and `EXPECTED_TYPES`.
- **`package-lock.json`.** S0A, M1a, S1A and the mobile cards that add packages all change it. Merge one, then for the next take `main`'s lockfile, run `npm install` and commit the result. Never hand-merge the lockfile. M1a's root `overrides` must survive every such merge.
- **Test helpers.** One copy each, reused, never redefined: `test/helpers/d1.ts` and `sql.ts` (PR 06; S1A adds `batch`), `test/helpers/tasks.ts` (PR 14), `test/helpers/apple.ts` (PR 17), `test/helpers/signing.ts` (S1A).

### Decisions made while reconciling the card sets (19 Nov 2026)

1. **Usage events.** One shape, `UsageEvent` in `apps/api/src/usage.ts` (PR 14): `v`, `id` (the hold id), `at`, `user_id`, `task` (instant task or job type), `outcome`, `credits`, `tier`, `model`, `retention`, `router`, `bytes_sent`, `tokens_in`, `tokens_out`. Queue binding `USAGE_QUEUE` → `waypoint-usage`. PR 33 checks each message with a zod schema tied to the type with `satisfies` (and a test in the other direction), lives in a new file `src/usage-consumer.ts`, writes `activity` with `route` = `tier`, and writes Analytics Engine through the binding `ANALYTICS`.
2. **R2.** PR 33 adds the only R2 binding, `BUCKET` (bucket `waypoint`). S4, PR 20, 23, 29, 30 use it.
3. **Migrations** as in the table above.
4. **`src/index.ts`** as above; no card assumed the old shape after PR 31.
5. **Device signatures.** S0A → S0B → S1A run early, beside batch 1 and 2. Routes written after S1A put `requireDeviceSignature` on the route (S1A rule). The four paid routes merged before it (PR 14, 15, 17) get it from one follow-up card, S1E, in `createApp`, without changing their files or tests. **Consequence: from S1E on, a paid task or a purchase needs a registered, approved device (S1B).** The app registers its first device right after sign-in, so the mobile device-keys card (M26) and first-device registration (M27a) moved from stage 4 to stage 2.
6. **Jobs and sealing:** rules for PR 20 to 25 are in the next section.
7. **Push.** `push_tokens.device_id` is the device's `devices.id`. Pairing pushes and deleting a removed device's token are S1F (S1B and S1C had said PR 31 would do it; PR 31 said their own cards would).
8. **Zero retention.** PR 32 lets a Plus user turn it on although no zero-retention route exists; until one is in KV, that user gets 403 for every cloud task (PR 14 decision 3). Written plainly in `docs/architecture.md` sections 4 and 6 and in the PR 32 and M21 cards.
9. **Request nonces** are deleted by PR 33's hourly cron (S1A said so; PR 33 did not), so PR 33 runs after S1A.
10. **Smaller fixes:** PR 17's `vars` block keeps `AI_GATEWAY_ID`; placeholder bundle id `app.waypoint.ios` everywhere; S3 after S1B so `keys.ts` is created once; Worker secrets instead of Secrets Store in the architecture table; new endpoints and tables listed in `docs/architecture.md` sections 4 and 5; account deletion's effect on devices, push tokens and groups written down (cleanup still open).

## Conventions for the cards still to write

For PR 20 to 30, S1F and the mobile stage 2 to 4 cards. They come on top of `AGENTS.md`, the wave 2 rules and the wave 3 notes.

- **Bindings and names.** Use the names in "Shared files" above. R2 is `BUCKET`, with keys from `docs/architecture.md` section 5 (`results/{job}`, `tmp/audio/{job}`, `groups/{group}/...`, `links/{link}/data`). A Workflow binding is `<NAME>_WORKFLOW` (for example `OVERVIEW_WORKFLOW`), its class is exported from `src/index.ts`, and its logic lives in a plain module tested in Node; the Workflow class stays thin and tests never import it (the Durable Object rule).
- **Money.** Quote, hold, run, settle at the real cost, never above the quote. A hold made by a request has the command id `<op>:<user id>:<Idempotency-Key>`, `op` at most 24 characters (for example `job:`, `job_settle:`, `job_release:`; a workflow that settles later stores what it needs to rebuild the ids). `expires_at` is now + the task's time limit + `HOLD_MARGIN_MS`; work stops if the hold is gone. Shortfall → `InsufficientCredits`; `hold_closed` → 409 "request already finished". Release on failure. Write the settle result's `charged` into `jobs.spent` and the usage event.
- **Zero retention.** Pick the route before any work starts. A zero-retention user with no zero-retention route for the job gets 403 `forbidden` "no zero-retention route for this task", with the hold released and no model called (as PR 14).
- **Usage events.** One `UsageEvent` per finished task or job, after settle or release, through `sendUsage(env.USAGE_QUEUE, ...)`. `id` is the hold id; `task` is the job type from `JOB_TYPES` (`research`, not `research_deep`); `tier` and `model` are those of the model that wrote the result; token counts are summed over all model calls (null if none reported); `bytes_sent` is the UTF-8 bytes of the text sent, or for `retranscribe` the audio bytes uploaded. `retranscribe` uses no tiered model: it sends `tier: "light"`, `model` the Whisper id, `router: "skipped"`. Never write `activity` directly; never put text in the event.
- **Device signatures.** On the route, `requireDeviceSignature(deps)` before `idempotent(deps)`: `POST /v1/jobs`, `DELETE /v1/jobs/:id`, `POST /v1/tasks/read-link` (PR 26), PR 27's `POST /v1/groups`, `POST /v1/groups/:id/invites`, `POST /v1/invites/:token/accept`, `DELETE /v1/groups/:id/members/:user`, PR 30's `POST /v1/links` and `DELETE /v1/links/:id`, and any other write that changes keys, devices, membership or money. `GET` routes need only the session. Tests use `test/helpers/signing.ts`.
- **Idempotency.** Every write already needs the header. Writes whose replies hold no note content add `idempotent(deps)` (jobs created and cancelled, groups, invites, links, blobs). Replies with content (a job's result, read-link) are never stored; their hold protects them.
- **Jobs and sealing (PR 20 to 25, S4).** PR 20 writes `jobs.device_id` from `c.get("device").id` and serves `GET /v1/jobs/:id/result` as `application/octet-stream`, only to the job's user. PR 22 to 25 call `sealJobResult({ db: env.DB, bucket: env.BUCKET }, ...)` inside the one Workflow step that generates the result and return only `result_key` from that step: plaintext never goes into a step's return value, a queue, a log, D1, KV or Analytics Engine. A finished job sends `{ user_id, kind: "job_ready", ref: <job id>, device_id: jobs.device_id }` to `PUSH_QUEUE`. PR 33's cron deletes `results/` after 7 days and `tmp/audio/` after 24 hours.
- **Groups, sync, links (PR 27 to 30).** `docs/security.md` section 15: PR 27 bumps `key_version` in the same D1 batch that ends a membership and stores `name_locked` as opaque base64url; PR 28 refuses a change with an old key version (409) and sends `kind: "sync"` pushes; PR 30 stores peppered passcode hashes (`LINK_PASSCODE_PEPPER`, a Worker secret).
- **Migrations.** The next free number when the card is written, recorded in the table above; add the tables to the schema test's `EXPECTED` and `EXPECTED_TYPES` (no table count) and to `docs/architecture.md` section 5.
- **Contracts.** One new file per card in `packages/contracts/src/` with one `export *` line; check the names do not clash.
- **Placement.** Each new card says what it builds on and is added to the "Build order" table when it is written.

## Owner setup

Everything the cards need from the owner, in one list. Ids and placeholders are not secrets; secrets go only through `wrangler secret put`.

**Build Mac and Apple developer account**
- Upgrade macOS to Tahoe 26.6 or later, install Xcode 27.2, the iOS 27 simulator runtime and CocoaPods; turn on Developer Mode on the iPhone (`docs/cards/mobile.md`, section 0).
- A paid Apple Developer team (Sign in with Apple needs it); note the Team ID.
- Choose the bundle id and put it in `apps/mobile/app.json`, `APPLE_BUNDLE_ID` and `APNS_TOPIC` (all three hold the placeholder `app.waypoint.ios`) and in Clerk's native app settings.
- An APNs auth key (`.p8`): its key id into `APNS_KEY_ID`, the team id into `APNS_TEAM_ID`, the key itself with `npx wrangler secret put APNS_PRIVATE_KEY < AuthKey_<KEY ID>.p8`.

**App Store Connect**
- The app record; its numeric Apple id into `APPLE_APP_APPLE_ID` (production notices are refused until then).
- Six products with exactly these ids: `waypoint.own_it` (non-consumable), `waypoint.plus.monthly` and `waypoint.plus.yearly` (one subscription group), `waypoint.credits.1000`, `.5000`, `.20000` (consumable).
- App Store Server Notifications **Version 2**, production and sandbox URL `https://<api host>/webhooks/apple`.

**Clerk**
- An instance with email code and Apple sign-in; the iOS app registered for native Sign in with Apple (Team ID, bundle id); the publishable key in `apps/mobile/.env.local` as `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`.
- The issuer URL into `CLERK_ISSUER`, the authorized parties into `CLERK_AUTHORIZED_PARTIES`.
- A webhook to `https://<api host>/webhooks/clerk` subscribed to `user.created` and `user.deleted` only; its signing secret with `wrangler secret put CLERK_WEBHOOK_SIGNING_SECRET`.
- Terms and Privacy URLs for the Welcome screen.

**Cloudflare**
- D1 database `waypoint` and KV namespace: real ids into `wrangler.jsonc`; apply the migrations with `wrangler d1 migrations apply`.
- KV config: `config:current`, prices, routes (Workers AI ids such as `@cf/...`, not the test placeholders), `config:router` with the real Clef-flash model id, flags, min native version, voice pack.
- Workers AI on the account; an AI Gateway named `waypoint` with log collection off and per-account rate limits.
- Queues `waypoint-usage` and `waypoint-push`; R2 bucket `waypoint`; Analytics Engine dataset `waypoint_usage` (created on first write). Durable Objects and the hourly cron come from `wrangler.jsonc`.
- Later cards: `LINK_PASSCODE_PEPPER` (PR 30), Turnstile (PR 30), a search API key (PR 24), and probably an R2 API token for signed upload and download URLs (PR 23, 29; decided when those cards are written).
- Zephyr Cloud for over-the-air bundles (M2, stage 4).

**Security review**
- Engage an outside security reviewer for `docs/security.md` (items R1 to R14 in section 17) before real students use the app.

## Open questions

Collected from the four card files and their planning pull requests (#19 to #22), without repeats. Numbered so pull requests can refer to them.

**Product and prices**
1. **Zero retention at launch.** A Plus user can turn it on, and then every cloud task gets 403 until a zero-retention route is in KV. Keep that (the app explains it), or hide the switch until a route exists? Which models may be marked zero-retention?
2. **Cost against price.** If the router fails or says "unsure", explain runs on the strong tier for 1 credit (about 4 credits of cost at 500 tokens); double-check costs more than its 4 credits. Flow 8 should set the prices or the token caps.
3. **Clef-flash:** its reply format and model id are not documented; confirm on staging, with the streaming format, that `AbortSignal` stops a stalled stream, and that every answer model accepts `enable_thinking: false`.
4. **`unsafe`** from the router is recorded nowhere and changes nothing. What should happen?
5. **Read-link price** (PR 26 waits for it).
6. **Phones without Apple Intelligence:** offer flashcards, quiz and help in the cloud for credits later?

**Accounts and money**
7. **Account deletion.** Groups the user created, their room data and R2 objects are not cleaned up, and a late session token can recreate a deleted user's row (without starter credits). Needs a cleanup card; also decide whether removing a deleted user from shared groups bumps the key version.
8. **Sandbox purchases on production** (needed for App Review; gives TestFlight testers free credits), or a separate staging Worker?
9. **`REFUND_REVERSED`:** grant the credits or Plus again?
10. **Expiry and Plus refunds reset monthly credits to 0.** Confirm.
11. **Family Sharing:** the account matching assumes each member has their own `originalTransactionId`.
12. **No OCSP check** on Apple's certificates (as Apple's library with online checks off).
13. **A result that cannot be sealed** because its device was removed mid-job: refund the credits?

**Push**
14. **APNs from a production Worker** over HTTP/2 is confirmed only by a workerd maintainer and community clients; fallbacks are listed in PR 31's card.
15. **APNs provider token** shared across isolates by a 30-minute `iat` step; if APNs still refuses, keep it in a Durable Object.
16. **Push copy** needs review.
17. **Should `POST /v1/push-tokens` refuse a `device_id`** that is not an approved device of the user?

**Security** (also for the outside reviewer, `docs/security.md` section 17)
18. **Removing a device does not revoke its Clerk session** (R13); that needs a session id per device and a Clerk API call.
19. **Account reset** for a user with no device and no recovery key (old data becomes unreadable); not built.
20. **Encryption at rest on the phone:** SQLCipher, or iOS data protection only?

**App**
21. **Upgrade the build Mac to macOS Tahoe** now (needed for any iOS build with SDK 58)?
22. **Sign-in before the free on-device features**, or only for credits, sync and sharing (fewer barriers, no account for under-13s unless needed)?
23. **VisionKit's document camera** instead of the custom camera drawn on T2?
24. **Transcript language** per space or per recording?
25. **"Help me with a problem":** steps first, answer last for everyone?
26. **Background transcription on iOS 27:** if it stops while the screen is locked, is a transcript written after the recording acceptable?
