# Hardening 4 (Fable phase reviews): H9 to H17

These cards come from six whole-phase reviews by Fable (batches 0–1, 2, 3–4, 5, 6–7 and 8–9). Each review read an older snapshot of `main`. This round also covers the Sonnet notes that were still open after hardening 2 (M25c #119, M23 #116, M28b #121, M24a #120, M24b #123, M29a #122 and the M29a design gaps). Every finding was checked against `main` at `ac25265` (after M30b) by reading the code. The reviewers' line numbers were not trusted. Where it was cheap, a test was run on a copy of `main`. Findings already judged in `docs/cards/hardening-1.md`, `hardening-2-account-cert.md` and `hardening-2.md` are not judged again; the table points to them.

Owner's rule for this round: fix what is real and skip over-engineering. Every skip has its reason in the table. A finding that is a product or policy choice is an **OWNER QUESTION**, with a recommended default, and is added to "Open questions" in `docs/build-plan.md`.

Refs: `b01#1` is Fable's review of batches 0–1, item 1. The other refs are `b2`, `b3` (batches 3–4), `b5`, `b67` (batches 6–7) and `b89` (batches 8–9). The Sonnet notes are referred to by card and PR.

## Verdicts

### Fable, batches 0–1 (b01)

| Ref | Finding | Verdict | What happens, or why not |
|---|---|---|---|
| b01#1 | One device database (`waypoint.db`) for everyone. A second person who signs in on the same phone sees the first person's notes, and could move them into a space of their own that syncs or is shared | **OWNER QUESTION** | Still true: `platform/db.ts` opens one file and `useSignOut` keeps it (board K1: "Signing out doesn't delete your notes."). Shared family iPads are likely for this audience (`docs/security.md` R14). Open question 52. Recommended default: one database per Clerk user (`waypoint-<clerk user id>.db`), opened after sign-in and closed on sign-out, so each person sees only their own notes and nothing is deleted. That is a design card, not a hardening fix. |
| b01#2 | The first migration runs inside a screen render | SKIP | A migration that throws leaves the app unusable whichever screen catches it. An error screen would change only the message. Migrations are covered by `migrate.test.ts`. |
| b01#3 | A late retry of an old zero-retention `PUT` replays a stale value | SKIP | The app disables the switch while a change is in flight (`CloudScreen.tsx`, `disabled={… \|\| busy}`), so it never sends a new value while an older one is still retrying. Dropping `idempotent()` would not fix a first delivery that arrives out of order either. |
| b01#4 | Only the `change` locked-content context has a vector | SKIP | The `context` encoding and the locked-content format are both vectored (`waypoint-v1.json`, `context` and `content`) and checked in TypeScript and Swift. Snapshot, blob, group name and link differ only in their label and fields, which match `docs/security.md` section 11 in `GroupOps.swift` (link), `apps/viewer/src/main.ts`, `platform/sync.ts` and `platform/groups.ts`. One vector per label would only repeat strings. |
| b01#5 | A late `user.created` after `user.deleted` grants 25 credits again | DUPLICATE | `hardening-1.md`, PR 19 #25 (SKIP, reason there). |
| b01#6 | Push `ref` allows 48 characters, ids allow 64 | DUPLICATE | Open question 33. |
| b01#7 | `signed_in_before` is cleared only on sign-out; the gate can drop from the app to sign-in mid-use | SKIP | The gate follows its rule: once Clerk has loaded and says signed out, the person is signed out. The harm was the record screen unmounting with the microphone on, which H13 fixes (b3#6). |
| b01#8 | The zero-retention switch needs only a session, so a stolen session (or one left on a removed device, R13) can turn it off | **FIX** | H12: the `PUT` is signed by an approved device. `docs/security.md` section 15 and architecture section 4 are updated in this pull request. |
| b01#9 | `HEAD /v1/config` gets 401 | SKIP | Nothing sends `HEAD`; the app uses `GET`. |
| b01#10 | `app.json` has `supportsTablet: false`, but `docs/security.md` says "on iPhone and iPad" | **FIX** (docs) | Done in this pull request: security.md section 1 now says what the build does. Whether to build a native iPad layout is a product choice for later. |

### Fable, batch 2 (b2)

| Ref | Finding | Verdict | What happens, or why not |
|---|---|---|---|
| b2#1 | When the app drops an explain or more-detail stream, workerd stops the request: no settle, no usage event, the hold stays open until its alarm (same key 409 for minutes), and the answer is free | **FIX** | H9, part 1: the read and the settle run under `executionCtx.waitUntil`. A dropped answer that produced text is charged, as the app already assumes (`hardening-2.md`, M16 row: "an aborted stream, which the server still charges"). |
| b2#2 | Someone who deletes their account and signs up again can never restore Own it or a running Plus (409 "purchase belongs to another account") | **OWNER QUESTION** | Part of open question 7 (account deletion), extended in this pull request. Recommended default: on `user.deleted`, release that billing account's Own it and Plus purchase rows, so a later account can claim them once. The entitlement only: no credits and no monthly reset. Packs stay with the deleted account. |
| b2#3 | Interrupted sessions are never indexed for search | **FIX** | H15. |
| b2#4 | The vector cache keeps each chunk's space, so a moved session is searched in its old space | **FIX** | H15: the space is read when the search runs, not cached. |
| b2#5 | A failed settle still sends `done`; the read loop has no deadline of its own | SKIP (settle), DUPLICATE (deadline) | If the settle fails, the hold stays open and the wallet's alarm releases it, so `done` with `credits: 0` is true. Whether the `AbortSignal` stops a stalled stream is open question 3 (a staging check). With H9, a stream that stalls after the app leaves runs at most about 30 s more (the `waitUntil` limit), and the alarm still releases the hold. |
| b2#6 | Every routing failure becomes 403 "no zero-retention route" | SKIP | It cannot happen to anyone else. `RouteTableSchema` requires at least one entry per tier, and `routeTask` always passes answers, so `decideRoute` fails only for zero retention. |

### Fable, batches 3–4 (b3)

| Ref | Finding | Verdict | What happens, or why not |
|---|---|---|---|
| b3#1 | A refund of an **earlier** Plus period after a renewal zeroes the monthly credits, ends Plus and drops the plan to free while the later period is active | **FIX** | H10, part 1. The earlier Plus-refund fix handles only the current period. H10's test fails on `main`. |
| b3#2 | Text written while the indexer is embedding is never indexed (the guard compares `indexed_at`, which is already `NULL`) | **FIX** | H15. |
| b3#3 | Interrupted sessions not indexed | DUPLICATE | b2#3. |
| b3#4 | Native `stop()` resolves before the analyzer has sent its last final words, so the app has removed its listeners and the last words are lost | **FIX** | H14 (native, device check). |
| b3#5 | `recoverSessions` runs only when the speech pack is installed, so a recording cut off by a crash stays "recording" and hidden for ever on an iPhone without the pack | **FIX** | H13, part 3. |
| b3#6 | A gate flip during a recording unmounts the record screen; the microphone keeps running with nothing to stop it | **FIX** | H13, part 4: the screen stops and saves the recording when it goes away. |
| b3#7 | Audio, page photos and the SQLite file live in Documents, so they go into iCloud and Finder backups, while architecture section 1 says notes are readable only on the device | **OWNER QUESTION** | Open question 53. Recommended default: keep them in the iPhone backup, because without sync that is the only way notes survive a new phone. Apple encrypts the backup, end to end with Advanced Data Protection. Correct architecture section 1 to say so. The other choice (Application Support, excluded from backup) loses every note when a phone is replaced. |
| b3#8 | Plus ends only when an Apple notice says so; a missed `EXPIRED` leaves Plus for ever | SKIP | No credits leak: yearly top-ups stop after month 11 (`apple/allowance.ts`), and monthly needs `DID_RENEW`. Only the plan label and the zero-retention switch would stay, and Apple retries a notice for 3 days. Revisit if the logs ever show a missed notice. |
| b3#9 | The yearly top-up cron calls the wallet once per yearly row every hour | SKIP | After a month's reset each call is a no-op with a fixed id. It is fine until about a thousand yearly subscribers, the subrequest limit of one scheduled run. Store the last topped-up month when it gets near that. |
| b3#10 | Waiting devices whose pairing expired are never removed: they pile up in Settings › Devices (each "Start again" registers a new id), and a stolen session can add hundreds a day | **FIX** | H10, part 3: the hourly cleanup removes a device that has waited more than a day with no live pairing. |
| b3#11 | Docs: architecture section 1 lists queues for notices and cleanup; `supportsTablet`; activity rows for failed tasks | **FIX** (docs) | Done in this pull request: the Queues row, the activity rule in architecture section 4, and security.md section 1 (b01#10). |

### Fable, batch 5 (b5)

| Ref | Finding | Verdict | What happens, or why not |
|---|---|---|---|
| b5#1 | Two devices removing each other leave no device and no recovery blob | ALREADY FIXED | H2: `UNCHANGED_SQL` in `devices/remove.ts`. Test: "two devices removing each other at once: one gets 200, the other 409, …" (`apps/api/test/remove-device.test.ts`). |
| b5#2 | Approval and `PUT /v1/recovery` check, then write: an approval or a recovery blob that lands after a removal replaced the account key is kept under a dead key | **FIX** | H11, parts 1 and 2. |
| b5#3 | A device that removes itself while others remain makes the new account key, so it still holds the current account key | SKIP (docs) | Only a modified app keeps it. `removeDevice` deletes the whole Keychain item (account key included) right after the removal, and a crash in between is cleaned up at the next launch (`start_over`). Refusing self-removal would break "Remove this iPhone" whenever another device exists. `docs/security.md` section 12 now says that in this case the removal relies on the app deleting its keys. |
| b5#4 | `cancelJob` calls `stop()` before the release. A cancel just after the settle terminates the Workflow before it records the result, so the job is charged and stuck | **FIX** | H9, part 3. |
| b5#5 | Interrupted sessions not indexed | DUPLICATE | b2#3. |
| b5#6 | `recoverSessions` behind the pack check | DUPLICATE | b3#5. |
| b5#7 | The session screen shows no transcript and cannot play the recording | ALREADY FIXED (transcript); **OWNER QUESTION** (playback) | `SessionScreen.tsx` lists the transcript lines (M15) and the second transcript (M18). Playback of a recording has no card at all: open question 54. Recommended default: a small card that plays the recording from the session screen with `expo-audio` (already in the app), where tapping a line jumps to it. |
| b5#8 | Key routes ignore `ends_at` | DUPLICATE | b67#5. |
| b5#9 | A retried self-removal gets 401, not the stored reply | SKIP | The signature check runs before the idempotency store, by design (security.md section 15). It needs a lost reply. The next refresh then finds the iPhone gone and starts over, which is what the person asked for. |
| b5#10 | Two first devices racing: the loser gets 409 "device id taken", not "account key already set" | SKIP | After H13 the app decides from `GET /v1/devices`, not from the message. |
| b5#11 | Docs: `supportsTablet`; security.md "not yet in architecture section 4" | **FIX** (docs) | Done in this pull request (security.md sections 1 and 15). |
| b5#12 | Dev routes open in release builds | ALREADY FIXED | `src/app/_layout.tsx`: `<Stack.Protected guard={__DEV__ && gate === "app"}>` (H5c). |

### Fable, batches 6–7 (b67)

| Ref | Finding | Verdict | What happens, or why not |
|---|---|---|---|
| b67#1 | `fallback_voice: true` adds 2 credits to the hold and the settle, but no cloud voice exists (open question 36) | **FIX** | H9, part 2: `POST /v1/jobs` refuses it with 400 until a voice card exists. The app never sends it. |
| b67#2 | First-device registration deletes the account key on **any** 409. "Request in progress" (our own registration) is also a 409, so the iPhone ends up approved with its account key gone for good | **FIX** | H13, part 1: the key is dropped only when the server holds another account key. |
| b67#3 | Stuck reservations count against the 3 GB cap for ever | ALREADY FIXED | `cleanup.ts`, `PENDING_BLOB_KEEP_MS` (H1). Test: "a blob reservation still uploading after 25 hours is deleted; …" (`cleanup.test.ts`). |
| b67#4 | No per-user byte budget on changes; unlimited links of up to 4 MiB; expired link objects are never deleted from R2 | **OWNER QUESTION** | Open question 55. Recommended default: before launch, a small server card with a daily byte cap per user on changes and links (for example 200 MB a day), and the hourly cleanup deleting expired links' R2 objects. It is storage cost and abuse, not a leak, and the numbers are a product choice. |
| b67#5 | `GET /v1/groups/:id/devices`, `GET …/keys` and `POST …/keys` ignore `ends_at`: until the hourly cron runs, an expired member is still a target that every first set must cover, and can still read and post keys | **FIX** | H11, part 3. |
| b67#6 | A `DELETE` between the Workflow's settle and its D1 update leaves a charged job that looks failed | **FIX** | H9, part 3, the same change as b5#4. A job whose hold is already settled is no longer stopped, so its Workflow marks it succeeded. |
| b67#7 | Removing a device does not close its group sockets | SKIP | The socket only sends "changed" notices. The removed device's session (R13) can read the same locked changes with `GET /v1/groups/:id/changes` anyway, and new content uses a key version it does not have. |
| b67#8 | A 409 "request in progress" thrown inside the handler (a hold still open) is stored by `idempotent()` and replayed for 24 hours | **FIX** | H9, part 4: a reply with `Retry-After` is not stored. |
| b67#9 | Second transcript: a modified client gets more audio than it paid for | DUPLICATE | b89#1. |
| b67#10 | Docs: `build-plan.md` lists blobs among the `idempotent()` writes; `contracts/src/groups.ts` says the server stores the SHA-256 "of the token bytes" | ALREADY FIXED (build plan, H1); **FIX** (comment) | The build plan's "Idempotency" convention already says "not blobs". The contracts comment is fixed in H11, part 4: the hash is of the 43-character text. |

### Fable, batches 8–9 (b89)

| Ref | Finding | Verdict | What happens, or why not |
|---|---|---|---|
| b89#1 | The second transcript never checks Whisper's reported seconds against the quote: audio at a low bit rate fits 7–10 minutes per paid minute under the byte cap | **FIX** | H10, part 2: the transcript is cut at the quoted minutes plus 30 s. Whisper has already run on that part, at most the byte cap's worth of audio, but nothing past the quote comes back, so there is nothing to gain. |
| b89#2 | A cancel or a failure releases the whole hold, so a modified client can use the models for free in a loop; no rate limit on `POST /v1/jobs` or the task routes | DUPLICATE | Open question 29 (cancelling after the model ran). Extended in this pull request with this abuse case and a default: a per-user rate limit on `POST /v1/jobs`. |
| b89#3 | Push `kind`/`ref` are top level, but `expo-notifications` reads `content.data` | ALREADY FIXED | `hardening-2.md`, M20 row: `platform/push.ts` `pushData` reads `trigger.payload`. |
| b89#4 | An injected web page can make the research answer carry a remote image URL; the mini-app regex filter can be bypassed | ALREADY FIXED | `core/research/answer.ts` shows images as "(image: alt)" and links as text, and only sources open, on a tap. Mini apps: M25c (sanitizer, run-time blocking, Lockdown Mode). |
| b89#5 | `platform/device.ts` 409 | DUPLICATE | b67#2. |
| b89#6 | On a shared iPad, another person's unfinished purchase is `finish`ed on 409 `other_account` without being granted to anyone | **FIX** | H13, part 2: `other_account` stays unfinished, so it reaches the buyer's account when they sign in on that iPad again. The server already refuses another account's `appAccountToken` (`apple/route.ts`). |
| b89#7 | Link passcodes can be brute-forced from many IP addresses (the limit is per link and address; passcodes can be 4 characters) | SKIP | Every passcode attempt also counts against `LINK_VIEWS`, which is keyed by link id alone (120 a minute from all addresses together). Each attempt needs a fresh Turnstile token, and the attacker must already hold the URL with its key. There are 94⁴ ≈ 78 million 4-character codes; at 120 a minute that is over a year on average. |
| b89#8 | `fallback_voice` | DUPLICATE | b67#1. |
| b89#9 | Web search through "ceramic" may need its own key; no per-request log switch | DUPLICATE | Open question 34 (staging checks: `env.AI.websearch` with gateway log collection off). |
| b89#10 | `sent_log` says "Not charged" when a retry gets 409 "already finished" | ALREADY FIXED | `core/explain/sent.ts`: `settleFailedSent` returns early for `already_finished`. |
| b89#11 | A waiting iPhone can never restart pairing after 10 minutes | ALREADY FIXED | `startPairingAgain` in `platform/device.ts` (M27b) registers a new id and commitment. |
| b89#12 | A failed `terminate` leaves `result_key` on a cancelled row; a cancel after the settle still sends a `job_ready` push for a deleted result | SKIP | The key on a cancelled row points at a deleted object and is never served (`GET …/result` needs `succeeded`). The push opens a job whose line says "Finished, but the result is gone" (H8). |

### Sonnet notes still open

| Ref | Finding | Verdict | What happens, or why not |
|---|---|---|---|
| M25c #119 | The mini-app sanitizer drops attributes on `<body>` (such as `onload`), and runs `<script type="application/json">` as JavaScript, which is a syntax error, so the data is lost | **FIX** | H17: JSON data scripts stay data, other non-JavaScript types are dropped, and the mini-app prompt tells the model to start on `DOMContentLoaded`. Not a safety problem: the M25c layers are unchanged. |
| M23 #116 | The `no_voices` copy needs a human read | DUPLICATE | Open question 50 (a design check of screen copy). |
| M28b #121 | A recovery whose group keys failed never reads the account row's envelopes again | **FIX** | H16, part 2. |
| M28b #121 | Two devices of the same person can make different version 1 keys for a group one of them just created | **FIX** | H16, part 1: only the creator makes version 1. |
| M28b #121 | No test for self-removal | SKIP | `removeDevice` is platform code (native calls; there is no hook or platform test setup). The fix is one branch (`targetId !== me.deviceId` skips the re-wrap), checked by reading and by M27b-C's device check. |
| M24a #120 | Four fix-round items can only be seen on a device (the video ends with the narration, the title shows, `no_audio`, paragraph spacing) | **FIX** (docs) | Done in this pull request: M24a's device check in `docs/cards/mobile-stage3-4.md` now lists them. |
| M24b #123 | A failed video row says "Couldn't make the voices" | **FIX** | H17. |
| M24b #123 | A render that is already running is not stopped when a recording begins | SKIP | Renders only write files (`AVSpeechSynthesizer.write`, `AVAssetWriter`) and do not use the microphone or the recording's audio session. A new render waits for the recorder (`platform/videos.ts`). Stopping one part way would only throw away up to a minute of work. |
| M29a (gap) | Moving a session out of a synced space is not sent as a delete | ALREADY FIXED | M30b: `markMoved` (`core/sync/changes.ts`), called from `SpacePickerScreen.tsx`. |
| M29a (gap) | Edits to sessions from before a member joined ("from now") wait in `sync_pending` until the 2,000 cap drops them | **OWNER QUESTION** | Open question 56. Recommended default: "from now" shares only notes started after joining. An edit to an older note is not shared with that member: their iPhone drops (does not defer) a session change whose `started_at` is before their `history_from`. |
| M29a #122 | The `sync_pending` cap drops the oldest deferred changes without a trace | SKIP | Bounded by design (2,000 per group). With question 56's default, most of these never wait. |
| M29a #122 | No test pins that a `delete` of a space is refused (without the guard it throws, which would stall the pull) | **TEST-ONLY** | H16, part 3. |
| M29a #122 | An oversized change that is skipped writes no `row_versions` entry | SKIP | It needs one change over 1 MB (`MAX_CHANGE_BYTES`); segments go out in time buckets far below that. Such a change is never sent at all. |

Counts (74 rows, each by its first verdict): **FIX 27** (4 of them docs only, done in this pull request), **TEST-ONLY 1**, **SKIP 19**, **ALREADY FIXED 10**, **DUPLICATE 12**, **OWNER QUESTION 5**. Three rows carry a second verdict: b2#5 (DUPLICATE of open question 3), b5#7 (OWNER QUESTION, playback) and b67#10 (FIX, a comment in H11). So six findings are owner questions: five new open questions (52 to 56) and one added to open question 7. b89#2 adds a default to open question 29. b5#3's skip comes with a sentence in `docs/security.md` section 12.

### Docs changed in this pull request

- `docs/architecture.md`: section 1, the Queues row (notices and cleanup do not use queues); section 4, the zero-retention switch is signed (H12), and a failed or cancelled task gets an `activity` row with 0 credits (b3#11).
- `docs/security.md`: section 1, the app is built for iPhone (b01#10); section 8, waiting devices removed after a day (H10) and the approval guard (H11); section 10, only the creator makes version 1 (H16); section 12, what a device that removes itself is trusted to do (b5#3); section 13, the recovery blob guard (H11); section 15, `PUT /v1/settings/zero-retention` is signed (H12), and the "not yet in architecture section 4" heading (b5#11).
- `docs/cards/mobile-stage3-4.md`: M24a's device check lists the four fix-round items of PR #120.
- `docs/build-plan.md`: the "Hardening 4" row in "Build order"; open questions 52 to 56; open questions 7 and 29 extended.

## Order

| Card | Branch | Area | Merge after |
|---|---|---|---|
| H9 | `fix/h9-tasks-jobs` | API: instant-task streams (`waitUntil`), `fallback_voice`, cancel order, the idempotency store | `main` at `ac25265` or later |
| H10 | `fix/h10-refunds-transcript-cleanup` | API: an earlier Plus period's refund, the second transcript cut at the quote, stale waiting devices | `main` at `ac25265` or later |
| H11 | `fix/h11-device-key-races` | API: approval and recovery blob after a removal, `ends_at` in the key routes, one contracts comment | `main` at `ac25265` or later |
| H12 | `fix/h12-signed-zero-retention` | API, API client and app: the zero-retention switch is signed | `main` at `ac25265` or later |
| H13 | `fix/h13-registration-store-recording` | App: first-device 409, `other_account` purchases, crash recovery without the speech pack, the record screen going away | `main` at `ac25265` or later |
| H14 | `fix/h14-last-words` | Native `waypoint-audio`: `stop()` waits for the last final words | `main` at `ac25265` or later |
| H15 | `fix/h15-search` | App search: interrupted sessions, text written during indexing, the space of a moved session | `main` at `ac25265` or later |
| H16 | `fix/h16-group-keys-sync` | App groups and sync: version 1 by the creator, recovery re-read, the space-delete test | `main` at `ac25265` or later |
| H17 | `fix/h17-mini-app-data-video-label` | App: mini-app data scripts and the prompt line; the failed video row | `main` at `ac25265` or later |

No two cards touch the same file, so all nine can be built at the same time and merged in any order. H12 changes `apps/api/test/helpers/signing.ts` (one optional field), which H11's tests use unchanged. H17 changes one line of `apps/api/src/jobs/write.ts`, which no other card touches.

Every block marked **exactly** was applied to a copy of `main` at `ac25265` (after `npm install`) and checked there:

- `npm run typecheck`: exit 0.
- `npm test`: api 1,019 = 1,007 + 12, mobile 449 = 442 + 7, api-client 48 = 47 + 1; the other packages unchanged.
- `npm run bundle -w @waypoint/api`: the dry run passes.
- `npm run export:ios -w @waypoint/mobile`: exports.
- `npm run test:swift -w @waypoint/mobile`: 57 tests, unchanged (no card changes Swift `Core`).
- `swiftc -parse` on H14's two Swift files. The build Mac's macOS 15 SDK has no `SpeechAnalyzer`, so they cannot be type-checked here; H14's device check covers that.

Then the source changes were removed and the tests kept: **every new test failed** on unchanged `main`, except H16's space-delete test, which pins a guard that is already there. Without the guard, that test fails with "no such column: x.session_id". The copy was then deleted.

Server cards follow `AGENTS.md` and the server card rules in `docs/cards/hardening-1.md`, "Server hardening cards". App cards follow `docs/cards/mobile-stage3-4.md`, section 1 ("What these cards add to the rules").

---

## H9 · API: streams that outlive the app, `fallback_voice`, cancel order, replies that say "try again"

Branch `fix/h9-tasks-jobs`. From `main` at `ac25265`. No dependency, no migration. Files, and no others:

- `apps/api/src/tasks/instant.ts`, `apps/api/test/explain.test.ts`
- `apps/api/src/jobs/routes.ts`, `apps/api/test/jobs.test.ts`
- `apps/api/src/jobs/job.ts`, `apps/api/test/jobs-core.test.ts`
- `apps/api/src/idempotency.ts`, `apps/api/test/idempotency-store.test.ts`

### 1. An answer is settled even when the app drops the stream (b2#1)

**Why.** In workerd, a request's remaining work stops when its client disconnects. Fable reproduced this in local workerd. `streamTask` settles only after the model stream has been read, so a dropped stream never settles, never sends its usage event, and keeps the hold open until the wallet's alarm. The same key then gets 409 for minutes, and the answer, already streamed in deltas, is free. Hono's stream writes swallow errors once the client is gone, so the read itself can go on. It only needs the Worker kept alive.

**Policy.** An answer whose model produced text is charged, also when the app left before `done`. This is what the app already assumes (`hardening-2.md`, M16 row) and what Node tests already show. `waitUntil` keeps the Worker up for about 30 s after the client leaves. Explain (500 tokens) and more detail normally finish well within that; if one does not, the hold's alarm releases it, as before.

`apps/api/src/tasks/instant.ts`: in `streamTask`, replace the `return streamSSE(c, async (sse) => { … });` block and add `keepAlive` after the function, so it reads, exactly:

```ts
  return streamSSE(c, async (sse) => {
    const work = (async () => {
      let result: StreamResult | null = null;
      try {
        result = await readModelStream(stream, (text) => sse.writeSSE({ event: "delta", data: JSON.stringify({ text }) }));
      } catch {
        result = null;
      }
      if (result === null || result.chars === 0) {
        await finishTask(c, held, "model_failed", result ?? NO_TOKENS, now());
        await sse.writeSSE({ event: "error", data: JSON.stringify(apiError("internal", "model failed")) });
        return;
      }
      const charged = await finishTask(c, held, "ok", result, now());
      const done: StreamDone = {
        credits: charged,
        tier: held.tier,
        retention: held.retention,
        offer_research: held.offerResearch,
      };
      await sse.writeSSE({ event: "done", data: JSON.stringify(done) });
    })();
    keepAlive(c, work);
    await work;
  });
}

// workerd stops a request's remaining work when its client goes away, so an answer whose app dropped the connection
// would never settle or send its usage event (the hold stays open until the wallet's alarm releases it). waitUntil
// keeps the Worker running until `work` ends: the model is read to the end (writes to a closed stream are dropped)
// and the answer is settled like any other. Tests that pass no ExecutionContext simply await `work`.
function keepAlive(c: Context<AppEnv>, work: Promise<void>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // Hono throws when there is no ExecutionContext, which happens only in tests.
  }
}
```

`answerTask` (double-check) is not changed. It answers with nothing until the end, so an app that leaves gets no answer, and the alarm releases the hold.

`apps/api/test/explain.test.ts`: add at the end of the file, exactly:

```ts
describe("POST /v1/tasks/explain: the app goes away", () => {
  test("the app drops the stream after the first delta: the work is handed to waitUntil, settles at 1 credit and sends its usage event", async () => {
    const made = makeTaskEnv();
    const waiting: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void waiting.push(p), passThroughOnException: () => undefined, props: {} };
    const init = { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": KEY }, body: JSON.stringify(BODY) };
    const res = await setup().request("/v1/tasks/explain", init, made.env, ctx);
    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error("expected a body");
    await reader.read();
    await reader.cancel();
    expect(waiting).toHaveLength(1);
    await Promise.all(waiting);
    expect(made.store.read()).toMatchObject({ monthly: 9, holds: [] });
    expect(made.events).toMatchObject([{ id: HOLD_ID, outcome: "ok", credits: 1 }]);
  });
});
```

### 2. No charge for a voice that does not exist (b67#1)

`fallback_voice: true` adds 2 credits (`PRICE_TABLE`), but no Workflow makes a cloud voice (open question 36), so the job would charge for nothing. The app never sends it. `POST /v1/tasks/quote` may still quote it: a quote charges nothing.

`apps/api/src/jobs/routes.ts`: after `if (route === null) throw new ApiFailure("forbidden", "no zero-retention route for this task");`, add exactly:

```ts
      // The cloud fallback voice has a price but no Workflow yet (open question 36): nothing may be charged for it.
      if ((request.type === "overview_script" || request.type === "video_slides") && request.fallback_voice === true) {
        throw new ApiFailure("bad_request", "fallback voice not available");
      }
```

`apps/api/test/jobs.test.ts`: replace the test `"video_slides with fallback_voice quotes 52"` with, exactly:

```ts
  test("fallback_voice true gives 400 with no hold, no row and no Workflow; false quotes 50 as without it", async () => {
    const w = await makeJobsWorld();
    for (const type of ["overview_script", "video_slides"] as const) {
      const res = await postJob(w, { type, text: "Slides text", fallback_voice: true }, `key-voice-${type}-0123`);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toEqual({ code: "bad_request", message: "fallback voice not available", retry_after: null });
    }
    expect(holdCommands(w)).toHaveLength(0);
    expect(w.workflow.created).toHaveLength(0);
    expect(await w.db.prepare("SELECT count(*) AS n FROM jobs").first<{ n: number }>()).toEqual({ n: 0 });
    const res = await postJob(w, { type: "video_slides", text: "Slides text", fallback_voice: false });
    expect(JobResponseSchema.parse(await res.json()).job.quoted).toBe(50);
  });
```

### 3. Cancel releases first, and leaves a settled job to finish (b5#4, b67#6)

**Why.** `cancelJob` terminates the Workflow and only then releases. If the Workflow has just settled, it is terminated between its settle and its `UPDATE … 'succeeded'`. The job is charged, its row stays "running", and after the deadline it shows "failed". Released first, a Workflow that tries to settle afterwards finds no hold (its result is deleted, the job fails, nothing is charged). A hold that is already settled means the work is done: the Workflow is left alone, marks the job succeeded, and the result is deleted as for any cancel after the settle (architecture section 4).

`apps/api/src/jobs/job.ts`: replace the comment above `cancelJob` and its first lines, up to and including `if (released.ok) {`, so they read, exactly:

```ts
// DELETE /v1/jobs/:id. A queued or running job has its hold released, and only then is it stopped (stop terminates
// its Workflow instance; errors ignored): nothing is charged, and one usage event says "cancelled". A job whose hold
// was already settled is not stopped, so its Workflow still marks it succeeded; it keeps what it was charged, like a
// finished job. Either way the result, the locked input and any uploaded audio are deleted.
export async function cancelJob(deps: JobDeps, job: JobRow, stop: () => Promise<void>): Promise<void> {
  const now = deps.now();
  if (job.state === "queued" || job.state === "running") {
    const ids = jobWalletIds(job.user_id, job.command_key);
    const released = await deps.wallet.apply({ type: "release", id: ids.release, hold_id: ids.hold });
    if (released.ok) {
      // Released first: a Workflow about to settle now finds no hold, deletes its result and fails.
      await stop().catch(() => undefined);
```

The rest of the function is unchanged.

`apps/api/test/jobs-core.test.ts`, in `describe("cancelJob")`:

- Replace the test `"cancelling a running job whose hold was already settled keeps the state running and the charge, deletes the objects and sends no usage event"`, up to and including its `expect((await loadJob(w.db, "job_run", "u1"))?.state).toBe("running");` line, with exactly the following. Its remaining lines stay.

```ts
  test("cancelling a running job whose hold was already settled does not stop it, keeps the state running and the charge, deletes the objects and sends no usage event", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_run", key: KEY, state: "running" });
    w.store.apply({ type: "settle", id: `job_settle:u1:${KEY}`, hold_id: `job:u1:${KEY}`, actual: 30 }, JOB_NOW);
    await w.bucket.put("results/job_run", new Uint8Array([1]));
    const row = await loadJob(w.db, "job_run", "u1");
    if (row === null) throw new Error("expected the job");
    const { calls, stop } = stopCounter();
    await cancelJob(w.deps, row, stop);
    expect(calls.count).toBe(0);
    expect((await loadJob(w.db, "job_run", "u1"))?.state).toBe("running");
```

- Before the test `"cancelling a running job still cancels when its stop rejects"`, add exactly:

```ts
  test("the hold is released before the Workflow is stopped", async () => {
    const w = await makeJobsWorld();
    await insertJob(w, { id: "job_run", key: KEY, state: "running" });
    const row = await loadJob(w.db, "job_run", "u1");
    if (row === null) throw new Error("expected the job");
    const seen: string[] = [];
    await cancelJob(w.deps, row, async () => {
      seen.push(`stop after ${w.commands.map((command) => command.type).join(",")}`);
    });
    expect(seen).toEqual(["stop after release"]);
  });
```

### 4. A "try again" reply is not stored (b67#8)

**Why.** `idempotent()` stores every 409 with a JSON body. A handler's 409 "request in progress" (a wallet hold still open from an earlier run of the same key, which happens when a pending row goes stale after 60 s) carries `Retry-After`. Stored, it is replayed for 24 hours, long after the hold was settled or released, so the app's retries never reach the handler again.

`apps/api/src/idempotency.ts`: replace `isStorable` with, exactly:

```ts
// A reply that says "try again later" (Retry-After, such as 409 "request in progress" from a wallet hold still open)
// is not stored: replayed, it would keep answering "in progress" for 24 hours after the work ended.
function isStorable(reply: Response): boolean {
  const status = reply.status;
  const statusOk = (status >= 200 && status <= 299) || status === 400 || status === 404 || status === 409;
  return statusOk && !reply.headers.has("Retry-After") && (reply.headers.get("Content-Type") ?? "").startsWith("application/json");
}
```

`apps/api/test/idempotency-store.test.ts`: in `describe("idempotent: what is stored")`, before the test `"a plain Error (500) is not stored: the row is deleted"`, add exactly:

```ts
  test("a 409 with Retry-After from the handler (a hold still in progress) is not stored: the same request runs again", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, () => {
      runs += 1;
      if (runs === 1) throw new ApiFailure("conflict", "request in progress", 1);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const first = await post(app, db, PATH, { name: "a" });
    expect(first.status).toBe(409);
    expect(first.headers.get("Retry-After")).toBe("1");
    expect(await rowCount(db)).toBe(0);
    const second = await post(app, db, PATH, { name: "a" });
    expect(second.status).toBe(200);
    expect(runs).toBe(2);
  });
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api 1,010 = 1,007 + 3: one test replaced, three added), `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Device and staging checks

- On staging (`wrangler dev` with workerd is enough): start an explain with `curl -N`, stop `curl` after the first `delta`, then call `GET /v1/wallet`. The credit is charged and the hold is gone within a few seconds. The `activity` list shows the explain once.

### Not in this PR

- `answerTask` (double-check) under `waitUntil`: nothing is delivered before the end, so there is nothing to charge.
- A deadline inside `readModelStream` (open question 3).
- A cloud fallback voice (open question 36).

---

## H10 · API: an earlier Plus period's refund, the second transcript stops at the quote, stale waiting devices

Branch `fix/h10-refunds-transcript-cleanup`. From `main` at `ac25265`. No dependency, no migration. Files, and no others:

- `apps/api/src/apple/notifications.ts`, `apps/api/test/apple-notices.test.ts`
- `apps/api/src/jobs/retranscribe.ts`, `apps/api/test/retranscribe.test.ts`
- `apps/api/src/cleanup.ts`, `apps/api/test/cleanup.test.ts`

### 1. A refund of an earlier Plus period (b3#1)

**Why.** A Plus renewal records a new transaction (t2) and leaves the earlier one (t1) `active`. When Apple refunds t1, `applyNotice` finds t1 `active`, resets the monthly credits to 0, ends the Plus entitlement and drops the plan to free, although t2 is paid and running. The lapse branch already skips a notice when a later period is active; the refund branch needs the same check. t1's month was already replaced by t2's reset, so there is nothing to take back from it.

`apps/api/src/apple/notifications.ts`:

- In `applyNotice`, in the `refund`/`revoke` branch, right after the `const row = …first<{ status: string }>();` statement, add exactly:

```ts
    if (row !== null && product.kind === "plus" && (await laterPeriodActive(db, txn))) {
      // An earlier Plus period refunded after the subscription renewed: that period's allowance was already replaced
      // by the later one's, so only its row changes. The monthly credits, the entitlement and the plan stay.
      await db
        .prepare("UPDATE purchases SET status = ? WHERE transaction_id = ? AND status IN ('active', 'expired')")
        .bind(action === "refund" ? "refunded" : "revoked", txn.transactionId)
        .run();
      return;
    }
```

- In the `lapse` branch, replace the `const later = …` statement and the line `if (later !== null) return; // …` with, exactly:

```ts
    if (await laterPeriodActive(db, txn)) return; // a later period is already active: this notice is out of date
```

- Before `export type NoticeInput = {`, add exactly:

```ts
// True when a later period of the same subscription is recorded and active.
async function laterPeriodActive(db: Db, txn: AppleTransaction): Promise<boolean> {
  const later = await db
    .prepare("SELECT 1 AS found FROM purchases WHERE original_id = ? AND status = 'active' AND purchased_at > ? LIMIT 1")
    .bind(txn.originalTransactionId, txn.purchaseDate)
    .first<{ found: number }>();
  return later !== null;
}
```

`apps/api/test/apple-notices.test.ts`: in `describe("refunds, revokes and lapses")`, before the test `"the same refund notice applied twice makes one wallet command"`, add exactly:

```ts
  test("a refund of an earlier Plus period after a renewal marks only that row refunded: monthly, entitlement and plan stay", async () => {
    const first = transaction("t1", "waypoint.plus.monthly", { purchaseDate: NOW - 40 * DAY, expiresDate: NOW - 10 * DAY });
    const second = transaction("t2", "waypoint.plus.monthly", { originalTransactionId: "t1", purchaseDate: NOW - 10 * DAY, expiresDate: NOW + 20 * DAY });
    await record(accountA, first);
    await record(accountA, second);
    expect(read(accountA).monthly).toBe(2000);
    commands.splice(0);
    await apply(accountA, notice("REFUND", uuid(2)), first);
    expect(commands).toHaveLength(0);
    expect(read(accountA).monthly).toBe(2000);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t1")).status).toBe("refunded");
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t2")).status).toBe("active");
    expect((await one<{ ended_at: number | null }>("SELECT ended_at FROM entitlements WHERE user_id = ? AND product = 'plus'", A)).ended_at).toBeNull();
    expect(await planOf(A)).toBe("plus");
  });

  test("a refund of the current Plus period after a renewal still resets monthly to 0 and ends Plus", async () => {
    const first = transaction("t1", "waypoint.plus.monthly", { purchaseDate: NOW - 40 * DAY, expiresDate: NOW - 10 * DAY });
    const second = transaction("t2", "waypoint.plus.monthly", { originalTransactionId: "t1", purchaseDate: NOW - 10 * DAY, expiresDate: NOW + 20 * DAY });
    await record(accountA, first);
    await record(accountA, second);
    await apply(accountA, notice("REFUND", uuid(3)), second);
    expect(read(accountA).monthly).toBe(0);
    expect(await planOf(A)).toBe("free");
  });
```

### 2. The second transcript stops at the quote (b89#1)

**Why.** The byte cap (600,000 bytes per quoted minute, H1) bounds the audio by size, not by length. AAC at a very low bit rate fits 7 to 10 minutes into a quoted minute, and Whisper's whole transcript came back for the price of one minute. Whisper has already run on that part when its duration is known, but if nothing past the quote comes back, a modified client gains nothing. An honest app quotes the recording's length, which the 30 s margin covers.

`apps/api/src/jobs/retranscribe.ts`:

- Replace the comment above `makeTranscript` with, exactly:

```ts
// The make step: Whisper on each chunk in order, then seal. Stops reading chunks once the audio passes the quoted
// minutes (plus 30 s), and cuts the transcript there: audio packed at a very low bit rate fits many more minutes under
// the byte cap, and none of the words past the quote come back. Charges the per-minute price for each started minute
// of reported audio, never above the quote; if a chunk's duration is not reported, charges the quote.
```

- In the loop, replace everything from `const duration = parsed.data.transcription_info?.duration ?? null;` to the loop's closing `}` with, exactly:

```ts
    const duration = parsed.data.transcription_info?.duration ?? null;
    if (duration === null) allKnown = false;
    // What is left of the quote in this chunk. A chunk that runs past it keeps only the segments that start before.
    const room = limitSeconds - seconds;
    const cut = duration !== null && duration > room;
    const segments = (parsed.data.segments ?? []).filter((s) => !cut || s.start < room);
    seconds += duration === null ? 300 : Math.min(duration, room);
    chunks.push({
      n,
      duration: duration === null ? null : round(Math.min(duration, room)),
      text: cut ? segments.map((s) => s.text.trim()).filter((t) => t !== "").join(" ") : parsed.data.text.trim(),
      segments: segments.map((s) => ({ start: round(s.start), end: round(cut ? Math.min(s.end, room) : s.end), text: s.text.trim() })),
    });
    if (cut) {
      truncated = true;
      break;
    }
  }
```

The app already shows `truncated`: "Only the minutes you paid for were transcribed." (`SessionScreen.tsx`, M18).

`apps/api/test/retranscribe.test.ts`: before the test `"an upload bigger than minutes × 600,000 bytes: …"`, add exactly:

```ts
  test("one part with ten minutes of audio for 1 quoted minute: the transcript stops at 90 s, truncated, charged 1", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 1, minutes: 1, input: null });
    await withParts(f);
    const segments = [
      { start: 0, end: 40, text: " First. " },
      { start: 60, end: 95, text: "Second." },
      { start: 100, end: 120, text: "Paid for by nobody." },
      { start: 500, end: 600, text: "Nor this." },
    ];
    const { ai, calls } = fakeWhisper(() => whisperReply("First. Second. Paid for by nobody. Nor this.", 600, segments));
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 2, bytes: 5 }) }, f.input)).toBe(true);
    expect(calls).toHaveLength(1);
    const opened = await openResult(f.objects.get("results/job_1")?.value ?? new Uint8Array(), "job_1", "device_1", f.device.boxPrivate);
    expect(RetranscribeResultSchema.parse(JSON.parse(new TextDecoder().decode(opened)))).toEqual({
      v: 1,
      truncated: true,
      chunks: [
        {
          n: 0,
          duration: 90,
          text: "First. Second.",
          segments: [
            { start: 0, end: 40, text: "First." },
            { start: 60, end: 90, text: "Second." },
          ],
        },
      ],
    });
    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 1 });
  });
```

The existing test "audio past the quoted minutes stops Whisper early: two calls, truncated, charged 1" still passes unchanged: its second part is now cut at 40 s.

### 3. Devices that waited for more than a day (b3#10)

**Why.** A registered device that is never approved stays in `devices` for ever. Each "Start again" on a waiting iPhone (M27b) registers a new id, so Settings › Devices fills with dead "waiting" rows, and a stolen session can add hundreds a day (the limit of 3 counts only live pairings). Marking such a device removed after a day is safe: its app finds its keys unknown at the next check and registers again (`planRegistration`: `start_over`). The day leaves time for the recovery path, which approves a waiting device without a pairing.

`apps/api/src/cleanup.ts`:

- After `export const PENDING_BLOB_KEEP_MS = 24 * 60 * 60 * 1000;`, add exactly:

```ts
// A device that registered (S1B) but was never approved, and has no live pairing, is marked removed after a day: it
// leaves Settings › Devices (each "Start again" on a waiting iPhone registers a new id). The app on that iPhone then
// finds its keys unknown and registers again (planRegistration: start_over).
export const WAITING_DEVICE_KEEP_MS = 24 * 60 * 60 * 1000;
```

- In `cleanup`'s return type, after `pending_blobs: number`, add `; waiting_devices: number`. So it ends `pending_blobs: number; waiting_devices: number }> {`.
- After the `const pendingBlobs = …` statement, add exactly:

```ts
  const waitingDevices = await env.DB.prepare(
    `UPDATE devices SET removed_at = ? WHERE kind = 'device' AND approved_at IS NULL AND removed_at IS NULL AND added_at < ?
       AND NOT EXISTS (SELECT 1 FROM device_pairings p WHERE p.device_id = devices.id AND p.expires_at > ?)`,
  )
    .bind(now, now - WAITING_DEVICE_KEEP_MS, now)
    .run();
```

- In the returned object, after `pending_blobs: pendingBlobs.meta.changes,`, add `waiting_devices: waitingDevices.meta.changes,`.

`apps/api/test/cleanup.test.ts`:

- In the test `"request_nonces 1 ms past expiry are deleted, …"`, the expected counts become exactly `{ results: 1, tmp_audio: 1, tmp_input: 0, idempotency: 0, request_nonces: 1, pending_blobs: 0, waiting_devices: 0 }`.
- Add at the end of `describe("cleanup")`, exactly:

```ts
  test("a device waiting for more than a day with no live pairing is marked removed; a younger one, one with a live pairing, an approved one and the account row are kept", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'u1')").run();
    const insert =
      "INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, kind, approved_at) VALUES (?, 'u1', 'iPhone', ?, 'S', 'B', 0, ?, ?, ?)";
    await db.prepare(insert).bind("old_waiting", "ios", NOW - 25 * HOUR, "device", null).run();
    await db.prepare(insert).bind("old_expired_pairing", "ios", NOW - 25 * HOUR, "device", null).run();
    await db.prepare(insert).bind("old_live_pairing", "ios", NOW - 25 * HOUR, "device", null).run();
    await db.prepare(insert).bind("young_waiting", "ios", NOW - 23 * HOUR, "device", null).run();
    await db.prepare(insert).bind("old_approved", "ios", NOW - 25 * HOUR, "device", NOW - 25 * HOUR).run();
    await db.prepare(insert).bind("acct", "account", NOW - 25 * HOUR, "account", NOW - 25 * HOUR).run();
    await db.prepare("INSERT INTO device_pairings (device_id, commitment, expires_at) VALUES ('old_expired_pairing', 'c', ?)").bind(NOW).run();
    await db.prepare("INSERT INTO device_pairings (device_id, commitment, expires_at) VALUES ('old_live_pairing', 'c', ?)").bind(NOW + 1).run();
    const counts = await cleanup({ DB: db, BUCKET: fakeBucket([]).bucket }, NOW);
    expect(counts.waiting_devices).toBe(2);
    const rows = await db.prepare("SELECT id FROM devices WHERE removed_at = ? ORDER BY id").bind(NOW).all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "old_expired_pairing" }, { id: "old_waiting" }]);
  });
```

`docs/security.md` section 8 already says this (changed in this planning pull request).

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api 1,011 = 1,007 + 4), `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Not in this PR

- Releasing a deleted account's Own it and Plus for a new account (b2#2, open question 7).
- A stored expiry for Plus, or a cheaper yearly top-up (b3#8, b3#9: skipped).
- Push tokens of a removed waiting device: a waiting device gets no pushes but `device_approved`, which is harmless.

---

## H11 · API: approvals and recovery blobs after a removal, expired members in the key routes

Branch `fix/h11-device-key-races`. From `main` at `ac25265`. No dependency, no migration. Files, and no others:

- `apps/api/src/devices/pairing.ts`, `apps/api/test/pairing.test.ts`
- `apps/api/src/recovery/route.ts`, `apps/api/test/recovery.test.ts`
- `apps/api/src/keys/groups.ts`, `apps/api/src/keys/routes.ts`, `apps/api/test/group-keys.test.ts`
- `packages/contracts/src/groups.ts` (one comment)

### 1. An approval applies only under the account key it was checked against (b5#2)

**Why.** `POST /v1/devices/:id/approve` reads the account row, checks the new device's certificate under that key, then runs its batch. H2 already makes a second approval lose. A **removal** that lands in between replaces the account key (`devices/remove.ts`), and may remove the approving device itself. The approval then still applies: the new device is approved with a certificate and an account envelope under a key that no longer exists, approved by a device that may be gone. Other members' iPhones refuse it, and it holds no current account key. The guard goes into the statement that approves, and the envelopes already depend on that statement (H2).

`apps/api/src/devices/pairing.ts`, in the approve route:

- Replace the first statement of `statements` (the `UPDATE devices SET approved_at = …`) with, exactly:

```ts
        // Only if, when the batch runs, the signer is still live and the account key the certificate was checked
        // against is still the current one: a removal that landed meanwhile replaced the account key (and may have
        // removed the signer), and an approval under the old key would leave a device nobody can vouch for.
        db
          .prepare(
            `UPDATE devices SET approved_at = ?, approved_by = ?, can_approve = 1, cert = ?, account_envelope = ?
             WHERE id = ? AND approved_at IS NULL AND removed_at IS NULL
               AND EXISTS (SELECT 1 FROM devices WHERE id = ? AND removed_at IS NULL)
               AND EXISTS (SELECT 1 FROM devices WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL AND sign_pub = ?)`,
          )
          .bind(now, signer.id, req.cert, req.account_envelope, target.id, signer.id, user.id, account.sign_pub),
```

- Replace `if (results[0]?.meta.changes !== 1) throw new ApiFailure("conflict", "device already approved");` with, exactly:

```ts
      if (results[0]?.meta.changes !== 1) {
        const now2 = await db.prepare("SELECT approved_at FROM devices WHERE id = ?").bind(target.id).first<{ approved_at: number | null }>();
        throw new ApiFailure("conflict", now2 !== null && now2.approved_at !== null ? "device already approved" : "devices changed, try again");
      }
```

The app already answers a 409 from approve by refreshing and asking again (`platform/devices.ts`); the recovery path treats it as "approved meanwhile" and refreshes.

`apps/api/test/pairing.test.ts`: before the test `"approve with an envelope for a group the user has left: …"`, add exactly:

```ts
  test("an approval whose account key is replaced between the reads and the batch (a removal landed): 409 'devices changed, try again', still waiting, no envelope", async () => {
    const w = await world();
    await insertDevice(w.db, w.ipad, { userId: "u1", approvedAt: null });
    await w.db
      .prepare("INSERT INTO device_pairings (device_id, commitment, approver_id, approver_nonce, device_nonce, expires_at) VALUES ('ipad_1', 'c', 'phone_1', ?, ?, ?)")
      .bind(w.phoneNonce, w.ipadNonce, NOW + TTL)
      .run();
    const cert = await certOf(w, w.account);
    const accountEnvelope = await wrap(w, PURPOSE_ACCOUNT_KEY, accountKeyInfo("u1", "acct_1", "ipad_1"), w.phone, "phone_1", 64);
    const groupEnvelope = await wrap(w, PURPOSE_GROUP_KEY, groupKeyInfo("g1", 1, "ipad_1"), w.phone, "phone_1", 32);
    const rotated: BatchDb = {
      prepare: (query) => w.db.prepare(query),
      batch: async (statements) => {
        await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'acct_1'").bind(NOW).run();
        await insertDevice(w.db, await makeTestDevice("acct_2"), { userId: "u1", kind: "account" });
        return w.db.batch(statements);
      },
    };
    const body = { cert, account_envelope: accountEnvelope, envelopes: [{ group_id: "g1", key_version: 1, wrapped_key: groupEnvelope }] };
    const res = await send(w, w.phone, APPROVE, body, { db: rotated });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: "conflict", message: "devices changed, try again", retry_after: null });
    const row = await w.db.prepare("SELECT approved_at FROM devices WHERE id = 'ipad_1'").first<{ approved_at: number | null }>();
    expect(row?.approved_at).toBeNull();
    expect(await count(w.db, "SELECT COUNT(*) AS n FROM key_envelopes WHERE device_id = ?", "ipad_1")).toBe(0);
  });

  test("an approval whose approving phone is removed between the reads and the batch: 409 'devices changed, try again', still waiting", async () => {
    const w = await world();
    await insertDevice(w.db, w.ipad, { userId: "u1", approvedAt: null });
    await w.db
      .prepare("INSERT INTO device_pairings (device_id, commitment, approver_id, approver_nonce, device_nonce, expires_at) VALUES ('ipad_1', 'c', 'phone_1', ?, ?, ?)")
      .bind(w.phoneNonce, w.ipadNonce, NOW + TTL)
      .run();
    const cert = await certOf(w, w.account);
    const accountEnvelope = await wrap(w, PURPOSE_ACCOUNT_KEY, accountKeyInfo("u1", "acct_1", "ipad_1"), w.phone, "phone_1", 64);
    const removed: BatchDb = {
      prepare: (query) => w.db.prepare(query),
      batch: async (statements) => {
        await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'phone_1'").bind(NOW).run();
        return w.db.batch(statements);
      },
    };
    const res = await send(w, w.phone, APPROVE, { cert, account_envelope: accountEnvelope, envelopes: [] }, { db: removed });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: "conflict", message: "devices changed, try again", retry_after: null });
    const row = await w.db.prepare("SELECT approved_at FROM devices WHERE id = 'ipad_1'").first<{ approved_at: number | null }>();
    expect(row?.approved_at).toBeNull();
  });
