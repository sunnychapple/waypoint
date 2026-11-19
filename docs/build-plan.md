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
| 19 | `POST /webhooks/clerk`, and the 25 starter credits for a new account |
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

Notes the wave 3 cards must carry (from the wave 1 follow-up review):

- **PR 11:** store a hash of method, path and body with each key; the same key with another body is 409 `conflict`. Store every final response except a 402, so buy and retry works (D5). Wallet command ids are `<op>:<user_id>:<key>`, with `op` at most 24 characters.
- **PR 12:** the 402 shortfall is the ledger's `shortfall(wallet.read(), credits)`. When it is 0, `balance_after` is monthly + purchased − credits.
- **PR 14, 15, 20:** a hold result of `hold_closed` is 409 `conflict` ("request already finished"); never run a task without an ok hold. `expires_at` is now + the task's time limit + a margin (D3). Write the settle result's `charged` into `jobs.spent` and the usage event.
- **PR 16:** `GET /v1/wallet/ledger` returns the ledger rows and the open hold ids. What each task cost comes from `activity` and `jobs.spent`, not from adding up ledger rows.
- **PR 18:** a refunded or revoked Plus month is `reset { id: "apple:<notification uuid>", credits: 0, resets_at: now }`, never a clawback. A credit pack or Own it refund is a `clawback` of that purchase's credits. A renewal is `reset { credits: 2000, resets_at: <next period> }`.
- **The first card that writes `activity`:** `task` comes from the typed task list, never from request text.

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