```

Each test fails on its own without its half of the guard: the first is the only one with a live signer, the second the only one with an unchanged account key.

### 2. A recovery blob is stored only for the current account row (b5#2)

**Why.** `PUT /v1/recovery` reads the account row id, then upserts the blob. A removal that lands in between replaces the account key and deletes the old blob; the upsert then stores a blob for the old key. `GET /v1/recovery` joins it with the **new** account row, so recovery with the words fails ("wrong words", the additional data names the old row), while the app believes a recovery key exists.

`apps/api/src/recovery/route.ts`: replace the upsert and the reply, from `const verifiedAt = …` to `return c.json(…);`, with exactly:

```ts
      const verifiedAt = req.verified ? deps.now() : null;
      // Stored only if that account row is still the active one when the write runs. A device removal that replaced
      // the account key in between deleted the old blob; this one would wrap a key nobody holds any more.
      const stored = await db
        .prepare(
          `INSERT INTO recovery (user_id, wrapped_account_key, verified_at)
           SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM devices WHERE id = ? AND user_id = ? AND kind = 'account' AND removed_at IS NULL)
           ON CONFLICT (user_id) DO UPDATE SET wrapped_account_key = excluded.wrapped_account_key, verified_at = excluded.verified_at`,
        )
        .bind(user.id, req.wrapped_account_key, verifiedAt, account.id, user.id)
        .run();
      if (stored.meta.changes !== 1) throw new ApiFailure("conflict", "not the current account key");
      return c.json({ account_device_id: account.id, verified_at: verifiedAt });
```

(The `SELECT … WHERE` before `ON CONFLICT` is SQLite's documented form of an upsert from a `SELECT`; the `WHERE` also removes the parsing ambiguity.)

`apps/api/test/recovery.test.ts`: before the test `"a blob with version byte 2, 92 bytes, or characters outside base64url gets 400"`, add exactly:

```ts
  test("an account key replaced between the read and the write (a device removal): 409 and no blob is stored", async () => {
    const { db, phone } = await fixture();
    const replaced: Db = {
      prepare: (query) => {
        const statement = db.prepare(query);
        if (!query.includes("INSERT INTO recovery")) return statement;
        return {
          ...statement,
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values);
            return {
              ...bound,
              run: async () => {
                await db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'acct_1'").bind(NOW).run();
                await insertDevice(db, await makeTestDevice("acct_2"), { userId: "u1", kind: "account" });
                return bound.run();
              },
            };
          },
        };
      },
    };
    const res = await appFor(userOf("u1")).request(
      "/v1/recovery",
      await putRequest(phone, { account_device_id: "acct_1", wrapped_account_key: await makeBlob("acct_1"), verified: true }),
      { DB: replaced },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "not the current account key", retry_after: null });
    const rows = await db.prepare("SELECT count(*) AS n FROM recovery WHERE user_id = ?").bind("u1").first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });
```

### 3. An expired member is no longer a key target (b67#5)

**Why.** An invite "until a date" sets `memberships.ends_at`. The sync, link and blob routes already treat a passed `ends_at` as ended (`activeMembership`), and the hourly cron ends the membership and bumps the key version. The three key routes check only `left_at`. So for up to an hour the expired member's devices are targets that every first set must cover (the new key is wrapped for them), and the expired member can still read and post envelopes.

`apps/api/src/keys/groups.ts`:

- Replace the comment and `TARGETS_SQL` with, exactly:

```ts
// The devices that must hold a group's current key: approved, not removed devices and the active account key
// row of every current member (docs/security.md, "Group keys"). A membership whose end date has passed no longer
// counts, even before the hourly cron ends it. Binds: group id, now.
export const TARGETS_SQL = `
  SELECT d.id, d.user_id, d.kind, d.sign_pub, d.box_pub, d.cert, m.role
  FROM memberships m
  JOIN devices d ON d.user_id = m.user_id
  WHERE m.group_id = ? AND m.left_at IS NULL AND (m.ends_at IS NULL OR m.ends_at > ?) AND d.removed_at IS NULL AND d.approved_at IS NOT NULL
  ORDER BY d.user_id, d.kind, d.id`;
```

- Replace `currentMember` with, exactly:

```ts
export async function currentMember(db: Db, groupId: string, userId: string, now: number): Promise<{ key_version: number; role: string } | null> {
  return db
    .prepare(
      "SELECT g.key_version, m.role FROM groups g JOIN memberships m ON m.group_id = g.id WHERE g.id = ? AND m.user_id = ? AND m.left_at IS NULL AND (m.ends_at IS NULL OR m.ends_at > ?)",
    )
    .bind(groupId, userId, now)
    .first<{ key_version: number; role: string }>();
}
```

- In `storeGroupKeys`, the `input` type gains `now: number` (after `envelopes`). Its first line becomes `const group = await currentMember(db, input.groupId, input.userId, input.now);` and its targets line becomes `const targets = (await db.prepare(TARGETS_SQL).bind(input.groupId, input.now).all<TargetRow>()).results;`.

`apps/api/src/keys/routes.ts`:

- In `GET /v1/groups/:id/devices`, replace the `currentMember` and `targets` lines with, exactly:

```ts
      const now = deps.now();
      const group = await currentMember(db, groupId, c.get("user").id, now);
      if (group === null) throw new ApiFailure("not_found", "no such group");
      const targets = (await db.prepare(TARGETS_SQL).bind(groupId, now).all<TargetRow>()).results;
```

- In `GET /v1/groups/:id/keys`: `const group = await currentMember(db, groupId, user.id, deps.now());`.
- In `POST /v1/groups/:id/keys`: add `now: deps.now(),` after `envelopes: parsed.data.envelopes,` in the `storeGroupKeys` call.

`apps/api/test/group-keys.test.ts`: before the test `"after a first set, an editor's add for another member's new device → 409 …"`, add exactly:

```ts
  test("a member whose end date has passed (before the hourly cron ends it) is not a target and cannot read or post keys", async () => {
    const w = await world();
    await w.db.prepare("UPDATE memberships SET ends_at = ? WHERE group_id = 'g1' AND user_id = 'u2'").bind(NOW).run();
    const devices = await (await appFor(userOf("u1")).request(DEVICES_PATH, {}, { DB: w.db })).json();
    expect((devices as { devices: { id: string }[] }).devices.map((x) => x.id).sort()).toEqual(["acct_u1", "dev_u1"]);
    const res = await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2, ["acct_u1", "dev_u1"]) });
    expect(res.status).toBe(201);
    expect((await appFor(userOf("u2")).request(DEVICES_PATH, {}, { DB: w.db })).status).toBe(404);
    expect((await appFor(userOf("u2")).request(`${PATH}?device=dev_u2`, {}, { DB: w.db })).status).toBe(404);
    const late = { key_version: 2, envelopes: [await envelope(w.d.dev_u2!, w.d.acct_u2!, 2)] };
    expect((await post(w, "u2", w.d.dev_u2!, late)).status).toBe(404);
  });
```

### 4. The invite token comment (b67#10)

`packages/contracts/src/groups.ts`: replace the comment above `InviteTokenSchema` with, exactly:

```ts
// What the invitee gets: 32 random bytes as 43 base64url characters. The server only ever stores the SHA-256 of those
// 43 characters (as UTF-8 text, not of the decoded bytes), in lowercase hex.
```

(Both sides already do this: `platform/groups.ts` `createInvite` and `groups/routes.ts` hash the text.)

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api 1,011 = 1,007 + 4; contracts unchanged), `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Not in this PR

- Refusing a device's removal of itself while other devices remain (b5#3: skipped; `docs/security.md` section 12).
- Closing a removed device's group sockets (b67#7: skipped).

---

## H12 · The zero-retention switch is signed

Branch `fix/h12-signed-zero-retention`. From `main` at `ac25265`. No dependency, no migration. Files, and no others:

- `apps/api/src/privacy/routes.ts`, `apps/api/test/privacy.test.ts`, `apps/api/test/helpers/signing.ts` (one optional field)
- `packages/api-client/src/client.ts` (one line), `packages/api-client/test/client.test.ts`
- `apps/mobile/src/platform/privacy.ts`

**Why (b01#8).** `PUT /v1/settings/zero-retention` needs only a session. Removing a device does not end its Clerk session (R13), so a lost or removed phone, or any leaked session, can turn a Plus user's zero retention off without them knowing (the app shows what it last set, open question 47). Every later cloud task then goes to standard-retention routes. The other writes that change what happens to a person's data or money are already signed (security.md section 15). The app's Plus users have an approved device, so nothing changes for them.

`apps/api/src/privacy/routes.ts`:

- Add `import { requireDeviceSignature } from "../auth/signature.ts";` after the `hono` import.
- Replace `.put("/v1/settings/zero-retention", idempotent(deps), async (c) => {` with, exactly:

```ts
    // Signed (docs/security.md section 15): a session alone, such as one left on a removed or lost device, cannot turn
    // the person's zero retention off.
    .put("/v1/settings/zero-retention", requireDeviceSignature(deps), idempotent(deps), async (c) => {
```

`apps/api/test/helpers/signing.ts`: `signedInit` takes an optional raw body, so a test can sign a body that is not JSON. Replace its first lines, up to and including the `const bodyText = …` line, with exactly:

```ts
  request: { method: string; path: string; body?: unknown; rawBody?: string; now: number; nonce?: string; as?: string; idempotencyKey?: string },
): Promise<RequestInit> {
  // rawBody: sent and signed exactly as given (a body that is not JSON).
  const bodyText = request.rawBody ?? (request.body === undefined ? "" : JSON.stringify(request.body));
```

`apps/api/test/privacy.test.ts`:

- Add `import { insertDevice, makeTestDevice, signedInit } from "./helpers/signing.ts";` after the `./helpers/d1.ts` import.
- After `const OWN: SessionUser = …;`, add `const PHONE = await makeTestDevice("phone_u1");`.
- In `fixture`, before `for (const row of rows) {`, add `await insertDevice(db, PHONE, { userId: "u1" });`.
- Replace `put` with, exactly:

```ts
// Signed by u1's approved phone, as every call from the app is.
async function put(app: ReturnType<typeof setup>, env: { DB: ReturnType<typeof createTestDb> }, body: string, key: string) {
  const init = await signedInit(PHONE, { method: "PUT", path: "/v1/settings/zero-retention", rawBody: body, now: NOW, idempotencyKey: key });
  return app.request("/v1/settings/zero-retention", init, env);
}
```

- Before the test `"the same key and body twice gives the stored reply with Idempotent-Replayed: true"`, add exactly:

```ts
  test("without a device signature (a session alone) gets 401 and the column is unchanged", async () => {
    const db = await fixture();
    await db.prepare("UPDATE users SET zero_retention = 1 WHERE id = 'u1'").run();
    const res = await setup(PLUS).request(
      "/v1/settings/zero-retention",
      { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": "key-unsigned-00001" }, body: '{"enabled":false}' },
      { DB: db },
    );
    expect(res.status).toBe(401);
    expect(await zeroRetentionColumn(db, "u1")).toBe(1);
  });
```

`packages/api-client/src/client.ts`: `setZeroRetention` becomes, exactly:

```ts
      json({ method: "PUT", target: "/v1/settings/zero-retention", body: { enabled }, signing: "device", retry: true }, ZeroRetentionResponseSchema),
```

`packages/api-client/test/client.test.ts`:

- The tests `"409 without retry_after (another request with this key) is thrown at once"` and `"network errors and 5xx retry up to 3 attempts with backoff, same key"` use `setZeroRetention`, so each gets a signer. Add `const signer = softwareSigner("dev_phone");` as its first line and pass `{ device: () => signer }` as the second argument of `fakeApi(…)`.
- In `describe("device signatures")`, before `"signs method, path, device, timestamp, nonce and body hash"`, add exactly:

```ts
  it("the zero-retention switch is signed by the device", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent } = fakeApi([jsonReply(200, { zero_retention: false })], { device: () => signer });
    await client.setZeroRetention(false);
    expect(header(sent[0]!, "Waypoint-Device")).toBe("dev_phone");
    expect(await verifySent(sent[0]!, signer.publicKey)).toBe(true);
  });
```

`apps/mobile/src/platform/privacy.ts`:

- Add `import { requireApprovedDevice } from "./device.ts";` after the `./db.ts` import.
- Replace the comment above `setZeroRetention` and its first line with, exactly:

```ts
// PUT /v1/settings/zero-retention (PR 32). Plus only; the server answers 403 plan_required otherwise. Signed by this
// iPhone (H12), so it needs an approved device; otherwise the screen that explains why opens.
export async function setZeroRetention(enabled: boolean): Promise<SwitchResult> {
  if (!requireApprovedDevice()) return "failed";
```

`docs/security.md` section 15 and `docs/architecture.md` section 4 already list the route as signed (changed in this planning pull request).

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api 1,008 = 1,007 + 1; api-client 48 = 47 + 1; mobile unchanged), `npm run bundle -w @waypoint/api`, `npm run export:ios -w @waypoint/mobile`. Paste the last lines of each.

### Device check (once Xcode is installed)

As a Plus user on an approved iPhone, turn zero retention on and off in Settings › Cloud: both work. On a waiting iPhone, the switch opens the "waiting for approval" screen.

### Not in this PR

- A read route for the switch (open question 47).

---

## H13 · App: the first device keeps its account key, other people's purchases stay unfinished, recordings are never lost from view

Branch `fix/h13-registration-store-recording`. From `main` at `ac25265`. No dependency, no migration. Files, and no others:

- `apps/mobile/src/core/device/registration.ts`, `apps/mobile/src/platform/device.ts`, `apps/mobile/test/registration.test.ts`
- `apps/mobile/src/core/store/products.ts`, `apps/mobile/test/products.test.ts`
- `apps/mobile/src/platform/transcription.ts`
- `apps/mobile/src/features/capture/useRecording.ts`

### 1. A 409 drops the account key only when another device won (b67#2)

**Why.** The first iPhone makes the account key and registers with it. On **any** 409 it deletes that key and registers as waiting. But the API client retries `POST /v1/devices` on a lost reply with the same Idempotency-Key, and a retry that meets our own request still running gets 409 "request in progress" (on the last attempt it is thrown). The registration then succeeds on the server while the iPhone deletes the only copy of the account key. It cannot recover (no recovery key yet), and every group key wrapped for the account row is lost with it. The server's list says who won; the message does not matter.

`apps/mobile/src/core/device/registration.ts`: before `// The name the server stores`, add exactly:

```ts
// After a 409 from registering as the first device: true only when the server holds another account key (another
// device became the first one), so ours must be dropped. A 409 can also be our own registration, still in progress
// ("request in progress") or already done; then the list shows our key, or no account row yet, and ours is kept.
export function accountKeyLost(devices: DeviceView[], accountSignPub: string): boolean {
  const account = devices.find((d) => d.kind === "account");
  return account !== undefined && account.sign_pub !== accountSignPub;
}
```

`apps/mobile/src/platform/device.ts`:

- Import `accountKeyLost` from `../core/device/registration.ts` (the existing import line).
- In `register`, replace the `catch` of the first-device registration with, exactly:

```ts
    } catch (error) {
      if (!(firstTry && error instanceof ApiCallError && error.status === 409)) throw error;
      // Another device became the first one meanwhile: drop our account key and register as waiting. Any other 409
      // (our own registration still in progress, or already done) keeps it: the account key exists nowhere else.
      if (accountKeyLost((await api.devices()).devices, account.signPub)) await deleteAccountKey(user);
      return register(clerkUserId, false);
    }
```

The second pass (`firstTry` false) then finds our device approved (`planRegistration`), or, while our request is still running, tries once more and leaves "failed" for the next refresh. In both cases the key is kept.

`apps/mobile/test/registration.test.ts`: import `accountKeyLost` as well, and before `describe("names and keys", …)` add exactly:

```ts
describe("accountKeyLost", () => {
  it("only another account key on the server means ours is lost", () => {
    expect(accountKeyLost([ACCOUNT, row({})], KEY_A)).toBe(false); // ours went through
    expect(accountKeyLost([], KEY_A)).toBe(false); // ours is still in progress
    expect(accountKeyLost([ACCOUNT, row({})], KEY_B)).toBe(true); // another device's
    expect(accountKeyLost([row({ sign_pub: KEY_B })], KEY_A)).toBe(false); // a device row is not the account key
  });
});
```

### 2. Another account's purchase is left unfinished (b89#6)

**Why.** StoreKit's unfinished transactions belong to the iPad's Apple ID, not to the Waypoint account signed in. On a shared family iPad, child A buys a pack (a parent pays) and the reply is lost. Child B signs in, and the app sends A's transaction under B. The server answers 409 "purchase belongs to another account" (it checks `appAccountToken`), and the app **finishes** it, so A never receives the credits. Left unfinished, StoreKit offers it again at each launch, and it reaches A's account when A signs in on that iPad.

`apps/mobile/src/core/store/products.ts`: replace `shouldFinish` and its comment with, exactly:

```ts
// Finish (tell StoreKit we are done) only when the server has decided for this person. "invalid" stays unfinished so it
// can be looked at (for example a sandbox purchase sent to a production server); "retry_later" is sent again on the
// next launch. "other_account" stays unfinished too: on a shared iPad it can be another person's purchase whose reply
// was lost, and it must still reach their account when they sign in here again.
export function shouldFinish(outcome: SendOutcome): boolean {
  return outcome === "granted" || outcome === "refunded";
}
```

`apps/mobile/test/products.test.ts`: in `"outcomes and finishing"`, replace the `for (const outcome of ["granted", "other_account", "refunded"] …` line with, exactly:

```ts
    for (const outcome of ["granted", "refunded"] as const) expect(shouldFinish(outcome)).toBe(true);
    expect(shouldFinish("other_account")).toBe(false);
```

### 3. Crash recovery runs without the speech pack (b3#5)

**Why.** `recoverSessions` (a recording cut off by a crash or a kill becomes `interrupted`) runs inside the transcription queue's tick, after the speech-pack check. On an iPhone without the pack, or one that cannot have it, a cut-off recording stays `recording` for ever, and lists show only saved and interrupted sessions, so it is never seen again.

`apps/mobile/src/platform/transcription.ts`: replace the start of `tick`, from `async function tick(): Promise<void> {` to the closing `}` of `if (!recovered) { … }`, with exactly:

```ts
async function tick(): Promise<void> {
  if (ticking || AppState.currentState !== "active") return;
  ticking = true;
  try {
    if (getRecorderStatus().state !== "idle") return;
    // First, with or without a speech pack: a recording cut off by a crash or a kill becomes interrupted (and shows in
    // its space) on every iPhone, also one that cannot transcribe.
    if (!recovered) {
      writeDb((db) => recoverSessions(db, getRecorderStatus()));
      recovered = true;
    }
    if (packMissing || (await getSpeechStatus()).pack !== "installed") return;
```

The `for (const session of pendingTranscriptions(…))` loop and the rest stay. (H15 makes interrupted sessions searchable.)

### 4. The record screen stops and saves when it goes away (b3#6)

**Why.** The record screen is inside the signed-in group of `_layout.tsx`. If the session ends while recording (the gate drops to sign-in), the screen unmounts, but nothing stops the native recorder: the microphone keeps running with no screen to stop it, and the next recording gets `busy`.

`apps/mobile/src/features/capture/useRecording.ts`: before `// Keeps the clock moving while recording.`, add exactly:

```ts
  // The screen can go away while recording without Stop being tapped (the session ended and the app went back to
  // sign-in). Then the recording is stopped and saved here, so the microphone does not run on with nothing to stop it.
  useEffect(
    () => () => {
      const current = sessionRef.current;
      if (current === null || stoppingRef.current) return;
      stoppingRef.current = true;
      stopRecording().then(
        (recordedMs) =>
          writeDb((db) => {
            if (brokeRef.current) db.run("UPDATE sessions SET transcript = 'waiting' WHERE id = ? AND transcript = 'live'", [current.id]);
            finishRecording(db, current.id, Date.now(), recordedMs);
          }),
        () => undefined, // never started, or already stopped: the next launch's recoverSessions marks it interrupted
      );
    },
    [],
  );
```

A normal Stop sets `stoppingRef` before it navigates away, so this does nothing then.

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (mobile 443 = 442 + 1; `products.test.ts` changes one assertion), `npm run export:ios -w @waypoint/mobile`. Paste the last lines of each.

### Device checks (once Xcode is installed)

- Delete the app's data on the iPhone and sign in with a new account while the network is slow (Network Link Conditioner, "Very Bad Network"): the iPhone ends approved, Settings › Devices shows no account key problem, and the recovery key screen opens.
- With a sandbox tester, buy a pack, turn on Airplane Mode before the reply arrives, kill the app, sign in as another account, turn the network on: no credits for the second account, and the transaction is still unfinished (Xcode's StoreKit transaction manager). Sign in as the first account: it gets the credits and the transaction is finished.
- Start a recording on an iPhone without the speech pack, kill the app from the app switcher, reopen: the session shows as interrupted in its space.
- Start a recording, then end the session from the Clerk dashboard (or sign out on another device for the same session) and bring the app to the front: the app goes to sign-in, the microphone indicator goes off, and after signing in again the recording is saved.

### Not in this PR

- One database per person on a shared iPhone (b01#1, open question 52).
- The server's "device id taken" message for two first devices at once (b5#10: the app no longer reads it).

---

## H14 · Native: `stop()` waits for the last final words

Branch `fix/h14-last-words`. From `main` at `ac25265`. No dependency. Files, and no others:

- `apps/mobile/modules/waypoint-audio/ios/LiveTranscriber.swift`
- `apps/mobile/modules/waypoint-audio/ios/WaypointAudioModule.swift`

**Why (b3#4).** On Stop, `AudioRecorder.stop()` ends the run, and `LiveTranscriber.runEnded()` starts `finalizeAndFinishThroughEndOfInput()` in a detached `Task` and returns. The module's `stop` resolves at once, `useRecording` saves the session as finished (`transcript = 'done'`) and leaves the screen, and its listeners are removed. The analyzer's last final results (the last sentence or two) arrive after that and are dropped. The session is marked done, so the queue never transcribes them either. The fix keeps a handle on the run's results loop, and `stop` waits until that loop has sent its last words, at most 5 s.

`LiveTranscriber.swift`:

- After the `continuation` property, add exactly:

```swift
  private var results: Task<Void, Never>?           // lock: the running run's results loop
  private var finishing: Task<Void, Never>?         // lock: the last ended run, until its final words are sent
```

- In `runStarted`, after `let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()`, the rest of the function becomes, exactly:

```swift
    Task {
      do { try await analyzer.start(inputSequence: stream) } catch { self.speechFailed(sessionId, error) }
    }
    let results = Task {
      do {
        if let t = module as? SpeechTranscriber {
          for try await result in t.results {
            self.emit(sessionId, runStartMs, result.text, result.range, result.isFinal)
          }
        } else if let d = module as? DictationTranscriber {
          for try await result in d.results {
            self.emit(sessionId, runStartMs, result.text, result.range, result.isFinal)
          }
        }
      } catch {
        self.speechFailed(sessionId, error)
      }
    }
    lock.withLock {
      self.analyzer = analyzer
      self.converter = converter
      self.continuation = continuation
      self.results = results
    }
  }
```

(The `lock.withLock` that stored `analyzer`, `converter` and `continuation` moves below the two tasks, so it can store `results` too. `runStarted` runs before the tap is installed, so no buffer is missed.)

- Replace `runEnded()` with, exactly:

```swift
  func runEnded() {
    let (analyzer, continuation, results) = lock.withLock { (self.analyzer, self.continuation, self.results) }
    continuation?.finish()
    // Done once the analyzer has finished the input and the results loop has sent the last final words.
    let finishing = Task {
      if let analyzer { try? await analyzer.finalizeAndFinishThroughEndOfInput() }
      await results?.value
    }
    lock.withLock {
      self.analyzer = nil
      self.converter = nil
      self.continuation = nil
      self.results = nil
      self.finishing = finishing
    }
  }

  /// Waits until the last ended run's final words have been sent as onTranscript events, at most `seconds`.
  /// stop() calls it before it resolves, so the app still listens when the last words arrive.
  func waitForFinals(seconds: Double) async {
    guard let finishing = lock.withLock({ self.finishing }) else { return }
    await withTaskGroup(of: Void.self) { group in
      group.addTask { await finishing.value }
      group.addTask { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
      await group.next()
      group.cancelAll()
    }
  }
```

`WaypointAudioModule.swift`: replace the `stop` function with, exactly:

```swift
    AsyncFunction("stop") { () async throws -> Double in
      let recordedMs = try self.recorder.stop()
      await self.transcriber.waitForFinals(seconds: 5) // the last words reach the app before the recording screen closes
      return recordedMs
    }
```

Pause is unchanged: it also ends the run, and the screen keeps listening while paused.

### Checks

Root `npm install`, `npm run typecheck`, `npm test`, `npm run test:swift -w @waypoint/mobile` (57, unchanged), and `swiftc -parse LiveTranscriber.swift WaypointAudioModule.swift` in `apps/mobile/modules/waypoint-audio/ios`. `SpeechAnalyzer` needs the iOS 26 SDK, so the first full type check is the Xcode build. Paste the last lines of each.

### Device check (once Xcode is installed)

Record yourself reading a paragraph, and tap Stop **while** saying the last sentence, then again 1 s after it. Both times the session's transcript ends with that last sentence. Stop takes under a second longer than before. With no speech pack installed, Stop is as fast as before.

### Not in this PR

- Waiting for final words on pause (the screen is still listening then).

---

## H15 · App search: interrupted sessions, text written during indexing, moved sessions

Branch `fix/h15-search`. From `main` at `ac25265`. No dependency, no migration. Files, and no others:

- `apps/mobile/src/core/search/indexer.ts`, `apps/mobile/test/indexer.test.ts`
- `apps/mobile/src/core/search/query.ts`, `apps/mobile/test/query.test.ts`

**Why.**
- b2#3: `sessionsToIndex` and `indexStatus` count only `state = 'saved'`. A recording cut off by a crash becomes `interrupted` (H4a), gets its words from the queue, and is never searchable.
- b3#2: `indexSession` reads the text, embeds it (seconds, with the on-device model), then writes only if `indexed_at` did not change. A session waiting to be indexed already has `indexed_at` `NULL`. Text written during the embedding (the transcription queue's segments, a page's found text) leaves it `NULL`, so the old text is written, `indexed_at` is set, and the new text is never indexed. The fix compares what was read inside the transaction.
- b2#4: the vector cache stores each chunk's space, and only `indexSession` clears it. After a session moves (Space picker, M30b, a sync from another device), a search in one space finds it by meaning in its old space and not in its new one, until the next index run. Reading each chunk's space when the search runs is cheap (ids only, no vectors) and covers every way a session can move.

`apps/mobile/src/core/search/indexer.ts`:

- Replace `sessionsToIndex` and its comment with, exactly:

```ts
// Finished sessions (saved, or interrupted by a crash and recovered) that have not been indexed yet, oldest first.
export function sessionsToIndex(db: SqlDb, limit: number): string[] {
  return db
    .all<{ id: string }>(
      "SELECT id FROM sessions WHERE state IN ('saved', 'interrupted') AND indexed_at IS NULL ORDER BY started_at ASC LIMIT ?",
      [limit],
    )
    .map((row) => row.id);
}
```

- In `indexSession`, replace the two reads (`const segments = …` and `const captures = …`) with, exactly:

```ts
  const read = () => ({
    segments: db.all<{ tStart: number; tEnd: number; text: string }>(
      "SELECT t_start AS tStart, t_end AS tEnd, text FROM segments WHERE session_id = ? AND source = 'device' ORDER BY t_start",
      [sessionId],
    ),
    captures: db.all<{ id: string; kind: "page" | "photo"; t: number; found_text: string | null }>(
      "SELECT id, kind, t, found_text FROM captures WHERE session_id = ? AND kind IN ('page', 'photo') ORDER BY t, position",
      [sessionId],
    ),
  });
  const { segments, captures } = read();
  // What was read, to compare inside the transaction: text written while the embedder ran (a transcription, a page)
  // leaves indexed_at as it was, so only this comparison notices it.
  const seen = JSON.stringify({ segments, captures });
```

- In the transaction, replace `if (!after || after.indexed_at !== before.indexed_at) return;` with, exactly:

```ts
    // Changed meanwhile: nothing is written and indexed_at stays as it was, so the next pass indexes the new text.
    if (!after || after.indexed_at !== before.indexed_at || JSON.stringify(read()) !== seen) return;
```

- In `indexStatus`, the first two counts become, exactly:

```ts
    sessions: count("SELECT count(*) AS n FROM sessions WHERE state IN ('saved', 'interrupted')"),
    indexed: count("SELECT count(*) AS n FROM sessions WHERE state IN ('saved', 'interrupted') AND indexed_at IS NOT NULL"),
```

`apps/mobile/src/core/search/query.ts`:

- Replace `CachedVector`, the comment above `vectorCache`, and the body of `vectorsFor` after its cache check, so they read, exactly:

```ts
type CachedVector = { chunkId: number; vector: StoredVector };

// Loaded vectors, keyed by model_version. indexSession clears it after writing. A chunk's space is read at query time,
// not cached, so moving a session (or deleting one) needs no clear.
const vectorCache = new Map<string, CachedVector[]>();
```

```ts
  const rows = db.all<{ chunk_id: number; scale: number; vector: Uint8Array }>(
    "SELECT chunk_id, scale, vector FROM search_index WHERE model_version = ?",
    [modelVersion],
  );
  const loaded = rows.map((r) => ({ chunkId: r.chunk_id, vector: { scale: r.scale, bytes: r.vector } }));
```

- In `searchNotes`, after `const q = quantize(queryVector);`, add the map and change the first filter, so it reads, exactly:

```ts
    const q = quantize(queryVector);
    // Each chunk's space as it is now; a chunk whose session is gone has none.
    const spaceOf = new Map(
      db.all<{ id: number; space_id: string }>("SELECT c.id, s.space_id FROM chunks c JOIN sessions s ON s.id = c.session_id").map((r) => [r.id, r.space_id]),
    );
    vectorIds.push(
      ...vectorsFor(db, embedder.modelVersion)
        .filter((c) => spaceOf.has(c.chunkId) && (spaceId === null || spaceOf.get(c.chunkId) === spaceId) && c.vector.bytes.length === q.bytes.length)
```

The rest of the chain (`.map`, the similarity filter, sort, slice) is unchanged.

`apps/mobile/test/indexer.test.ts`:

- `addSession`'s `state` parameter type becomes `"saved" | "recording" | "interrupted"`.
- Before the test `"markStale flags a session whose vectors came from another model version"`, add exactly:

```ts
  it("an interrupted session (a recording cut off by a crash) is indexed and counted like a saved one", () => {
    addSession("saved-one", "saved", 100, ["a"]);
    addSession("cut-off", "interrupted", 50, ["b"]);
    expect(sessionsToIndex(db, 3)).toEqual(["cut-off", "saved-one"]);
    expect(indexStatus(db, "test-1")).toMatchObject({ sessions: 2, indexed: 0 });
  });

  it("text written while the embedder runs (indexed_at still NULL) is not lost: nothing is written and the session stays to index", async () => {
    addSession("s1", "saved", 100, ["supply and demand"]);
    const embedder: Embedder = {
      modelVersion: "test-1",
      embed: async (texts) => {
        db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', 5000, 5900, 'photosynthesis', 'device')");
        return texts.map(() => [1, 0, 0]);
      },
    };
    expect(await indexSession(db, embedder, "s1", 6000)).toBe(0);
    expect(sessionsToIndex(db, 3)).toEqual(["s1"]);
    expect(await indexSession(db, fakeEmbedder(vectors), "s1", 7000)).toBe(1);
    expect(db.all("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'photosynthesis'")).toHaveLength(1);
  });
```

`apps/mobile/test/query.test.ts`: add `import { moveSession } from "../src/core/capture/sessions.ts";` after the `query.ts` import, and before the test `"returns at most limit hits"` add exactly:

```ts
  it("a session moved to another space after the vectors were loaded is found by meaning in its new space only", async () => {
    addSession("shop", "space-1", "Shopping", ["price of goods"]);
    const table = { "price of goods": [1, 0, 0], supply: [1, 0, 0] };
    await indexSession(db, fakeEmbedder(table), "shop", 5000);
    await searchNotes(db, fakeEmbedder(table), "supply", {}); // loads the cache
    moveSession(db, "shop", "space-2", 6000);
    expect((await searchNotes(db, fakeEmbedder(table), "supply", { spaceId: "space-2" })).map((h) => h.sessionId)).toEqual(["shop"]);
    expect(await searchNotes(db, fakeEmbedder(table), "supply", { spaceId: "space-1" })).toEqual([]);
  });
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (mobile 445 = 442 + 3), `npm run export:ios -w @waypoint/mobile`. Paste the last lines of each.

### Not in this PR

- A version counter on session text (the comparison above does the same job with no migration).

---

## H16 · App groups and sync: version 1 only from the creator, recovery reads the account row again, the space-delete test

Branch `fix/h16-group-keys-sync`. From `main` at `ac25265`. No dependency, no migration. Files, and no others:

- `apps/mobile/src/core/groups/keys.ts`, `apps/mobile/test/group-keys.test.ts`
- `apps/mobile/src/platform/groups.ts`, `apps/mobile/src/platform/recovery.ts` (one comment)
- `apps/mobile/test/sync.test.ts`

### 1. Only the creator makes version 1 (M28b #121)

**Why.** `createGroup` makes the version 1 key, locks the group's name with it, creates the group on the server, and only then posts its envelopes. Another device of the same person that syncs in between sees a group whose current version nobody holds, waits its random 0 to 30 s, and if the creator has still not posted, makes a different version 1 first set and wins. The creator's `add` then gets 409, and it keeps its own key: two version 1 keys, and the name can be opened only with the creator's. Version 1 always exists on the creator's device, so no one else ever needs to make it.

`apps/mobile/src/core/groups/keys.ts`: replace the first lines of `planKeys`, up to and including `if (nobody && !holdsCurrent) {`, with exactly:

```ts
// keyVersion: the group's current version. Version 1 is made only by the group's creator, who locked the group's name
// with it: another device making its own version 1 (it saw the group before the creator's envelopes arrived) would
// leave two different keys, and the name readable only with the creator's.
export function planKeys(input: { targets: Target[]; me: { userId: string; role: "owner" | "editor" | "viewer" }; keyVersion: number; holdsCurrent: boolean; known: Record<string, string>; verify: CertCheck }): KeyPlan {
  const { targets, me, keyVersion, holdsCurrent, known, verify } = input;
  const nobody = targets.every((t) => !t.has_current_key);
  if (nobody && !holdsCurrent) {
    if (keyVersion === 1) return { kind: "none" };
```

`apps/mobile/src/platform/groups.ts`, `ensureKeys`: in the `planKeys({ … })` call, add `keyVersion,` after `me: { userId: user, role: group.role },`.

`apps/mobile/test/group-keys.test.ts`: in each existing `planKeys({ … })` call (five of them), add `keyVersion: 2, ` before `holdsCurrent:`. Before `it("versionsFor and the delay", …)`, add exactly:

```ts
  it("version 1 is never made by anyone but the creator, even when nobody holds it yet", () => {
    expect(planKeys({ targets: [mine, t({})], me: { userId: "usr_me", role: "owner" }, keyVersion: 1, holdsCurrent: false, known, verify })).toEqual({ kind: "none" });
    expect(planKeys({ targets: [mine, t({})], me: { userId: "usr_me", role: "owner" }, keyVersion: 1, holdsCurrent: true, known, verify })).toEqual({ kind: "add", recipients: [mine, t({})] });
  });
```

`docs/security.md` section 10 already says this (changed in this planning pull request).

### 2. A recovery whose group keys failed is completed later (M28b #121)

**Why.** After recovery with the words, `recoverGroupKeys` reads each group's envelopes for the **account row** once. If that fails (offline, one bad group), nothing reads them again: `syncGroups` reads only this device's envelopes. When the person is the only owner, no other member may add envelopes for their new device (H2), so the group stays locked on that iPhone for good. Also, one failing group in `syncGroups` stopped the loop for the groups after it.

`apps/mobile/src/platform/groups.ts`:

- Replace the comment above `recoverGroupKeys` with, exactly:

```ts
// After a recovery with the words: open the group keys the account row holds, then wrap them for this iPhone.
// A group whose keys fail is skipped here; syncGroups reads the account row's envelopes again for it.
```

- Replace the comment above `syncGroups` and its `try` block, up to (not including) its `} catch {`, with exactly:

```ts
// Refreshes the groups and brings their keys up to date. One run at a time; a failed run is retried on the next one,
// and a failed group does not stop the others.
async function syncGroups(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    await refreshGroups();
    const user = currentUserId();
    const account = user === null ? null : getAccountKey(user);
    for (const g of listGroups(getDb())) {
      try {
        // A group with no key on this iPhone, which holds the account key: its keys may be waiting in the account row's
        // envelopes (a recovery whose first read failed). Read those first; ensureKeys then wraps them for this iPhone.
        if (user !== null && account !== null && g.leftAt === null && heldGroupKeyVersions(user, g.id).length === 0) {
          await readGroup(user, g.id, account.accountId);
        }
        await ensureKeys(g.id, { now: false });
      } catch {
        // This group is tried again next time.
      }
    }
```

A group this iPhone holds no key for makes one extra `GET …/keys?device=<account row>` per sync, until a key arrives.

`apps/mobile/src/platform/recovery.ts`: the comment above `await recoverGroupKeys(…)` becomes, exactly:

```ts
    // The group keys come back through the account row. A failure here is not a failed recovery: syncGroups reads the
    // account row's envelopes again for any group this iPhone still has no key for.
```

### 3. A delete of a space is refused (M29a #122, test only)

`applyChange` refuses `delete spaces` (`core/sync/changes.ts`). Without that line the delete runs SQL against a table with no `session_id` and throws ("no such column: x.session_id"), which would stall the pull. Nothing pins it.

`apps/mobile/test/sync.test.ts`: before the test `"a space's name lands on the mapped space, cut to 60 characters"`, add exactly:

```ts
  it("a delete of a space is refused and changes nothing", () => {
    const b = device("b");
    const change: SyncChange = { v: 1, id: "dsp_000000000000000", at: 10, op: "delete", table: "spaces", row_id: b.space.id };
    expect(applyChange(b.db, G, change, "dev_a")).toBe("rejected");
    expect(count(b, "spaces")).toBe(2);
    expect(count(b, "row_versions")).toBe(0);
  });
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (mobile 444 = 442 + 2), `npm run export:ios -w @waypoint/mobile`. Paste the last lines of each.

### Device check (two iPhones of the same person; once Xcode is installed)

- On iPhone A, make a shared space while iPhone B is open on the spaces list with a slow network on A (Network Link Conditioner). Both iPhones show the space's name, and a note written on B opens on A.
- On iPhone C, recover with the words while in Airplane Mode right after the words are accepted, then turn the network on and bring the app to the front: every group's notes open on C.

### Not in this PR

- Pre-join edits waiting in `sync_pending` (open question 56).

---

## H17 · Mini-app data scripts and the failed video row

Branch `fix/h17-mini-app-data-video-label`. From `main` at `ac25265`. No dependency, no migration. Files, and no others:

- `apps/mobile/src/core/made/miniAppHtml.ts`, `apps/mobile/test/miniAppHtml.test.ts`
- `apps/api/src/jobs/write.ts` (one prompt line)
- `apps/mobile/src/features/capture/SessionScreen.tsx` (one line)

### 1. Mini apps: data scripts stay data (M25c #119)

**Why.** Models often write a whole document: `<body onload="init()">` and a data block `<script type="application/json" id="data">…</script>`. The M25c sanitizer drops `<body>` with its attributes (by design: `body` is not on the allow-list), so `init()` never runs. It also runs **every** script through the loader, so the JSON block becomes JavaScript, which is a syntax error, and the data is lost. The re-check of #119 showed exactly this: the page showed only "before". It is not a safety problem. This change keeps M25c's invariant: every `<` in the output starts a tag the sanitizer chose, and no script text holds `<`. A JSON block is parsed and written again with `scriptJson` (which escapes `<`), under `type="application/json"` and its `id` only, and a browser never runs it. Script types a browser would not run (`text/babel`, `text/template`, …) are dropped instead of being run as JavaScript. The prompt tells the model about `<body>`.

`apps/mobile/src/core/made/miniAppHtml.ts`: replace the `script` branch of `rawElement`, and add the set above the function, so they read, exactly:

```ts
// Script types a browser runs as JavaScript (M25c review): only these are run, through the loader.
const SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

function rawElement(tag: Tag, text: string): string {
  if (tag.name === "script") {
    if (tag.attributes.some(([key]) => key === "src")) return "";
    const type = (tag.attributes.find(([key]) => key === "type")?.[1] ?? "").trim().toLowerCase();
    if (SCRIPT_TYPES.has(type)) return `<script>${RUN}(${scriptJson(text)})</script>`;
    // A JSON data block stays data: parsed and written again with "<" escaped, under its id. It never runs.
    if (type === "application/json") {
      const id = tag.attributes.find(([key]) => key === "id")?.[1];
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return "";
      }
      const attributes: [string, string][] = id === undefined ? [["type", "application/json"]] : [["type", "application/json"], ["id", id]];
      return `${openTag({ ...tag, attributes })}${scriptJson(value)}</script>`;
    }
    return ""; // any other type is data the page cannot use here
  }
```

The `style`, `textarea` and dropped raw-text branches after it are unchanged.

`apps/mobile/test/miniAppHtml.test.ts`: before the test `"drops scripts with src, styles holding <, comments and doctypes"`, add exactly:

```ts
  it("keeps a JSON data script as data under its id (never run), and drops other non-JavaScript types", () => {
    expect(sanitizeMiniApp('<script type="application/json" id="data" onload="x()">{"q": "a</script"}</script>')).toBe(
      '<script type="application/json" id="data">{"q":"a\\u003c/script"}</script>',
    );
    expect(sanitizeMiniApp('<script type="application/json">not json</script>')).toBe("");
    expect(sanitizeMiniApp('<script type="text/babel">x()</script>')).toBe("");
    expect(sanitizeMiniApp('<script type="text/javascript">x()</script>').startsWith("<script>(function(s){")).toBe(true);
  });
```

The file's property tests (parse5: only allowed elements, no `<` in any script text) still pass, and they now also cover the data blocks.

`apps/api/src/jobs/write.ts`: in `WRITE_SPECS.mini_app.system`, after the line that starts `"No iframes, objects, embeds or inline <svg> markup`, add exactly:

```ts
      "Attributes on <html> and <body> are removed, so start your code on DOMContentLoaded, not with <body onload>. Keep data in JavaScript variables.",
```

### 2. A failed video row says "video" (M24b #123)

`apps/mobile/src/features/capture/SessionScreen.tsx`: replace `overviewLabel` and its comment with, exactly:

```tsx
// A video row says "video" while it is made and when that failed; the other states keep the shared wording.
function overviewLabel(item: Overview): string {
  if (item.kind === "video" && (item.state === "script" || item.state === "rendering")) return "Making the video…";
  if (item.kind === "video" && item.state === "failed") return "Couldn't make the video";
  return OVERVIEW_STATE[item.state];
}
```

(`VideoScreen` already says "Couldn't make the video.")

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (mobile 443 = 442 + 1; api unchanged), `npm run export:ios -w @waypoint/mobile`, `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Device check (once Xcode is installed, with M25c's gate passed)

Open a mini app whose HTML has a JSON data block read with `JSON.parse(document.getElementById("data").textContent)`: it works. M25c's gate page still prints every line blocked, `frames: none`, `lockdown: on`.

### Not in this PR

- Keeping `class` or `style` on `<body>` (the prompt asks the model not to rely on them).
- Copy review of "Couldn't make the video" (open question 50).
