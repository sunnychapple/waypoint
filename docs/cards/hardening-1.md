# Hardening cards, round 1 (H1 to H6)

The should-fix items from the Sonnet reviews of the merged pull requests (#23 to #83), each checked against `main` at `856b81d` before a card was written. The product owner's rule: fix what is real, skip what is over-engineering. Every finding is in the table below with its verdict; the skipped ones say why in one line.

Verdicts: **FIX** (a code change, with tests), **TEST-ONLY** (the code is right, a test is missing), **SKIP** (not worth the change, reason given), **ALREADY FIXED** (a later pull request did it), **NOTE** (nothing to change now; the card named must do it when it is written).

Totals: 35 FIX, 30 TEST-ONLY, 11 SKIP, 6 ALREADY FIXED, 5 NOTE (87 rows; one review item can give a fix row and a test row).

## Verdicts

### Server

| Finding | What | Verdict | Card, or why |
|---|---|---|---|
| PR 29 #75 | a failed concurrent retry of the same blob id deletes the first upload's reservation; the final `UPDATE` is not checked, so the object stays in R2 counted nowhere and the upload answers 201 | FIX | H1 |
| PR 29 #75 | a reservation whose upload never finished counts against the 3 GB for ever | FIX | H1 (hourly cleanup after a day) |
| PR 29 #75 | `docs/build-plan.md` "Idempotency" lists blobs among the `idempotent()` writes | FIX | H1 (one line) |
| PR 23 #81 | audio parts can be replaced after `done` and `done` re-sent; the byte cap checks only the reported size | FIX | H1 (the cap counts the parts read; a second `done` is an ignored event, no change) |
| PR 23 #81 | tests: deadline, rounding down per minute, 300 s fallback | TEST-ONLY | H1 |
| PR 24 #83 | `isWebUrl` checks only the scheme (credentials, localhost, private and link-local addresses reach Browser Run) | FIX | H1 |
| PR 24 #83 | the deep test settles 40, not 125; `READ_CONCURRENCY` unpinned | TEST-ONLY | H1 |
| PR 19 #25 | a late `user.created` retry after `user.deleted` grants 25 credits again | SKIP | needs a Svix retry to land after the delete and gives what any new sign-up gets (25); not worth changing the wallet's command id |
| PR 17 #34 | Plus never ends at expiry; a re-sent expired receipt restores it | ALREADY FIXED | `applyTransaction` re-checks `expiresDate` on every call, and PR 18 ends the entitlement on `EXPIRED`, `GRACE_PERIOD_EXPIRED` and `DID_FAIL_TO_RENEW` |
| S1D #56 | two devices removing each other at once leave no approved device, an orphan account key and no recovery blob | FIX | H2, and `docs/security.md` section 12 |
| S1D #56 | tests: an already removed target, a left group not bumped, an account body in the last-device branch | TEST-ONLY | H2 |
| S2 #55 | any member, a viewer too, can fill another member's new device's envelope slot with a bad key | FIX | H2 (only an owner adds for another member's devices), and `docs/security.md` section 10 |
| S2 #55 | tests: add for non-targets, version-scoped count, all-or-nothing, the `GET` access checks | TEST-ONLY | H2 |
| S0A #23 | the key importers accept compressed and hybrid points | FIX | H2 |
| S0A #23 | test: `decodePublicKey`'s `0x04` check | TEST-ONLY | H2 |
| S0A #23 | test: `verifyP256`'s 64-byte guard | SKIP | WebCrypto refuses other lengths itself, so no test can tell the guard is there; the guard stays |
| S1C #52 | two approvals at once both answer 200 and the loser's envelopes are stored | FIX | H2 |
| S1C #52 | tests: a left group, another user's pairing, the unique-violation 409 | TEST-ONLY | H2 |
| S1B #44 | the 3-waiting-devices limit is read-then-insert | SKIP | it throttles pairing prompts; a race lets a few more through at once, each still needs the person to tap a matching code, and a malicious server ignores the limit anyway |
| S1B #44 | tests: off-curve `box_pub` and account keys, `can_approve` 0, a removed account row, `added_at` order, the waiting-count filters | TEST-ONLY | H3b |
| S3 #51 | the contracts test copies the vector blob | ALREADY FIXED | `packages/contracts/test/keys.test.ts` reads `waypoint-v1.json` |
| S3 #51 | tests: a second user, a removed account row in the join | TEST-ONLY | H3b |
| PR 13 #26 | the router model and gateway are not asserted | TEST-ONLY | H3a |
| PR 13 #26 | the 3 s abort path is untested | SKIP | a real 3 s wait in the suite for a line that only passes `AbortSignal.timeout`; H3a asserts the signal is passed |
| PR 16 #24 | tests: `available`, the `ended_at` boundary, the ledger's wallet lookup, an unbounded paging loop | TEST-ONLY | H3a |
| S0B #29 | tests: `makeEnvelope`'s signing input, `openResult`'s header check | TEST-ONLY | H3b |
| PR 32 #30 | tests: `PUT` changes only the caller's row, the `id DESC` tie-break | TEST-ONLY | H3a |
| S1A #37 | tests: nonce lifetime at the window edge, the query string, nonce cleanup per device | TEST-ONLY | H3b |
| PR 15 #43 | a concurrency test for more detail and double-check | SKIP | they share `tasks/instant.ts` with explain, whose concurrent test already covers the path |
| PR 20 #67 | tests: `DELETE` of another user's job leaves it alone, the result route's `succeeded` check | TEST-ONLY | H3a |
| PR 28 #68 | tests: `TARGETS_SQL`'s `left_at` and `kind`, `MAX_PAGE_BYTES` passed to the room | TEST-ONLY | H3b |
| PR 28 #68 | closing a removed member's sockets must land with PR 27 Part B | ALREADY FIXED | `groups/members.ts:57` calls `disconnect`; H3b adds the test that pins it |
| PR 22A #72 | tests: a cancelled job's input deleted, `result_key` cleared on failure, `bytes_sent` from the made result | TEST-ONLY | H3a |
| PR 21 #74 | test: the stream stops polling when the client goes | TEST-ONLY | H3a |
| PR 21 #74 | tests: `sameView`'s `spent`/`result_ready`, the user id inside the loop | SKIP | the two fields never change without `state` today, and the loop only reloads the job the first, user-scoped load found |
| PR 22B #76 | tests: the deadline clamp of the model call, the retry-on-bad-reply throw | TEST-ONLY | H3a |
| PR 25 #79 | the `mini_app` schema comment reads as a guarantee | FIX | H3a (comment only) |
| PR 25 #79 | test: a failed made job's row says `failed` | TEST-ONLY | H3a |
| PR 25 #79 | tests: price and tier per type in `write-made.test.ts` | SKIP | a job settles its quote; per-type prices and tiers are pinned by the pricing table and router route tests |
| PR 30 #78 | a missing `TURNSTILE_SECRET_KEY` makes every passcode link 403 | ALREADY FIXED | it is in "Owner setup", Cloudflare, Turnstile (`docs/build-plan.md`); failing closed is right |
| PR 33 #49 | cursor, `allSettled`, exact type check | ALREADY FIXED | fix round |
| PR 18 #48 | environment match, refund before grant | ALREADY FIXED | fix round |

### App and API client

| Finding | What | Verdict | Card, or why |
|---|---|---|---|
| M5 #36 | `AudioRecorder.swift:174,176` `try?` on part open and write: a full disk drops audio while the screen shows "recording" | FIX | H4a |
| M7 #38 | `PageLine.readingOrder` is not a strict weak order: a slanted page reads in an order that depends on input order | FIX | H4a |
| M7/M5 #38 #36 | `src/app/dev/*` routes are outside every `Stack.Protected`: they open before sign-in in release builds | FIX | H5c |
| M8 #40 | a card's source page is missed when its front spans a line break; all-blank units ask the model for `NaN` cards; dev screen skips `makeCardsFromUnits` | FIX | H5a |
| M9a #41 | an embedder error rejects `searchNotes` (keyword hits lost); an all-zero vector wedges a session forever; the vector cache is kept after a re-index that writes 0 chunks | FIX | H4b |
| M9b #45 | the search re-runs (and re-embeds) on every DB write; an embed error shows "Nothing found"; the first tap on a result only closes the keyboard | FIX | H4b |
| M10a #39 | "1 pages" on Home and Space screens | FIX | H5a |
| M10a #39 | VoiceOver cannot tell which space is selected in the picker | FIX | H5b |
| M10b #53 | a failed `startRecording` leaves a ghost "recording" session; the gap row appears only when the next part closes; interrupted sessions keep `recorded_ms` 0 and no `ended_at` | FIX | H4a |
| M10b #53 | tests: `'interrupted'` in `pendingTranscriptions`, `part.index` in `savePart` | TEST-ONLY | H4a |
| M10c #47 | "Add" in Your pages stacks a second Your pages; the alert shows raw native error text; the 22 pt × badge has no hit slop and deletes at once; `titleFromText` drops a word ending at character 60 | FIX | H4b |
| M10c #47 | surviving mutants: photos in `pagesToRead`, `movePage` clamp, `>= 3` letters, `<= 60` | TEST-ONLY | H4b |
| M6 #46 | `downloading` is one boolean, so overlapping downloads clear it early; `missed` is written and never read | FIX | H4a |
| M6 #46 | surviving mutants: segment touching a part's start edge, part of exactly 10 s | TEST-ONLY | H6 |
| M4 #31 | `COLLATE NOCASE` folds only A–Z: "Écologie" and "écologie" can both be created | FIX | H5b |
| M4 #31 | `useQuery` caches by version only: stale when `read` depends on a route param that changes | FIX | H5a |
| M4 #31 | untested constraints: `recorded_ms >= 0`, `dim > 0`, `t_start >= 0`, `captures.kind`, `cards.made_by`, `chunks.capture_id` cascade | TEST-ONLY | H6 |
| M1b #32 | Apple sign-in failure is silent | FIX | H5c |
| M1b #32 | gate rule-order test (rule 3 before rule 4) and a non-vacuous "signed-in wins over waitedMs" test | TEST-ONLY | H6 |
| M11a #54 | "1 cards due", "1 flashcards", "1 pages" | FIX | H5a |
| M11a #54 | due counts go stale while Home and Review stay mounted | FIX | H5a |
| M11a #54 | tapping Flashcards again on a session doubles its deck | FIX | H5a |
| M11a #54 | source chip should pass `?t=` | SKIP | the session screen shows no transcript yet, so there is nothing to jump to; the card that adds the transcript view adds `?t=` |
| M11a #54 | model availability read once per mount | SKIP | it only changes if Apple Intelligence is toggled while that screen is open; leaving and coming back reads it again |
| M11a #54 | tests: real `captureId`/`t`, `made_by` `quiz_miss`, `due_before` on a late review, `last_review`, `enable_fuzz`, cloud segments, page order | TEST-ONLY | H5a |
| M11b #58 | help opens with no step shown (`shown: 0`) | FIX | H5a |
| M11b #58 | two raw `SELECT`s in feature screens; `problemOf` untested | FIX | H5a |
| M12 #57 | Permissions screen does not refresh after coming back from iOS Settings | FIX | H5b |
| M12 #57 | inert rows announced as buttons; "Version 1.0.0 ()"; storage bar always full | FIX | H5b |
| M12 #57 | speech pack row not refreshed on app active | SKIP | the pack is not changed from iOS Settings; the focus refresh already covers coming back to the screen |
| M13 #71 | non-numeric `config_fetched_at` → `NaN` → `isStale` false forever | FIX | H5c |
| M27a #77 | any error other than 429 or a network error leaves "Setting up this iPhone" forever | FIX | H5c |
| M27a #77 | an expired pairing (10 min) strands a waiting iPhone (409 device id taken on re-register) | NOTE | M27b must restart pairing (new device id, new commitment) when the pairing has expired |
| M27a #77 | signer and in-flight `running` not keyed by user on sign-out | NOTE | M27b (shared-iPad sign-out): clear the signer on sign-out and key `running` by Clerk id; not reachable today (tabs unmount on sign-out, paid paths gated on status) |
| M27a #77 | copy: "credits" jargon, no hint of who can approve | SKIP | screen copy is a design check (open question 50); approval itself arrives with M27b |
| M26a #65 | surviving Swift mutants: envelope ct length / `0x04` / signer id, sealed purpose byte, pairing nonce length, recovery version / wrap lengths, key-version top byte, `PublicKeys.raw` prefix | TEST-ONLY | H6 |
| M3 #69 | vector test never checks the vector's own `signing_input` and `signature` | TEST-ONLY | H5c |
| M3 #69 | `readSse` keeps `\r` in event names on CRLF streams | FIX | H5c |
| M3 #69 | a stream cut mid-event throws `BadReplyError` instead of `NetworkError` | FIX | H5c |
| M14 #82 | `restorePurchases()` rejects when `AppStore.sync()` throws | NOTE | M17 (not built yet): its "Restore purchases" button must catch and show a plain message |
| PR 24 #83 | research answers may contain remote image URLs | NOTE | M19 must not load remote images in answers (render links as text) |
| PR 25 #79 | mini_app schema is not a defence | NOTE | M25 must render mini apps only in a network-blocked, storage-less web view, as a hard gate before any build shows one |
| M7 #38 | `groupBlocks` rule (d) (indent split), same-row exemption and median height untested | TEST-ONLY | H6 |
| M9a #41 | surviving mutants: `fuse` tie-break and `k`, `MIN_SIMILARITY`, `bm25` order, dimension filter, `EMBED_BATCH`, paragraph packing boundary, re-index rule | TEST-ONLY | H4b (query, indexer) and H6 (vectors, chunks) |
| M10a #39 | surviving mutants: `dateLine` offset, `usedLabel` future time | TEST-ONLY | H6 |

## Order

Every card branches from `main` at `856b81d` (or later) and is one sitting. They touch different files except where the last column says; on such a merge keep both sides' lines.

| Card | Branch | Area | Merge after |
|---|---|---|---|
| H1 | `fix/h1-money-jobs` | blobs, cleanup, second transcript, research | any time |
| H2 | `fix/h2-device-key-races` | device removal and approval, group key adds, key shape | any time |
| H3a | `test/h3a-server-tests` | tests: router, wallet, privacy, jobs, Workflows | any time |
| H3b | `test/h3b-server-tests` | tests: crypto formats, signatures, devices, recovery, sync, members | any time |
| H4a | `fix/h4a-recording` | recording, audio module, page reading order | any time |
| H4b | `fix/h4b-search-pages` | search, Your pages | any time |
| H5a | `fix/h5a-study` | study screens, plurals, `useQuery` | H4b (both touch `YourPagesScreen.tsx`, different lines) |
| H5b | `fix/h5b-settings` | settings, `Row`, space names | H4b (both touch `ui/kit.tsx`, different functions) |
| H5c | `fix/h5c-account-client` | sign-in, device setup, config, dev routes, `packages/api-client` | any time |
| H6 | `test/h6-mobile-tests` | tests only (Swift and TypeScript) | any time |

H2 changes the `BatchDb` type in `apps/api/src/storage.ts` (each batch result has `meta.changes`); `D1Database` and the test helper already fit it, and no other card touches that file.

## Notes for cards not written yet

- **M27b:** restart an expired pairing (a new device id and commitment); clear the signer on sign-out and key the in-flight `running` by Clerk id (not reachable today); when removing a device gets 409 "devices changed, try again" (H2), reload `GET /v1/devices` and ask again.
- **M28** (group keys): an add for another member's device is refused with 409 unless the caller is an owner (H2); a non-owner wraps only for its own devices and account row.
- **M17:** "Restore purchases" must catch `restorePurchases()` rejecting (`AppStore.sync()` throws) and show a plain message.
- **M19:** do not load remote images in research answers (an injected page could make the writer emit an image URL carrying the notes); show links as text.
- **M25:** show a mini app only in a web view with the network blocked, no storage, no bridge and no navigation; no build shows `mini_app` results before that exists. This is a hard gate.

---

## Server hardening cards (H1 to H3b)

These follow `AGENTS.md`, the wave 2 rules and "Conventions for the cards still to write" in `docs/build-plan.md`: files only where the card says, no `node:` imports in `apps/api/src`, tests through `app.request` with hand-made `env` objects, no network. Before opening the pull request run, from the repo root, `npm install`, `npm run typecheck`, `npm test` and `npm run bundle -w @waypoint/api`, and paste the last lines of each. No card adds a dependency or a migration.

Every block marked **exactly** in H1 and H2 was applied to `main` at `856b81d`, both cards together: `npm run typecheck`, every workspace's tests (API 966, crypto 55) and `npm run bundle -w @waypoint/api` passed, and each new test marked "fails today" was run against the old code and failed. Copy those blocks as they are. Code not marked "exactly" may differ in style, not in behaviour. H3a and H3b are tests only; their bullets say what to set up and what to assert.

---

## H1 · Server: blob uploads, the second-transcript audio cap, research URLs

Branch `fix/h1-money-jobs`. Builds on `main` at `856b81d`. Files, and no others:

- `apps/api/src/blobs/routes.ts`, `apps/api/test/blobs.test.ts`
- `apps/api/src/cleanup.ts`, `apps/api/test/cleanup.test.ts`
- `apps/api/src/jobs/retranscribe.ts`, `apps/api/test/retranscribe.test.ts`
- `apps/api/src/jobs/research.ts`, `apps/api/test/research.test.ts`
- `docs/build-plan.md` (one line, item 5)

### 1. An upload whose reservation vanished (PR 29, review of #75)

Now: upload A of blob id X is streaming (row `stored_at` NULL). A retry B of the same id passes the "same group, uploader and size" check (`routes.ts:52`), its `put` throws, and its cleanup (`routes.ts:83`) deletes A's reservation. A then finishes, `UPDATE blobs SET stored_at` (`routes.ts:91`) matches no row, and A answers 201: the object sits in R2, `GET` is 404, and it counts toward nobody's 3 GB.

In `src/blobs/routes.ts` replace the last two lines of the `POST` handler (`await db.prepare("UPDATE blobs SET stored_at = ? WHERE id = ?")...` and `return c.json(..., 201);`) with, exactly:

```ts
      // A failed retry of the same id may have deleted this upload's reservation meanwhile; then the file is counted
      // nowhere, so it is deleted and the app uploads it again.
      const done = await db.prepare("UPDATE blobs SET stored_at = ? WHERE id = ?").bind(now, blobId).run();
      if (done.meta.changes !== 1) {
        await bucket.delete(key);
        throw new ApiFailure("conflict", "upload interrupted, try again");
      }
      return c.json({ id: blobId, group_id: groupId, bytes }, 201);
```

### 2. Reservations of uploads that never finished (PR 29)

Now: if the Worker stops between the reservation and the end of the upload, the `stored_at IS NULL` row counts against the uploader's cap for ever.

In `src/cleanup.ts`, under `IDEMPOTENCY_ROWS_KEEP_MS`, add exactly:

```ts
// A blob reservation (PR 29) whose upload never finished: the Worker stopped between the reservation and the end of
// the upload. After a day it no longer counts against the uploader's media storage.
export const PENDING_BLOB_KEEP_MS = 24 * 60 * 60 * 1000;
```

Add `pending_blobs: number` to the return type of `cleanup`, and replace its `return` line with, exactly:

```ts
  const pendingBlobs = await env.DB.prepare("DELETE FROM blobs WHERE stored_at IS NULL AND created_at < ?").bind(now - PENDING_BLOB_KEEP_MS).run();
  return {
    results,
    tmp_audio: tmpAudio,
    tmp_input: tmpInput,
    idempotency: idempotency.meta.changes,
    request_nonces: nonces.meta.changes,
    pending_blobs: pendingBlobs.meta.changes,
  };
```

`runScheduled` in `src/index.ts` only awaits `cleanup`, so it does not change.

### 3. The audio cap counts the parts actually read (PR 23, review of #81)

Now: `makeTranscript` (`retranscribe.ts:54`) checks `MAX_AUDIO_BYTES_PER_MINUTE` against the byte count that `POST .../audio/done` reported. Parts can still be replaced with `PUT` until the Workflow's `start` step marks the job running, so a 1-minute job can have a 4 MiB part swapped in after `done` and Whisper transcribes all of it (Whisper cost, not credits; the charge stays capped at the quote).

In `makeTranscript`, right after `bytes += audio.length;`, add exactly:

```ts
    // The parts read, not the sizes POST .../audio/done reported: a part can be replaced until the job starts.
    if (bytes > quotedMinutes * MAX_AUDIO_BYTES_PER_MINUTE) return failed("no_upload");
```

Keep the early check on `uploaded.bytes` above the loop (it saves reading parts when the reported size is already too big).

### 4. Research reads only public web pages (PR 24, review of #83)

Now: `isWebUrl` (`research.ts:100`) checks only the scheme, so a search result such as `http://169.254.169.254/latest/meta-data`, `http://localhost:8080/admin` or `https://user:pw@a.example/` reaches Browser Run and its text reaches the model and the answer.

Replace `isWebUrl` with, exactly (it is now exported, for its own test):

```ts
// A public web page: http or https, no user name or password, and a host name with a dot that is not an IP
// address and not a local-only name. Search results are not trusted; Browser Run opens what this lets through.
export function isWebUrl(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // IPv6 literals keep their brackets; IPv4 literals (also 0x7f.1 or 2130706433) come out as dotted decimal.
  if (host.startsWith("[") || /^[0-9.]+$/.test(host) || !host.includes(".")) return false;
  return !/\.(localhost|local|internal|home\.arpa)$/.test(host);
}
```

### 5. The build plan's idempotency line (PR 29)

`docs/build-plan.md` line 1070 lists blobs among the writes that add `idempotent(deps)`; PR 29's route does not (a repeated upload is matched by its id). Replace `(jobs created and cancelled, groups, invites, links, blobs)` with `(jobs created and cancelled, groups, invites, links; not blobs, where a repeated upload is matched by its id)`. Change nothing else in that file.

### Tests

`test/blobs.test.ts`, before the test "a bucket that reports another size ...", exactly (fails today):

```ts
  test("the reservation deleted while the upload ran (a failed retry of the same id): 409 upload interrupted, and the object is deleted", async () => {
    const { db } = await world();
    const { bucket, objects } = memoryBucket();
    const racing: BlobBucket = {
      ...bucket,
      async put(key, value, options) {
        const stored = await bucket.put(key, value, options);
        await db.prepare("DELETE FROM blobs WHERE id = ? AND stored_at IS NULL").bind(BLOB).run();
        return stored;
      },
    };
    const res = await put(appFor("u1"), { DB: db, BUCKET: racing }, query(BLOB), bytesOf(100));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "upload interrupted, try again", retry_after: null });
    expect(objects.size).toBe(0);
    expect(await rowCount(db, "SELECT COUNT(*) AS n FROM blobs WHERE id = ?", BLOB)).toBe(0);
  });
```

`test/cleanup.test.ts`: in "request_nonces 1 ms past expiry ...", the expected counts gain `pending_blobs: 0`. Then add at the end of the `describe`, exactly:

```ts
  test("a blob reservation still uploading after 25 hours is deleted; one 23 hours old and a stored one 25 hours old are kept", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'u1')").run();
    await db.prepare("INSERT INTO groups (id, kind, name_locked, created_by) VALUES ('g1', 'shared', 'sealed', 'u1')").run();
    const insert = "INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at) VALUES (?, 'g1', 'u1', 100, ?, ?)";
    await db.prepare(insert).bind("old_pending", NOW - 25 * HOUR, null).run();
    await db.prepare(insert).bind("young_pending", NOW - 23 * HOUR, null).run();
    await db.prepare(insert).bind("old_stored", NOW - 25 * HOUR, NOW - 25 * HOUR).run();
    const counts = await cleanup({ DB: db, BUCKET: fakeBucket([]).bucket }, NOW);
    expect(counts.pending_blobs).toBe(1);
    const rows = await db.prepare("SELECT id FROM blobs ORDER BY id").all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "old_stored" }, { id: "young_pending" }]);
  });
```

`test/retranscribe.test.ts`, add at the end of the `describe`, exactly (the first fails today; the other three pin the deadline, the rounding down and the 300 s fallback, which no test covers now):

```ts
  test("a part replaced after done with more audio than the quote allows: Whisper is not called on it and the result is no_upload", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 1, minutes: 1, input: null });
    await f.bucket.put("tmp/audio/job_1/0", new Uint8Array(600_001));
    const { ai, calls } = fakeWhisper(() => whisperReply("x", 1));
    expect(await makeTranscript(deps(f, ai), f.input, { chunks: 1, bytes: 3 })).toMatchObject({ ok: false, reason: "no_upload" });
    expect(calls).toHaveLength(0);
  });

  test("past the deadline: no Whisper call and the result is deadline", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await withParts(f);
    const { ai, calls } = fakeWhisper(() => whisperReply("x", 1));
    const late = { ...deps(f, ai), now: () => f.input.deadline + 1 };
    expect(await makeTranscript(late, f.input, { chunks: 2, bytes: 5 })).toMatchObject({ ok: false, reason: "deadline" });
    expect(calls).toHaveLength(0);
  });

  test("10 credits quoted for 3 minutes is 3 a minute (rounded down): 150 s is charged 9", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 3, input: null });
    await withParts(f);
    const { ai } = fakeWhisper(() => whisperReply("x", 150));
    expect(await makeTranscript(deps(f, ai), f.input, { chunks: 1, bytes: 3 })).toMatchObject({ ok: true, credits: 9 });
  });

  test("a part with no duration counts as 300 s: with 1 minute quoted the next part is not read", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 1, minutes: 1, input: null });
    await withParts(f);
    const { ai, calls } = fakeWhisper(() => whisperReply("x", null));
    expect(await makeTranscript(deps(f, ai), f.input, { chunks: 2, bytes: 5 })).toMatchObject({ ok: true, credits: 1 });
    expect(calls).toHaveLength(1);
  });
```

`test/research.test.ts`: import `isWebUrl` and `READ_CONCURRENCY` from `../src/jobs/research.ts` and `JOB_NOW` from `./helpers/jobs.ts`.

- The deep test ("depth deep asks the planner for 6 queries ...") must check the deep price, 125 (today it runs at 40 because the fixture wallet cannot hold 125). Rename it "depth deep asks the planner for 6 queries, reads at most 20 pages and settles the deep price, 125", drop its comment about the fixture wallet, and replace its `runResearchJob` line and last `expect` with, exactly:

  ```ts
    // The fixture holds 40 of its 100 monthly credits; grant 100 more and hold the deep price under a second id.
    f.store.apply({ type: "grant", id: "more", bucket: "monthly", credits: 100, ref: "test" }, JOB_NOW);
    f.store.apply({ type: "hold", id: "job:u1:deep", hold_id: "job:u1:deep", user_id: "u1", task: "research", credits: 125, expires_at: JOB_NOW + 3_600_000 }, JOB_NOW);
    expect(await runResearchJob(deps, fakeSteps().steps, { ...f.input, credits: 125, hold_id: "job:u1:deep" })).toBe(true);
  ```
  and `expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 125 });` (the three `expect`s between them stay).

- Add at the end of the `describe`, exactly:

  ```ts
  test("isWebUrl takes public http and https pages and refuses credentials, IP addresses, localhost and local-only names", () => {
    for (const url of ["https://a.example/sky", "http://b.example.org/x?y=1", "https://Sub.Example.COM./"]) expect(isWebUrl(url), url).toBe(true);
    for (const url of [
      "ftp://a.example/",
      "https://user:pw@a.example/",
      "https://user@a.example/",
      "http://localhost:8080/admin",
      "http://localhost./",
      "http://intranet/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.5/",
      "http://0x7f.1/",
      "http://2130706433/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://printer.local/",
      "http://db.internal/",
      "http://app.localhost/",
      "http://nas.home.arpa/",
      "not a url",
    ]) {
      expect(isWebUrl(url), url).toBe(false);
    }
  });

  test("findSources leaves out search results that are not public web pages", async () => {
    const { deps } = await build({}, {
      search: async () =>
        Response.json({ items: [{ url: "http://169.254.169.254/latest/meta-data", title: "Meta" }, { url: "https://a.example/sky", title: "Sky A" }] }),
    });
    const sources = await findSources(deps, ["sky"], RESEARCH_CAPS.standard);
    expect(sources.map((s) => s.url)).toEqual(["https://a.example/sky"]);
  });

  test("a run reads at most READ_CONCURRENCY (3) pages at a time", async () => {
    let open = 0;
    let peak = 0;
    const { f, deps } = await build({}, {
      search: async (query) => Response.json({ items: Array.from({ length: 8 }, (_, i) => ({ url: `https://${query.length}.example/${i}`, title: `T ${i}` })) }),
      page: async (url) => {
        open += 1;
        peak = Math.max(peak, open);
        await new Promise((resolve) => setTimeout(resolve, 5));
        open -= 1;
        return Response.json({ success: true, result: `Text of ${url}` });
      },
    });
    expect(await runResearchJob(deps, fakeSteps().steps, f.input)).toBe(true);
    expect(READ_CONCURRENCY).toBe(3);
    expect(peak).toBe(3);
  });
  ```

Each bullet is one test (all above):
- A blob upload whose reservation was deleted while it ran: 409 "upload interrupted, try again", object deleted, no row.
- The hourly cleanup deletes a 25-hour-old pending reservation and keeps a 23-hour-old pending one and a stored one; it reports `pending_blobs`.
- A part replaced after `done` with more than the quote allows: `no_upload`, no Whisper call.
- Past the deadline: `deadline`, no Whisper call.
- 10 credits for 3 minutes charges 9 for 150 s (rounded down per minute).
- A part with no duration counts as 300 s.
- The deep job settles 125.
- `isWebUrl` accepts and refuses the listed URLs.
- `findSources` drops a metadata-address result.
- A run reads 3 pages at a time at most.

Not in this PR: deleting the R2 object of a reservation the cleanup removes (only a Worker that stopped between `put` and the final `UPDATE` leaves one; the bucket has no listing of `groups/` in the cleanup, by design); refusing `PUT` after `done` (the cap above makes a swapped part harmless) and a second `done` (the Workflow waits for one event and ignores the rest); a DNS check of research hosts (Browser Run runs in Cloudflare's browser, not on our network); the late `user.created` re-grant (skipped, see the table).

---

## H2 · Server: device removal and approval races, envelope adds, key shape

Branch `fix/h2-device-key-races`. Builds on `main` at `856b81d`. Files, and no others:

- `apps/api/src/storage.ts`
- `apps/api/src/devices/remove.ts`, `apps/api/test/remove-device.test.ts`
- `apps/api/src/devices/pairing.ts`, `apps/api/test/pairing.test.ts`
- `apps/api/src/keys/groups.ts`, `apps/api/test/group-keys.test.ts`
- `packages/crypto/src/keys.ts`, `packages/crypto/test/keys.test.ts`

`docs/security.md` sections 10 and 12 already say what items 2 and 3 do (changed in the planning pull request that added this card).

### 1. `BatchDb` gives each statement's change count

In `src/storage.ts` replace the `BatchDb` comment and type with, exactly:

```ts
// D1 with batch: the statements run in one transaction; if one fails, none is applied. Each result has the
// statement's change count. D1Database satisfies this type.
export type BatchDb = Db & { batch(statements: DbStatement[]): Promise<{ meta: { changes: number } }[]> };
```

`D1Database.batch` returns `D1Result[]`, whose `meta.changes` is a number, and `test/helpers/d1.ts` already returns `{ meta: { changes } }` per statement, so nothing else changes (checked: typecheck and every test pass).

### 2. Two removals at once cannot lock the account out (S1D, review of #56)

Now: everything the rotation rests on (the target, the remaining devices, their certificates) is read before `db.batch`, and the batch has no guard. The phone removes the iPad (rotation covering the phone) while the iPad removes the phone (rotation covering the iPad): both answer 200 and the user is left with no approved device, an active account row nobody holds, and no recovery blob. A device approved between the reads and the batch also keeps the old account key.

The fix: every statement of the batch carries one condition, "the target is still live and the user's other live, approved devices are exactly the ones read", and marking the target removed runs last, so its change count says whether the batch applied; if not, 409 and nothing changed. A D1 batch cannot stop half way, so the condition is on each statement; none of them changes what the condition reads except the last.

In `src/devices/remove.ts`:

- Add `import type { BatchDb, DbStatement } from "../storage.ts";`.
- Under `BUMP_USER_GROUPS_SQL` add, exactly:

  ```ts
  // The batch applies only if nothing changed since the reads above: the target is still live, and the user's other
  // live, approved devices are exactly the ones the caller covered (docs/security.md, section 12). Every statement of
  // the batch carries it, because a D1 batch cannot stop half way. Nothing in the batch changes what it reads except
  // marking the target removed, which runs last, so that statement's change count says whether the batch applied.
  export const UNCHANGED_SQL = `EXISTS (SELECT 1 FROM devices WHERE id = ? AND removed_at IS NULL)
    AND (SELECT count(*) FROM devices WHERE user_id = ? AND kind = 'device' AND removed_at IS NULL AND approved_at IS NOT NULL AND id != ?) = ?
    AND (SELECT count(*) FROM devices WHERE user_id = ? AND kind = 'device' AND removed_at IS NULL AND approved_at IS NOT NULL
         AND id IN (SELECT value FROM json_each(?))) = ?`;
  ```
- `const db = c.env.DB;` becomes `const db: BatchDb = c.env.DB;`.
- The waiting-device branch (`target.approved_at === null`) does not change; it keeps `markRemoved`, `dropPairing` and `dropPushToken`.
- Replace everything from `const bump = db.prepare(BUMP_USER_GROUPS_SQL).bind(user.id);` to the end of the last-device branch with, exactly:

  ```ts
      const unchanged = [target.id, user.id, target.id, remaining.length, user.id, JSON.stringify(remaining.map((d) => d.id)), remaining.length];
      const guarded = (sql: string, ...values: unknown[]) => db.prepare(`${sql} AND ${UNCHANGED_SQL}`).bind(...values, ...unchanged);
      const bump = guarded(BUMP_USER_GROUPS_SQL, user.id);
      const dropPushTokenIfUnchanged = guarded("DELETE FROM push_tokens WHERE user_id = ? AND device_id = ?", user.id, target.id);
      // Always the last statement of the batch.
      const markRemovedIfUnchanged = guarded("UPDATE devices SET removed_at = ? WHERE id = ?", now, target.id);
      const applyIfUnchanged = async (statements: DbStatement[]): Promise<void> => {
        const results = await db.batch(statements);
        if (results.at(-1)?.meta.changes !== 1) throw new ApiFailure("conflict", "devices changed, try again");
      };

      if (remaining.length === 0) {
        // The last device removing itself: nobody would hold a new account key, so nothing is rotated.
        if ("account" in req) throw new ApiFailure("bad_request", "invalid request");
        await applyIfUnchanged([bump, dropPushTokenIfUnchanged, markRemovedIfUnchanged]);
        return c.json({ removed: target.id, account_id: null });
      }
  ```
- In the certificate loop, the `updates.push(...)` line becomes, exactly:

  ```ts
        updates.push(guarded("UPDATE devices SET cert = ?, account_envelope = ? WHERE id = ?", entry.cert, entry.account_envelope, device.id));
  ```
- Replace `const statements = [...]` and the `try` after it with, exactly:

  ```ts
      const statements = [
        guarded("UPDATE devices SET removed_at = ? WHERE user_id = ? AND kind = 'account' AND removed_at IS NULL", now, user.id),
        db
          .prepare(
            `INSERT INTO devices (id, user_id, name, platform, sign_pub, box_pub, can_approve, added_at, kind, approved_at, approved_by)
             SELECT ?, ?, 'Account key', 'account', ?, ?, 1, ?, 'account', ?, ? WHERE ${UNCHANGED_SQL}`,
          )
          .bind(req.account.id, user.id, req.account.sign_pub, req.account.box_pub, now, now, caller.id, ...unchanged),
        ...updates,
        bump,
        guarded("DELETE FROM recovery WHERE user_id = ?", user.id),
        dropPushTokenIfUnchanged,
        markRemovedIfUnchanged,
      ];
      try {
        await applyIfUnchanged(statements);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "account key id taken");
        throw error;
      }
  ```

`BUMP_USER_GROUPS_SQL` ends in `... AND left_at IS NULL)`, so the appended `AND ...` belongs to its outer `WHERE`. `json_each` is part of D1's JSON functions and of `node:sqlite`. Unqualified columns in the condition's subqueries refer to their own `devices`, also inside `UPDATE devices`.

The app's answer to "devices changed, try again" is to reload `GET /v1/devices` and ask again; that is for the stage 4 removal screen (M27b), not this card.

### 3. Only an owner adds envelopes for another member's devices (S2, review of #55)

Now: after a first set, any current member, a viewer too, can add an envelope for another member's newly approved device. The primary key then blocks the real one and nothing can replace it.

In `src/keys/groups.ts`:

- `currentMember` also returns the role, exactly:

  ```ts
  export async function currentMember(db: Db, groupId: string, userId: string): Promise<{ key_version: number; role: string } | null> {
    return db
      .prepare("SELECT g.key_version, m.role FROM groups g JOIN memberships m ON m.group_id = g.id WHERE g.id = ? AND m.user_id = ? AND m.left_at IS NULL")
      .bind(groupId, userId)
      .first<{ key_version: number; role: string }>();
  }
  ```
  (The two `GET` routes in `routes.ts` use only `key_version`; they do not change.)
- In `storeGroupKeys`, the `if (first) { ... }` block gets an `else if`, exactly:

  ```ts
    } else if (group.role !== "owner") {
      // An add: only an owner (who invites new members) may wrap for another member's devices. Anyone else adds only
      // for their own devices and account row, so a member cannot take another member's slot with a bad key
      // (docs/security.md, section 10). 409, not 403: a full first set that arrives after another device's is refused
      // here too, and the app answers any 409 by fetching the key that won.
      const userOf = new Map(targets.map((t) => [t.id, t.user_id]));
      if (ids.some((id) => userOf.get(id) !== input.userId)) throw new ApiFailure("conflict", "only an owner can add keys for another member");
    }
  ```

Who adds what, after this: a new device's own user (S1C's approve, or the user's other device here); an owner for a new member (the inviter is always an owner, PR 27); the user's own device for a new account row after S1D. The existing test "after user 1's first set, user 2's own full first set → 409" still passes (now refused by this check, still 409).

### 4. Two approvals at once (S1C, review of #52)

Now: the approve batch never checks that its `UPDATE devices ... WHERE approved_at IS NULL AND removed_at IS NULL` changed a row. When the phone's approval and the account row's (recovery) land together, both answer 200; the loser's certificate and account envelope are dropped but its group envelopes are stored. The same happens if S1D removes the device between the checks and the batch.

In `src/devices/pairing.ts`, in the approve route's `statements`, replace the `...req.envelopes.map(...)` entry with, exactly:

```ts
        // Only if the update above was this request's: another approval, or a removal, that landed first leaves no
        // envelopes behind.
        ...req.envelopes.map((e) =>
          db
            .prepare(
              "INSERT INTO key_envelopes (group_id, key_version, device_id, wrapped_key) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM devices WHERE id = ? AND approved_by = ? AND account_envelope = ? AND removed_at IS NULL)",
            )
            .bind(e.group_id, e.key_version, target.id, e.wrapped_key, target.id, signer.id, req.account_envelope),
        ),
```

and replace the `try { await db.batch(statements); } catch ...` block with, exactly:

```ts
      let results: { meta: { changes: number } }[];
      try {
        results = await db.batch(statements);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "device already has a key for this version");
        throw error;
      }
      if (results[0]?.meta.changes !== 1) throw new ApiFailure("conflict", "device already approved");
```

The account envelope is HPKE output with a fresh ephemeral key, so it marks this request's update. The pairing row's `DELETE` stays unconditional (the winner deleted it already).

### 5. Key importers check the key's shape (S0A, review of #23)

Now: only `decodePublicKey` checks for 65 bytes starting with `0x04`. `importVerifyKey`, `importBoxKey`, `verifyP256` and `hpkeSeal` accept the compressed (`0x02`/`0x03`) and hybrid (`0x06`/`0x07`) forms on Node's WebCrypto. Every caller decodes first today; this keeps it so for the next one.

In `packages/crypto/src/keys.ts` replace `decodePublicKey`, `importVerifyKey` and `importBoxKey` (with their comments) by, exactly:

```ts
// Throws unless the bytes are the 65-byte uncompressed form. Some runtimes' WebCrypto also imports the compressed
// (0x02, 0x03) and hybrid (0x06, 0x07) forms; docs/security.md section 4 allows only 0x04.
function checkPublicKeyShape(bytes: Uint8Array): void {
  if (bytes.length !== P256_PUBLIC_KEY_BYTES || bytes[0] !== 0x04) throw new RangeError("not a P-256 public key");
}

export function decodePublicKey(text: string): Uint8Array {
  const bytes = fromBase64Url(text);
  checkPublicKeyShape(bytes);
  return bytes;
}

// Import fails (throws) if the key is not the uncompressed form or the point is not on the curve.
export async function importVerifyKey(raw: Uint8Array): Promise<CryptoKey> {
  checkPublicKeyShape(raw);
  return crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

export async function importBoxKey(raw: Uint8Array): Promise<CryptoKey> {
  checkPublicKeyShape(raw);
  return crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
}
```

`verifyP256` already turns an import failure into `false`; `hpkeSeal` imports through `importBoxKey`.

### Tests

**`test/remove-device.test.ts`.** Change `World.db` to `BatchDb` (import it with `Db` from `../src/storage.ts`). Give `rotation()` an option `keep?: TestDevice` (default `w.phone`) used everywhere it now says `phone_1` / `w.phone`: the certificate is over `keep`'s id and keys, the envelope's info and recipient are `keep`'s, its signer defaults to `keep`, and `devices` is `[{ id: keep.id, ... }]`. Give `remove()` a last parameter `db: BatchDb = w.db` passed as `DB`. Add this helper (same as in `members.test.ts`), exactly:

```ts
// Holds each db.batch until `parties` batches are waiting, then runs them one after the other: every request has
// made its reads before any of them writes.
function holdBatches(db: BatchDb, parties: number): BatchDb {
  const waiting: Array<() => void> = [];
  return {
    prepare: (query) => db.prepare(query),
    batch: async (statements) => {
      await new Promise<void>((release) => {
        waiting.push(release);
        if (waiting.length === parties) for (const go of waiting) go();
      });
      return db.batch(statements);
    },
  };
}
```

Then add at the end of the `describe`, exactly (the first three fail today):

```ts
  test("two devices removing each other at once: one gets 200, the other 409, and one device, its account key and the groups' single bump remain", async () => {
    const w = await world();
    const held = holdBatches(w.db, 2);
    const [phoneRemovesIpad, ipadRemovesPhone] = await Promise.all([
      remove(w, w.phone, PATH, await rotation(w), "u1", held),
      remove(w, w.ipad, "/v1/devices/phone_1", await rotation(w, { accountId: "acct_3", keep: w.ipad }), "u1", held),
    ]);
    expect([phoneRemovesIpad.status, ipadRemovesPhone.status].sort()).toEqual([200, 409]);
    const loser = phoneRemovesIpad.status === 409 ? phoneRemovesIpad : ipadRemovesPhone;
    expect(await errorOf(loser)).toEqual({ code: "conflict", message: "devices changed, try again", retry_after: null });
    const live = await w.db
      .prepare("SELECT id FROM devices WHERE user_id = 'u1' AND approved_at IS NOT NULL AND removed_at IS NULL ORDER BY kind, id")
      .all<{ id: string }>();
    expect(live.results).toHaveLength(2); // one account row and one device
    const groups = await w.db.prepare("SELECT key_version FROM groups ORDER BY id").all<{ key_version: number }>();
    expect(groups.results.map((g) => g.key_version)).toEqual([2, 2, 1]);
  });

  test("a device approved between the reads and the batch: 409 and nothing changes", async () => {
    const w = await world();
    const before = await snapshot(w.db);
    const approving: BatchDb = {
      prepare: (query) => w.db.prepare(query),
      batch: async (statements) => {
        await w.db.prepare("UPDATE devices SET approved_at = ? WHERE id = 'pending_1'").bind(NOW).run();
        return w.db.batch(statements);
      },
    };
    const res = await remove(w, w.phone, PATH, await rotation(w), "u1", approving);
    expect(res.status).toBe(409);
    expect((await errorOf(res)).message).toBe("devices changed, try again");
    await w.db.prepare("UPDATE devices SET approved_at = NULL WHERE id = 'pending_1'").run();
    expect(await snapshot(w.db)).toEqual(before);
  });

  test("the last device removing itself after another removal landed first: 409 and no second bump", async () => {
    const w = await world();
    await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'ipad_1'").bind(NOW).run();
    const removedFirst: BatchDb = {
      prepare: (query) => w.db.prepare(query),
      batch: async (statements) => {
        await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'phone_1'").bind(NOW).run();
        return w.db.batch(statements);
      },
    };
    const res = await remove(w, w.phone, "/v1/devices/phone_1", {}, "u1", removedFirst);
    expect(res.status).toBe(409);
    const groups = await w.db.prepare("SELECT key_version FROM groups ORDER BY id").all<{ key_version: number }>();
    expect(groups.results.map((g) => g.key_version)).toEqual([1, 1, 1]);
  });

  test("removing an already removed device gets 404 and bumps nothing", async () => {
    const w = await world();
    expect((await remove(w, w.phone, PATH, await rotation(w))).status).toBe(200);
    const again = await remove(w, w.phone, PATH, await rotation(w, { accountId: "acct_3" }));
    expect(again.status).toBe(404);
    const groups = await w.db.prepare("SELECT key_version FROM groups ORDER BY id").all<{ key_version: number }>();
    expect(groups.results.map((g) => g.key_version)).toEqual([2, 2, 1]);
  });

  test("a group the user has left keeps its key version", async () => {
    const w = await world();
    await w.db.prepare("UPDATE memberships SET left_at = ? WHERE group_id = 'g2' AND user_id = 'u1'").bind(NOW).run();
    expect((await remove(w, w.phone, PATH, await rotation(w))).status).toBe(200);
    const groups = await w.db.prepare("SELECT key_version FROM groups ORDER BY id").all<{ key_version: number }>();
    expect(groups.results.map((g) => g.key_version)).toEqual([2, 1, 1]);
  });

  test("the last device removing itself with an account body gets 400 and nothing changes", async () => {
    const w = await world();
    await w.db.prepare("UPDATE devices SET removed_at = ? WHERE id = 'ipad_1'").bind(NOW).run();
    const before = await snapshot(w.db);
    const res = await remove(w, w.phone, "/v1/devices/phone_1", await rotation(w));
    expect(res.status).toBe(400);
    expect(await snapshot(w.db)).toEqual(before);
  });
```

**`test/pairing.test.ts`.** Change `World.db` to `BatchDb` (import it beside `Db`); give `send()` an option `db?: BatchDb` passed as `DB: options.db ?? w.db`. Add, exactly (fails today):

```ts
  test("an approval that loses to another approval landing first: 409 'device already approved', none of its envelopes stored, the first approval kept", async () => {
    const w = await world();
    await insertDevice(w.db, w.ipad, { userId: "u1", approvedAt: null });
    const cert = await certOf(w, w.account);
    const accountEnvelope = await wrap(w, PURPOSE_ACCOUNT_KEY, accountKeyInfo("u1", "acct_1", "ipad_1"), w.account, "acct_1", 64);
    const groupEnvelope = await wrap(w, PURPOSE_GROUP_KEY, groupKeyInfo("g1", 1, "ipad_1"), w.account, "acct_1", 32);
    const otherFirst: BatchDb = {
      prepare: (query) => w.db.prepare(query),
      batch: async (statements) => {
        await w.db.prepare("UPDATE devices SET approved_at = ?, approved_by = 'phone_1', account_envelope = 'FIRST' WHERE id = 'ipad_1'").bind(NOW).run();
        return w.db.batch(statements);
      },
    };
    const body = { cert, account_envelope: accountEnvelope, envelopes: [{ group_id: "g1", key_version: 1, wrapped_key: groupEnvelope }] };
    const res = await send(w, w.account, APPROVE, body, { db: otherFirst });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: "conflict", message: "device already approved", retry_after: null });
    expect(await count(w.db, "SELECT COUNT(*) AS n FROM key_envelopes WHERE device_id = ?", "ipad_1")).toBe(0);
    const row = await w.db.prepare("SELECT approved_by, account_envelope FROM devices WHERE id = 'ipad_1'").first();
    expect(row).toEqual({ approved_by: "phone_1", account_envelope: "FIRST" });
  });
```

and three tests the review found missing (each passes today and fails on the mutant named):
- A group the user has left: set `left_at` on u1's `g1` membership, then a recovery approval (as in the "recovery" test) with a `g1`/1 envelope → 409 "unknown group or key version", device still waiting (mutant: drop `AND m.left_at IS NULL`).
- Another user's start, reveal and approve: register the iPad for u1, then `send(...)` start, reveal and approve as u2 (`{ userId: "u2" }`, signed by an approved device of u2 you insert) → each 404 or 401, nothing written (mutant: drop `user_id = ?` from `waitingDevice`).
- An envelope the device already has: insert `('g1', 1, 'ipad_1', 'OLD')` into `key_envelopes`, then a recovery approval with a `g1`/1 envelope → 409 "device already has a key for this version", `approved_at` still null.

**`test/group-keys.test.ts`.** Add, exactly (fails today):

```ts
  test("after a first set, an editor's add for another member's new device → 409 and no row; the owner's add for another member's device → 201", async () => {
    const w = await world();
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: await fullSet(w, w.d.dev_u1!, 2) })).status).toBe(201);
    const added = await makeTestDevice("dev_u1b");
    await insertDevice(w.db, added, { userId: "u1" });
    const byEditor = await post(w, "u2", w.d.dev_u2!, { key_version: 2, envelopes: [await envelope(w.d.dev_u2!, added, 2)] });
    expect(byEditor.status).toBe(409);
    expect(await errorOf(byEditor)).toEqual({ code: "conflict", message: "only an owner can add keys for another member", retry_after: null });
    expect((await rowsFor(w.db, 2)).map((r) => r.device_id)).not.toContain("dev_u1b");
    const u2b = await makeTestDevice("dev_u2b");
    await insertDevice(w.db, u2b, { userId: "u2" });
    expect((await post(w, "u1", w.d.dev_u1!, { key_version: 2, envelopes: [await envelope(w.d.dev_u1!, u2b, 2)] })).status).toBe(201);
  });
```

and the four gaps from the review (each passes today and fails on the mutant named):
- After a first set, u1 (owner) adds for `wait_u2`, `old_u2` or `dev_u3` → 409 "not a device of a current member", no row (mutant: the non-target check always false).
- After a first set for version 2, bump `groups.key_version` to 3 and post as u1 a set for version 3 with only `acct_u1` and `dev_u1` → 409 "envelopes must cover every device" (mutant: the existing-count query without `key_version`).
- After a first set, u1 adds two envelopes: one for a new approved device `dev_u2b` and one for `acct_u1`, which already has one → 409, and `dev_u2b` has no row (mutant: the batch replaced by separate `run()` calls).
- `GET /v1/groups/g1/devices` and `GET /v1/groups/g1/keys?device=dev_u3` as u3 → 404; with u2's membership `left_at` set, both as u2 → 404; `GET .../keys?device=old_u1` for a removed device of u1 (insert one) → 404; before any first set, every device in `GET .../devices` has `has_current_key: false`.

**`packages/crypto/test/keys.test.ts`.** Import `importBoxKey` and `importVerifyKey`. Add at the end, exactly (the second and third fail today):

```ts
// The first Wycheproof key and its first valid signature, with the key in its three encodings: uncompressed (0x04),
// compressed (0x02/0x03) and hybrid (0x06/0x07).
function wycheproofKey() {
  const group = wycheproof.testGroups[0];
  const valid = group?.tests.find((t) => t.result === "valid");
  if (group === undefined || valid === undefined) throw new Error("vector file has no valid case");
  const uncompressed = fromHex(group.publicKey.uncompressed);
  const odd = (uncompressed[64] ?? 0) & 1;
  const compressed = new Uint8Array(33);
  compressed[0] = 2 + odd;
  compressed.set(uncompressed.subarray(1, 33), 1);
  const hybrid = uncompressed.slice();
  hybrid[0] = 6 + odd;
  return { uncompressed, compressed, hybrid, sig: fromHex(valid.sig), msg: fromHex(valid.msg) };
}

describe("public key shape", () => {
  it("decodePublicKey rejects 65 bytes that start with 0x02", () => {
    const wrongPrefix = new Uint8Array(65);
    wrongPrefix[0] = 2;
    expect(() => decodePublicKey(toBase64Url(wrongPrefix))).toThrow(RangeError);
  });

  it("importVerifyKey and importBoxKey take the uncompressed form and refuse the compressed and hybrid forms of the same key", async () => {
    const key = wycheproofKey();
    await expect(importVerifyKey(key.uncompressed)).resolves.toBeDefined();
    await expect(importBoxKey(key.uncompressed)).resolves.toBeDefined();
    for (const raw of [key.compressed, key.hybrid]) {
      await expect(importVerifyKey(raw)).rejects.toThrow(RangeError);
      await expect(importBoxKey(raw)).rejects.toThrow(RangeError);
    }
  });

  it("verifyP256 accepts a valid signature under the uncompressed key and returns false under its hybrid form", async () => {
    const key = wycheproofKey();
    expect(await verifyP256(key.uncompressed, key.sig, key.msg)).toBe(true);
    expect(await verifyP256(key.hybrid, key.sig, key.msg)).toBe(false);
  });
});
```

Each bullet is one test (all above):
- Mutual removal: one 200, one 409 "devices changed, try again"; one device and one account row left; groups bumped once.
- A device approved between the reads and the batch: 409, nothing changed.
- The last device removing itself after another removal landed: 409, no second bump.
- Removing an already removed device: 404, no bump.
- A left group keeps its key version.
- The last device with an account body: 400, nothing changed.
- An approval that loses to another: 409 "device already approved", none of its envelopes, the first approval kept.
- Approve with an envelope for a group the user left: 409.
- Another user's start, reveal and approve: refused, nothing written.
- Approve when the device already has that envelope: 409 "device already has a key for this version", still waiting.
- An editor's add for another member's device: 409; the owner's: 201.
- An owner's add for a waiting, removed or non-member device: 409.
- A partial set for a new version after an older version's set: 409.
- An add with one new and one existing envelope: 409, nothing written.
- The two group `GET`s refuse non-members, left members and a removed device; `has_current_key` is false before any set.
- `decodePublicKey` refuses 65 bytes starting `0x02`.
- The importers refuse the compressed and hybrid forms.
- `verifyP256` is false under the hybrid form.

Not in this PR: the 3-waiting-devices race (skipped, see the table); the app's handling of "devices changed, try again" (M27b) and of the add rule (M28); revoking a removed device's Clerk session (R13); any change to `register.ts`.

---

## H3a · Server tests: router, wallet, privacy, jobs, Workflows

Branch `test/h3a-server-tests`. Builds on `main` at `856b81d`. Tests only, plus one comment. Files, and no others: `apps/api/test/ai-router.test.ts`, `wallet-route.test.ts`, `privacy.test.ts`, `jobs.test.ts`, `job-events.test.ts`, `job-run.test.ts`, `write-job.test.ts`, `write-made.test.ts`, and `packages/contracts/src/made.ts` (the comment above `MiniAppDraftSchema` only). Change no source line except that comment. Each new test must pass on `main`; where a bullet names a mutant, make that change by hand once, check the new test fails, and undo it (say so in the pull request).

**The comment (PR 25, review of #79).** In `packages/contracts/src/made.ts` replace `// A self-contained page: no external URLs in src or href (the app also blocks the network when it shows it).` with, exactly:

```ts
// A self-contained page. The app shows it only in a web view with the network blocked and no storage (card M25):
// that is the control. This check only refuses the plain src/href forms of an external URL so a bad draft is
// retried; it is not a defence (scripts, CSS url(), srcset, form actions and meta refresh all pass it).
```

Each bullet is one test (or one added assertion where it says so):

- **PR 13** (`ai-router.test.ts`), in "a good answer routes to the light tier with the light model", keep the `calls` from `fakeAi` and add: `calls[0]?.model` is `"@cf/example/clef-flash"` (the config's router model), `calls[0]?.options` has `gateway` equal to `gatewayOptions("gw")` and a `signal` that is an `AbortSignal` (mutant: `config.router.model` replaced by a constant).
- **PR 16** (`wallet-route.test.ts`): a wallet with a grant of 10 monthly and 5 purchased and nothing held gives `balance` exactly `{ monthly: 10, purchased: 5, held: 0, owed: 0, available: 15 }` (mutants: `available` = monthly or purchased only).
- **PR 16**: an entitlement with `ended_at` exactly `NOW` is not returned (mutant: `>` to `>=`).
- **PR 16**: in "limit=2 gives 2 entries ...", take `names` from `fixture()` and add `expect(names).toEqual(["billing-1"])` right after the first request (mutant: the ledger route looking up another wallet).
- **PR 16**: in "paging to the end ...", replace `for (;;)` with `for (let pages = 0; pages < 10; pages++)`, and after the loop check that `entries` equals the number of entries `GET /v1/wallet/ledger?limit=100` returns; a route that ignores `after` now fails instead of hanging.
- **PR 32** (`privacy.test.ts`): after u1 turns zero retention on, u2's `zero_retention` is still 0 (mutant: the `UPDATE` without `WHERE id = ?`).
- **PR 32**: two rows with the same `at`, inserted with the smaller id first, come back larger id first (mutant: `ORDER BY at DESC` without `id DESC`). Insert them in that order so the table order is the opposite of the expected one.
- **PR 20** (`jobs.test.ts`), in "another user's job gives 404 no such job", add after the 404: the row of `job_mine` is still `running`, `w.store.read().monthly` is still 60, `w.workflow.terminated` is `[]` and `w.commands` has no command (mutant: `loadJob(c.env.DB, c.req.param("id"))` without `user.id` in the `DELETE` route).
- **PR 20**: a `running` job with `result_key` set and an object at `results/<id>`, and the same for `failed` and `cancelled`: `GET .../result` signed by the phone → 404 each (mutant: drop `job.state !== "succeeded" ||`).
- **PR 21** (`job-events.test.ts`): a client that cancels the stream stops the polling. A `running` job, a sleep of `async () => { calls += 1; await new Promise((r) => setTimeout(r, 5)); }` that does not move the clock, read the first chunk of `res.body` with a reader, `await reader.cancel()`, wait 50 ms, note `calls`, wait 100 ms more: `calls` is unchanged (mutant: drop `!stream.aborted`).
- **PR 22A** (`job-run.test.ts`), in "runJob on a cancelled job ...", add `expect(f.objects.has("tmp/input/job_1")).toBe(false)` (mutant: drop `deleteJobInputs` in the `!running` branch).
- **PR 22A**: `finishJob` with a failed `Made` on a row that already has `result_key = 'results/job_1'` leaves `result_key` null (mutant: `result_key = result_key`).
- **PR 22A**: `runJob` whose make returns `bytes_sent: 99` (the fixture input has 38) sends a usage event with `bytes_sent: 99` (mutant: always `input.bytes_sent`).
- **PR 22B** (`write-job.test.ts`): `makeWritten` with a reply that is not JSON rejects with `ModelError` (it throws so the step is retried; mutant: `return failed(...)`). Import `ModelError` from `../src/jobs/model.ts`.
- **PR 22B**: the model call's time limit follows the deadline. With `now` 500 ms before `f.input.deadline` and a fake `ai.run` that waits for `options.signal`'s `abort` event and then rejects, `makeWritten` rejects with `ModelError` within 3 s (it waits the 1 s floor; give the test a 5 s timeout). Mutant: `input.deadline` in place of `input.deadline - deps.now()` makes it wait minutes.
- **PR 25** (`write-made.test.ts`), in the per-type "a reply its draft schema rejects ..." test, add `expect(await f.jobRow()).toMatchObject({ state: "failed" })`.

Not in this PR: any source change other than the comment; a 3 s wait for the router's own timeout (the bullet above checks the signal is passed); `sameView`'s `spent`/`result_ready` (they never change without `state` today) and the in-loop user id of the events stream (it only reloads the job the first, user-scoped load found); per-type prices and tiers in `write-made.test.ts` (the pricing table and router route tests pin them); PR 15's concurrency (explain's concurrent test covers the shared `instant.ts` path).

---

## H3b · Server tests: crypto formats, signatures, devices, recovery, sync, member removal

Branch `test/h3b-server-tests`. Builds on `main` at `856b81d`. Tests only. Files, and no others: `packages/crypto/test/formats.test.ts`, `apps/api/test/signature.test.ts`, `devices.test.ts`, `recovery.test.ts`, `sync.test.ts`, `members.test.ts`. Change no source file. Each new test must pass on `main`; where a bullet names a mutant, make it by hand once, check the new test fails, undo it, and say so in the pull request.

Each bullet is one test (or one added assertion where it says so):

- **S0B** (`formats.test.ts`): `makeEnvelope` signs exactly `envelopeSignatureInput(info, body)`: pass a `sign` that records its argument and returns 64 zero bytes, parse the result with `parseEnvelope`, and compare the recorded bytes with `envelopeSignatureInput(info, parsed.body)` (mutant: `input.sign(body)`).
- **S0B**: a sealed result with byte 0 changed to 2, and one with byte 1 changed to 1, each make `openResult` throw (mutant: drop the version and purpose check in `sealed.ts`).
- **S1A** (`signature.test.ts`; give `appFor` an optional `now`, default `NOW`): a request signed at `NOW` is accepted at `NOW`, and the same request (same nonce and headers) sent again with the app's clock at `NOW + 300_000` is 401 (mutants: the stored expiry `timestamp + SIGNATURE_WINDOW_MS` replaced by `timestamp`; the cleanup `expires_at < ?` replaced by `<=`).
- **S1A**: a request signed for `/v1/x?a=1` and sent to `/v1/x?a=2`, and sent to `/v1/x`, is 401 both times (the test app's `/v1/x` route matches any query; mutant: `pathname` without `search`).
- **S1A**: an expired `request_nonces` row of another device survives a request by `dev_one` (mutant: the cleanup without `device_id = ?`).
- **S1B** (`devices.test.ts`): a registration whose `box_pub` is 65 bytes, `0x04`, then all `0x01` (prefix right, off the curve) → 400, no row; the same for `account.sign_pub` and for `account.box_pub` on a first-device registration (mutants: drop either `importBoxKey` line or the two account import lines).
- **S1B**: a waiting device is stored with `can_approve` 0.
- **S1B**: a user whose only account row is removed can register a first device with `account` (201) (mutant: drop `AND removed_at IS NULL` from the account lookup).
- **S1B**: `GET /v1/devices` orders by `added_at` before `id`: two devices whose `added_at` order is the reverse of their id order come back in `added_at` order.
- **S1B**: with three waiting devices, one of them approved or removed (or its pairing expired), a fourth registration is 201 (mutants: drop `d.approved_at IS NULL` or `d.removed_at IS NULL` from the waiting count).
- **S3** (`recovery.test.ts`): with a second user u2 who has an account row and a recovery row, u1's `GET` returns u1's blob and account keys, and u1's `PUT` with `account_device_id` set to u2's account row is 409 (mutants: `WHERE r.user_id = ?` replaced by `WHERE ? IS NOT NULL`; `user_id = ?` dropped from the `PUT` lookup).
- **S3**: u1 with a removed account row inserted before the active one (lower id) and a recovery row: `GET` returns the active row's id and keys (mutant: drop `d.removed_at IS NULL` from the join).
- **PR 28** (`sync.test.ts`): a member u4 with `left_at` set and an approved phone gets no `sync` message after u1's post (mutant: drop `m.left_at IS NULL` from `TARGETS_SQL`).
- **PR 28**: an approved `account` row of u2 gets no `sync` message (mutant: drop `d.kind = 'device'`).
- **PR 28**: `GET .../changes` passes `maxBytes: MAX_PAGE_BYTES` to the room: wrap the room stub's `after` to record its third argument and assert `{ fromAt: 0, maxBytes: MAX_PAGE_BYTES }` for u1.
- **PR 27 Part B** (`members.test.ts`): removing a member calls the group room's `disconnect` with that user's id, once, for that group: pass `GROUP_ROOM: { idFromName: (name: string) => name, get: (name: string) => ({ disconnect: async (id: string) => void calls.push([name, id]) }) }` in `env` (today the tests pass no `GROUP_ROOM`, so the call fails silently and nothing checks it is made).

Not in this PR: any source change; a test for `verifyP256`'s 64-byte guard (WebCrypto refuses other lengths itself, so no test can tell the guard is there); the S0B `"new"` id (S1B already refuses it on registration).

---

## Mobile hardening cards (H4a to H6)

These follow `AGENTS.md` and "Rules for every mobile card" in `docs/cards/mobile.md` section 1: files only under `apps/mobile/` (H5c also `packages/api-client/`), logic in `src/core/` tested in Node, no component tests, Swift `Core` tested with `swift test`, Swift outside `Core/` cannot be compiled without Xcode (say so). Before opening the pull request run, from the repo root, `npm install`, `npm run typecheck`, `npm test`, `npm run export:ios -w @waypoint/mobile`, and `npm run test:swift -w @waypoint/mobile` for H4a and H6; paste the last lines of each. Add a "Device check" section (each step passed, failed, or "not run: no Xcode yet").

Every block marked **exactly** was applied to a copy of `main` at `856b81d`, with all the mobile cards together: `npm run typecheck`, the mobile tests (250), the api-client tests, `npm run export:ios -w @waypoint/mobile` and `npm run test:swift -w @waypoint/mobile` (39 tests) passed, and every new test was checked to fail on the old code. The Swift outside `Core/` (`AudioRecorder.swift`, `WaypointAudioModule.swift`, `LiveTranscriber.swift`) passed `swiftc -parse` only.

No card adds a dependency or touches `docs/`.

---

## H4a · Mobile: recording errors, gap rows, ghost sessions, page reading order

Branch `fix/h4a-recording`. Builds on `main` at `856b81d`. Files, and no others:

- `apps/mobile/modules/waypoint-audio/ios/AudioRecorder.swift`
- `apps/mobile/modules/waypoint-audio/ios/WaypointAudioModule.swift`
- `apps/mobile/modules/waypoint-audio/ios/LiveTranscriber.swift`
- `apps/mobile/modules/waypoint-audio/src/WaypointAudio.ts`
- `apps/mobile/modules/waypoint-pages/ios/Core/PageLine.swift`
- `apps/mobile/modules/waypoint-pages/ios/Tests/PageLineTests.swift`
- `apps/mobile/src/core/capture/timeline.ts` (new)
- `apps/mobile/src/core/capture/recording.ts`
- `apps/mobile/src/features/capture/useRecording.ts`
- `apps/mobile/src/features/capture/RecordScreen.tsx`
- `apps/mobile/test/timeline.test.ts` (new)
- `apps/mobile/test/recording.test.ts`

### 1. A failed write pauses the recording (M5)

Now: `AudioRecorder.swift:174` opens the next part with `try?` and `:176` writes with `try? file?.write(from:)`. On a full disk every later buffer is dropped silently while the level meter moves.

Change, exactly:

- Line 11: `enum RecorderError: Error { case busy, notRecording, notPaused, micDenied, writeFailed }`
- Under `private var lastLevelAt: Int64 = 0      // io` add:

  ```swift
    private var writeFailed = false         // io: set on the first failed write of a run, so it pauses once
  ```
- In `startRun()`, inside `io.sync`, right after `file = try Self.openFile(sessionId: id, index: part.index, format: format)` add `writeFailed = false`.
- In `handle(_:)`, replace from `guard var t = timeline, let id = ioSessionId else { return }` to `try? file?.write(from: buffer)` with:

  ```swift
      guard var t = timeline, let id = ioSessionId, !writeFailed else { return }
      let now = Self.now()
      if let rolled = t.rollIfNeeded(now: now) {
        timeline = t
        file = nil
        emitPart(rolled.closed, sessionId: id)
        file = try? Self.openFile(sessionId: id, index: rolled.opened.index, format: buffer.format)
      }
      do {
        guard let file else { throw RecorderError.writeFailed }
        try file.write(from: buffer)
      } catch {
        // A full disk, or a part file that could not be opened: pause (reason "write_failed") so the screen
        // does not show a live recording that is not being saved. The pause runs on the control queue.
        writeFailed = true
        control.async { [weak self] in
          guard let self, self.sessionId == id, !self.paused else { return }
          self.pauseInControl(reason: "write_failed")
        }
        return
      }
  ```
  (`sink?.append(buffer)` and the level code stay below it.) The pause goes through `control.async`, never `control.sync`, because `handle` runs inside `io.sync` and `pauseInControl` calls `io.sync` itself.

`src/WaypointAudio.ts` line 5, exactly:

```ts
export type PauseReason = "none" | "user" | "interruption" | "route_change" | "media_reset" | "write_failed";
```

`RecordScreen.tsx`, in `PAUSE_REASONS` after `media_reset`, exactly:

```ts
  write_failed: "Your iPhone couldn't save the recording. Free up some space, then resume.",
```

### 2. Overlapping speech-pack downloads (M6)

Now: `WaypointAudioModule.swift:7` is one `downloading` boolean; a second `downloadSpeechPack()` while the first runs is cleared by the first one's `defer`, and `getSpeechStatus()` then says `not_installed` while the second is still downloading. `LiveTranscriber.swift:13,34` sets `missed` and nothing reads it.

Change, exactly: replace `private var downloading = false  // downloadLock` with

```swift
  private var downloads = 0  // downloadLock: downloads running now (a second tap starts a second one)
```

replace the two lines `self.setDownloading(true)` / `defer { self.setDownloading(false) }` with

```swift
      self.changeDownloads(by: 1)
      defer { self.changeDownloads(by: -1) }
```

and the two helpers at the end with

```swift
  private func isDownloading() -> Bool { downloadLock.withLock { downloads > 0 } }

  private func changeDownloads(by delta: Int) { downloadLock.withLock { downloads += delta } }
```

In `LiveTranscriber.swift` delete the `missed` property line and make the guard in `runStarted` `guard let locale, let analyzerFormat else { return }`.

### 3. Reading order that does not depend on input order (M7)

Now: `PageLine.swift:20-26` sorts with a pairwise "same row within half a line height" test, which is not transitive; three lines on a slanted page give three different orders for six input orders.

Replace `readingOrder` (and its doc comment) with, exactly:

```swift
  /// Reading order: top to bottom, then into rows. A line joins the current row when its top is within half a
  /// line height of the row's first line; each row is read left to right. Sorting first makes the result the same
  /// for any input order (a pairwise "same row" test is not transitive on a slanted page).
  static func readingOrder(_ lines: [PageLine]) -> [PageLine] {
    let byTop = lines.sorted { ($0.y, $0.x, $0.text) < ($1.y, $1.x, $1.text) }
    var rows: [[PageLine]] = []
    for line in byTop {
      if let first = rows.last?.first, line.y - first.y <= min(first.height, line.height) / 2 {
        rows[rows.count - 1].append(line)
      } else {
        rows.append([line])
      }
    }
    return rows.flatMap { row in row.sorted { ($0.x, $0.y, $0.text) < ($1.x, $1.y, $1.text) } }
  }
```

### 4. A failed start leaves nothing behind; the gap row shows on resume (M10b)

Now: `useRecording.ts:134-142` writes the session row, then `startRecording` may throw; the catch (`:151-153`) shows the alert and leaves a "recording" row that lists as "New recording". The gap row is built from closed parts (`:259-264`), and a part closes only on the next pause, stop or 5-minute roll, so after a call and Resume no gap shows.

New file `src/core/capture/timeline.ts`, exactly:

```ts
import type { Piece } from "./transcript.ts";

export type TimelineItem =
  | { kind: "line"; key: string; at: number; text: string }
  | { kind: "gap"; key: string; at: number; gapMs: number }
  | { kind: "flag"; key: string; at: number }
  | { kind: "photo"; key: string; at: number; file: string };

export type PartSpan = { index: number; startMs: number; durationMs: number };

const GAP_MIN_MS = 1000;

// Finals, gaps, flags and photos, in time order. All times are ms since the session started.
// A gap is drawn as soon as recording resumes: from the end of the last part that started before the resume
// to the resume time. Parts close (and are reported) on pause, so that part is known by then.
export function buildTimeline(
  finals: Piece[],
  parts: PartSpan[],
  resumes: number[],
  flags: number[],
  photos: { id: string; t: number; file: string }[],
): TimelineItem[] {
  const items: TimelineItem[] = finals.map((piece) => ({ kind: "line", key: `line-${piece.tStart}`, at: piece.tStart, text: piece.text }));
  for (const resumedAt of resumes) {
    const before = parts.filter((part) => part.startMs < resumedAt).at(-1);
    if (before === undefined) continue;
    const gapStart = before.startMs + before.durationMs;
    const gapMs = resumedAt - gapStart;
    if (gapMs >= GAP_MIN_MS) items.push({ kind: "gap", key: `gap-${resumedAt}`, at: gapStart, gapMs });
  }
  flags.forEach((t, i) => items.push({ kind: "flag", key: `flag-${i}`, at: t }));
  photos.forEach((p) => items.push({ kind: "photo", key: `photo-${p.id}`, at: p.t, file: p.file }));
  return items.sort((a, b) => a.at - b.at);
}
```

The resume time is taken with the JavaScript clock (`Date.now() - session.startedAt`), the same clock flags already use. `startedAt` is written just before the native recorder starts, so it is never later than the native part times and the gap is never negative.

`useRecording.ts`:

- Imports: add `deleteSessionRow` to the `sessions.ts` import (`import { deleteSessionRow, type SessionRow } from "../../core/capture/sessions.ts";`), and add
  `import { buildTimeline, type TimelineItem } from "../../core/capture/timeline.ts";` and `import { deleteSessionFiles } from "../../platform/files.ts";`.
- Delete `GAP_MIN_MS`, the local `TimelineItem` type and the local `buildTimeline` function. Add `export type { TimelineItem };` where the type was (`RecordScreen.tsx` imports it from here).
- Under `const [parts, setParts] = ...` add `const [resumes, setResumes] = useState<number[]>([]);`.
- In the `onRecorderState` handler, before `setRecorder(e.state);`, exactly:

  ```ts
        // A resume: the gap row can be drawn now (session time, the same clock flags use).
        const started = sessionRef.current?.startedAt;
        if (e.state === "recording" && started !== undefined) setResumes((previous) => [...previous, Date.now() - started]);
  ```
- The start effect's `catch`, exactly:

  ```ts
      } catch (error) {
        // The session row was written before the recorder started; a recorder that never started leaves nothing.
        const failed = sessionRef.current;
        if (failed !== null) {
          sessionRef.current = null;
          writeDb((db) => deleteSessionRow(db, failed.id));
          deleteSessionFiles(failed.id);
        }
        Alert.alert("Couldn't start the recording.", messageOf(error), [{ text: "OK", onPress: () => router.back() }]);
      }
  ```
- `timeline: buildTimeline(live.finals, parts, resumes, flags, photos),`

### 5. Interrupted sessions get a length and an end (M10b)

Now: `recoverSessions` (`recording.ts:84-90`) sets only `state` and `transcript`, so a session cut off by a crash lists with `recorded_ms` 0 and no `ended_at`.

Replace its comment and the `UPDATE`, exactly:

```ts
// After a restart: sessions still marked recording or paused, except the one native is still recording,
// become interrupted and wait for transcription. Their length is what the saved audio parts add up to, and they
// end where the last saved part ends. Returns their ids.
```

```ts
        `UPDATE sessions SET state = 'interrupted',
           transcript = CASE WHEN transcript = 'done' THEN 'done' ELSE 'waiting' END,
           recorded_ms = (SELECT COALESCE(SUM(duration_ms), 0) FROM captures WHERE session_id = sessions.id AND kind = 'audio'),
           ended_at = COALESCE(ended_at, started_at + (
             SELECT COALESCE(MAX(t + COALESCE(duration_ms, 0)), 0) FROM captures WHERE session_id = sessions.id AND kind = 'audio'))
         WHERE id = ?`,
```

### Tests

`modules/waypoint-pages/ios/Tests/PageLineTests.swift`, add inside the struct, exactly:

```swift
  @Test func readingOrderIsTheSameForEveryInputOrderOnASlantedPage() {
    let a = PageLine(text: "A", x: 0.9, y: 0.100, width: 0.05, height: 0.04)
    let b = PageLine(text: "B", x: 0.5, y: 0.115, width: 0.05, height: 0.04)
    let c = PageLine(text: "C", x: 0.1, y: 0.130, width: 0.05, height: 0.04)
    let orders = [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]
    for input in orders {
      #expect(PageLine.readingOrder(input).map(\.text) == ["B", "A", "C"])
    }
  }
```

New `test/timeline.test.ts`, exactly:

```ts
import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/core/capture/timeline.ts";

const part = (index: number, startMs: number, durationMs: number) => ({ index, startMs, durationMs });

describe("buildTimeline", () => {
  it("shows a gap as soon as recording resumes, before the next part closes", () => {
    const items = buildTimeline([], [part(0, 0, 60_000)], [95_000], [], []);
    expect(items).toEqual([{ kind: "gap", key: "gap-95000", at: 60_000, gapMs: 35_000 }]);
  });

  it("shows no gap for a pause under one second, or for the first start", () => {
    expect(buildTimeline([], [part(0, 0, 60_000)], [60_900], [], [])).toEqual([]);
    expect(buildTimeline([], [], [40], [], [])).toEqual([]);
  });

  it("uses the last part that started before each resume", () => {
    const parts = [part(0, 0, 300_000), part(1, 300_000, 20_000), part(2, 330_000, 10_000)];
    const items = buildTimeline([], parts, [330_000, 350_000], [], []);
    expect(items.map((i) => (i.kind === "gap" ? [i.at, i.gapMs] : null))).toEqual([
      [320_000, 10_000],
      [340_000, 10_000],
    ]);
  });

  it("puts lines, gaps, flags and photos in time order", () => {
    const items = buildTimeline(
      [{ tStart: 70_000, tEnd: 71_000, text: "after", isFinal: true }, { tStart: 1000, tEnd: 2000, text: "before", isFinal: true }],
      [part(0, 0, 60_000)],
      [65_000],
      [30_000],
      [{ id: "x", t: 80_000, file: "p.jpg" }],
    );
    expect(items.map((i) => i.kind)).toEqual(["line", "flag", "gap", "line", "photo"]);
  });
});
```

`test/recording.test.ts`, add at the end of the `describe`, exactly:

```ts
  it("recoverSessions sets the length and end time from the saved audio parts", () => {
    insertSession("crashed", "recording", "live", 5000);
    savePart(db, deps(), "crashed", { index: 0, startMs: 0, durationMs: 300_000, file: "a0.m4a" });
    savePart(db, deps(), "crashed", { index: 1, startMs: 320_000, durationMs: 40_000, file: "a1.m4a" });
    insertSession("empty", "paused", "waiting", 7000);
    recoverSessions(db, { sessionId: "", state: "idle" });
    expect(getSession(db, "crashed")).toMatchObject({ recordedMs: 340_000, endedAt: 5000 + 360_000 });
    expect(getSession(db, "empty")).toMatchObject({ recordedMs: 0, endedAt: 7000 });
  });

  it("savePart stores the part index as its position", () => {
    const session = startRecordingSession(db, deps(), homeId, false);
    savePart(db, deps(), session.id, { index: 3, startMs: 900_000, durationMs: 1000, file: "a3.m4a" });
    expect(db.get<{ position: number }>("SELECT position FROM captures WHERE file = 'a3.m4a'")?.position).toBe(3);
  });

  it("pendingTranscriptions includes interrupted sessions that are waiting", () => {
    insertSession("crashed", "recording", "live");
    savePart(db, deps(), "crashed", { index: 0, startMs: 0, durationMs: 20_000, file: "c0.m4a" });
    recoverSessions(db, { sessionId: "", state: "idle" });
    expect(pendingTranscriptions(db)).toEqual([{ sessionId: "crashed", parts: [{ file: "c0.m4a", startMs: 0, durationMs: 20_000 }] }]);
  });
```

Each bullet is one test (all above):
- Reading order is `B A C` for all six input orders of the slanted-page lines.
- A gap row appears from the resume alone; under 1 s or at first start, none; the last part before each resume is used; items are in time order.
- `recoverSessions` writes `recorded_ms` (sum of parts) and `ended_at` (`started_at` + end of the last part), and `started_at` when there are no parts.
- `savePart` stores a non-zero `part.index` as `position`.
- `pendingTranscriptions` returns an interrupted waiting session.

### Device check

1. Fill the iPhone's storage until under 100 MB is free, start a recording: within a few seconds it pauses with "Your iPhone couldn't save the recording. Free up some space, then resume." and the level meter stops.
2. Record, take a phone call for 30 s, tap Resume: a gap row shows right away, before the next pause.
3. During a phone call (the audio session cannot be activated), tap Record: after "Couldn't start the recording." and OK, Home shows no "New recording".
4. Kill the app during a recording, reopen it: the session shows with its length, not 0:00:00.
5. Download the speech pack from Settings and tap Download again on `dev/audio` during it: Settings keeps saying downloading until both end.
6. Snap a page held at an angle: the lines read in the same order each time you re-read it.

Not in this PR: deleting a part file that could not be opened (its transcription fails like any unreadable file); a native part-start time in the state event; any change to `RecordingTimeline`.

---

## H4b · Mobile: search survives embedder trouble, Your pages fixes

Branch `fix/h4b-search-pages`. Builds on `main` at `856b81d`. Files, and no others:

- `apps/mobile/src/core/search/vectors.ts`, `query.ts`, `indexer.ts`
- `apps/mobile/src/features/search/SearchScreen.tsx`
- `apps/mobile/src/ui/kit.tsx` (`Screen` only)
- `apps/mobile/src/features/capture/NewPagesScreen.tsx`, `YourPagesScreen.tsx`
- `apps/mobile/src/core/capture/pages.ts`
- `apps/mobile/test/query.test.ts`, `indexer.test.ts`, `pages.test.ts`

### 1. Vectors with no direction (M9a)

Now: `indexer.ts:41` maps only `length === 0` to "no vector", so an all-zero vector reaches `quantize`, which throws; `indexed_at` stays NULL and the indexer picks the same session every tick for ever. `query.ts:70` awaits `embedder.embed` with no catch, so an embedder error (the native module throws `unavailable` without a sentence embedding) rejects the whole search, keyword hits included.

`vectors.ts`, above `quantize`, exactly:

```ts
// False for an empty vector or one of all zeros: neither can be normalised, so neither is stored or searched.
export function hasDirection(vector: readonly number[]): boolean {
  return vector.some((v) => v !== 0);
}
```

`indexer.ts`: import `hasDirection` with `quantize`, and line 41 becomes
`const stored = vectors.map((v) => (hasDirection(v) ? quantize(v) : null));`

`query.ts`: import `hasDirection` with the others from `./vectors.ts`, and replace the two lines `const [queryVector = []] = await embedder.embed([query]);` / `if (queryVector.length > 0) {` (keep `const vectorIds` above them) with, exactly:

```ts
  // Without a query vector (no embedding on this phone, an embed error, or an all-zero vector) keyword hits still count.
  const vectorIds: number[] = [];
  const queryVector = await embedder.embed([query]).then((vectors) => vectors[0] ?? [], (): number[] => []);
  if (hasDirection(queryVector)) {
```

`indexSession` keeps throwing embedder errors: the indexer swallows them and retries on the next tick.

### 2. Clear the vector cache whenever a re-index ran (M9a)

Now: `indexer.ts:67` clears only `if (written > 0)`; a re-index that empties a session keeps the old chunk ids in the cache.

Add `let replaced = false;` under `let written = 0;`, set `replaced = true;` as the last line inside the transaction (after `written = drafts.length;`), and replace `if (written > 0) clearVectorCache();` with `if (replaced) clearVectorCache();`.

### 3. Search screen (M9b)

Now: `SearchScreen.tsx:65,93` depends on the `index` object, which `useQuery` rebuilds on every `writeDb` anywhere (renaming, the Saving-to pill, live segments), so each write re-embeds the query. `Screen` (`kit.tsx:11`) is a plain `ScrollView`, so with the field focused the first tap on a result only closes the keyboard. (An embed error no longer empties the results: fix 1.)

`SearchScreen.tsx`: replace the comment above `const index = useQuery(...)` with
`// A finished index run changes these counts, which re-runs the search below. Other writes do not.`, add `const { chunks, vectors } = index;` under it, and make the effect's dependencies `[query, chunks, vectors]`.

`kit.tsx`, in `Screen`, exactly:

```tsx
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
```

(`"handled"`: a tap on a button goes to the button; a tap on empty space still closes the keyboard. Every screen gets this.)

### 4. Your pages (M10c)

Now: "Add" in Your pages pushes `/pages/new?sessionId=<id>`, and on success `NewPagesScreen.tsx:43` does `router.replace("/pages/<id>")`, so the stack holds two Your pages screens. The alert (`:46`) shows the native error text ("Call to function 'WaypointPages.scanPages' has been rejected…"). The × badge (`YourPagesScreen.tsx:103,224`) is 22 pt with no hit slop and deletes the page and its JPEG at once. "Delete 1 pages?" in the discard alert.

`NewPagesScreen.tsx`, replace from `writeDb((db) => addPages(db, deps, sessionId, files));` to the end of `scanWithCamera`, exactly:

```tsx
    writeDb((db) => addPages(db, deps, sessionId, files));
    // Added to an existing session: go back to its Your pages screen, which re-reads the new pages.
    if (created) router.replace(`/pages/${sessionId}`);
    else router.back();
  } catch (error) {
    if (created) discardSession(sessionId);
    // Plain words only; the native error text is not for students.
    const message = error instanceof ScannerUnsupported ? "This iPhone can't scan pages. Try From Photos instead." : "Please try again.";
    Alert.alert("Couldn't add the pages.", message, [{ text: "OK", onPress: () => router.back() }]);
  }
}

class ScannerUnsupported extends Error {}

async function scanWithCamera(sessionId: string): Promise<string[]> {
  if (!isScannerSupported()) throw new ScannerUnsupported();
  return (await scanPages(sessionId)).map((page) => page.file);
}
```

and delete the now unused `messageOf` at the end of the file.

`YourPagesScreen.tsx`: under `remove`, add exactly

```tsx
  // The × sits on the thumbnail, so a missed tap must not delete a page straight away.
  function confirmRemove(captureId: string, index: number) {
    Alert.alert(`Remove page ${index + 1}?`, "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => remove(captureId) },
    ]);
  }
```

the × `Pressable` gets `onPress={() => confirmRemove(page.id, index)}` and `hitSlop={11}` (22 + 2 × 11 = 44 pt), and the discard alert's title becomes `pages.length === 1 ? "Delete this page?" : \`Delete ${pages.length} pages?\``.

### 5. `titleFromText` keeps a word that ends at character 60 (M10c)

Now: `pages.ts:123-126` cuts at the last space inside the first 60 characters even when character 61 is a space, so `"a"×55 + " bbbb dd ee"` loses "bbbb".

After `const cut = chars.slice(0, 60).join("");` add exactly:

```ts
  if (chars[60] === " ") return cut.trimEnd(); // the 60th character ends a word
```

### Tests

`test/query.test.ts`: add `import { quantize } from "../src/core/search/vectors.ts";`, add these three tests inside the existing `describe("searchNotes", ...)`, exactly:

```ts
  it("a meaning match below 0.25 similarity is not a hit", async () => {
    addSession("far", "space-1", "Far", ["cells divide"]);
    const table = { "cells divide": [1, 0, 0], tax: [0.2, 0.98, 0] };
    await indexSession(db, fakeEmbedder(table), "far", 5000);
    expect(await searchNotes(db, fakeEmbedder(table), "tax", {})).toEqual([]);
  });

  it("keyword hits are ranked by bm25, not by insert order", async () => {
    addSession("many", "space-1", "Many", ["photosynthesis photosynthesis photosynthesis"]);
    addSession("once", "space-1", "Once", ["photosynthesis happens in leaves with light and water every day"]);
    await indexSession(db, fakeEmbedder({}), "many", 5000);
    await indexSession(db, fakeEmbedder({}), "once", 5000);
    const hits = await searchNotes(db, fakeEmbedder({}), "photosynthesis", {});
    expect(hits.map((h) => h.sessionId)).toEqual(["many", "once"]);
  });

  it("vectors of another length are skipped instead of failing the search", async () => {
    addSession("old", "space-1", "Old", ["supply curve"]);
    await indexSession(db, fakeEmbedder({ "supply curve": [1, 0] }), "old", 5000);
    const hits = await searchNotes(db, fakeEmbedder({ supply: [1, 0, 0] }), "supply", {});
    expect(hits.map((h) => h.sessionId)).toEqual(["old"]);
  });
```

and a new `describe` at the end of the file, exactly:

```ts
describe("searchNotes without a usable query vector", () => {
  it("keeps the keyword hits when the embedder throws", async () => {
    addSession("econ", "space-1", "Economics", ["deadweight loss explained"]);
    await indexSession(db, fakeEmbedder({ "deadweight loss explained": [0, 1, 0] }), "econ", 5000);
    const broken: Embedder = { modelVersion: "test-1", embed: () => Promise.reject(new Error("unavailable")) };
    const hits = await searchNotes(db, broken, "deadweight", {});
    expect(hits.map((h) => h.sessionTitle)).toEqual(["Economics"]);
  });

  it("an all-zero query vector gives keyword hits only and does not throw", async () => {
    addSession("econ", "space-1", "Economics", ["deadweight loss explained"]);
    const table = { "deadweight loss explained": [0, 1, 0], deadweight: [0, 0, 0] };
    await indexSession(db, fakeEmbedder(table), "econ", 5000);
    const hits = await searchNotes(db, fakeEmbedder(table), "deadweight", {});
    expect(hits.map((h) => h.sessionTitle)).toEqual(["Economics"]);
  });

  it("a re-index that writes no chunks still clears the vector cache", async () => {
    const table = { "supply and demand": [1, 0, 0], market: [1, 0, 0] };
    addSession("s1", "space-1", "One", ["supply and demand"]);
    await indexSession(db, fakeEmbedder(table), "s1", 5000);
    await searchNotes(db, fakeEmbedder(table), "market", {}); // loads the cache
    db.run("DELETE FROM segments WHERE session_id = 's1'");
    expect(await indexSession(db, fakeEmbedder(table), "s1", 6000)).toBe(0);
    // A vector written without indexSession is only found if the cache was cleared by the empty re-index.
    addSession("s2", "space-1", "Two", []);
    db.run("INSERT INTO chunks (id, session_id, source, capture_id, t_start, t_end, text) VALUES (99, 's2', 'transcript', NULL, 0, 900, 'prices')");
    const v = quantize([1, 0, 0]);
    db.run("INSERT INTO search_index (chunk_id, model_version, dim, scale, vector) VALUES (99, 'test-1', 3, ?, ?)", [v.scale, v.bytes]);
    const hits = await searchNotes(db, fakeEmbedder(table), "market", {});
    expect(hits.map((h) => h.sessionId)).toEqual(["s2"]);
  });
});
```

(The explicit chunk id 99 matters: SQLite reuses rowid 1 after the delete, which would hide a stale cache.)

`test/indexer.test.ts`, add inside `describe("indexer", ...)`, exactly:

```ts
  it("an all-zero vector is stored as a chunk without a vector, and the session is marked indexed", async () => {
    addSession("s1", "saved", 100, ["silence"]);
    expect(await indexSession(db, fakeEmbedder({ silence: [0, 0, 0] }), "s1", 5000)).toBe(1);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM search_index")?.n).toBe(0);
    expect(sessionsToIndex(db, 3)).toEqual([]);
  });

  it("a re-index replaces the rows and moves indexed_at forward", async () => {
    addSession("s1", "saved", 100, ["supply and demand"]);
    await indexSession(db, fakeEmbedder(vectors), "s1", 5000);
    await indexSession(db, fakeEmbedder(vectors), "s1", 6000);
    expect(db.get<{ indexed_at: number }>("SELECT indexed_at FROM sessions WHERE id = 's1'")?.indexed_at).toBe(6000);
  });

  it("writes nothing when the session is marked stale while it is being embedded", async () => {
    addSession("s1", "saved", 100, ["supply and demand"]);
    await indexSession(db, fakeEmbedder(vectors), "s1", 5000);
    const embedder: Embedder = {
      modelVersion: "test-1",
      embed: async (texts) => {
        db.run("UPDATE sessions SET indexed_at = NULL WHERE id = 's1'");
        return texts.map(() => [1, 0, 0]);
      },
    };
    expect(await indexSession(db, embedder, "s1", 6000)).toBe(0);
    expect(db.get<{ indexed_at: number | null }>("SELECT indexed_at FROM sessions WHERE id = 's1'")?.indexed_at).toBeNull();
  });

  it("embeds in batches of 16", async () => {
    const segment = (i: number) => Array.from({ length: 100 }, () => `w${i}`).join(" ");
    addSession("s1", "saved", 100, Array.from({ length: 20 }, (_, i) => segment(i)));
    const sizes: number[] = [];
    const embedder: Embedder = { modelVersion: "test-1", embed: async (texts) => { sizes.push(texts.length); return texts.map(() => [1, 0, 0]); } };
    expect(await indexSession(db, embedder, "s1", 5000)).toBe(20);
    expect(sizes).toEqual([16, 4]);
  });
```

`test/pages.test.ts`, add inside `describe("pages", ...)`, exactly:

```ts
  it("titleFromText keeps a word that ends exactly at the 60th character, and cuts inside a word at the space before it", () => {
    expect(titleFromText(`${"a".repeat(55)} bbbb dd ee`, "Pages")).toBe(`${"a".repeat(55)} bbbb`);
    expect(titleFromText(`${"a".repeat(55)} bbbbbbbb`, "Pages")).toBe("a".repeat(55));
  });

  it("pagesToRead also returns photos taken during a recording", () => {
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('rec', ?, 'recording', 'Lecture', 'saved', 1)", [spaceId]);
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('ph', 'rec', 'photo', 5000, 0, 'board.jpg')");
    expect(pagesToRead(db, 10).map((p) => p.file)).toEqual(["board.jpg"]);
  });

  it("movePage clamps a position below 0 (here -1) to the first place and one past the end to the last", () => {
    const session = newSession();
    const [a, , c] = addPages(db, deps(), session, ["a.jpg", "b.jpg", "c.jpg"]);
    movePage(db, c ?? "", -1);
    expect(positionsOf(session).map((p) => p.file)).toEqual(["c.jpg", "a.jpg", "b.jpg"]);
    movePage(db, c ?? "", 99);
    expect(positionsOf(session).map((p) => p.file)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    movePage(db, a ?? "", 99);
    expect(positionsOf(session).map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it("titleFromText skips a line with only two letters, and cuts a 61-character word to 60", () => {
    expect(titleFromText("ab 12\nAbc def", "Pages")).toBe("Abc def");
    expect(titleFromText("x".repeat(61), "Pages")).toBe("x".repeat(60));
    expect(titleFromText("x".repeat(60), "Pages")).toBe("x".repeat(60));
  });
```

(`-1`, not `-5`: `Array.splice` already treats −5 like 0 on a short list, so only −1 shows the clamp.)

Each bullet is one test (all above):
- Similarity 0.2 is not a hit; bm25 order beats insert order; a vector of another length is skipped.
- An embedder that rejects still gives the keyword hit; an all-zero query vector gives keyword hits; an empty re-index clears the cache.
- An all-zero chunk vector stores the chunk and marks the session indexed; re-index sets `indexed_at` 6000; a session marked stale mid-embed gets nothing written; batches are 16 then 4.
- `titleFromText` keeps the word ending at 60; skips a two-letter line; cuts 61 to 60. Photos are in `pagesToRead`; `movePage` clamps −1 and 99.

### Device check

1. Search with the keyboard up: the first tap on a result opens the session.
2. Search "photosynthesis", then rename an unrelated session: the results do not flicker or reload.
3. On a phone or simulator with the system language set to one with no sentence embedding, search a word you recorded: keyword results show.
4. Your pages → Add → snap one page: Back from Your pages goes to the screen before it, not to a second Your pages.
5. Tap just outside the × on a thumbnail corner: a "Remove page 1?" alert appears; Cancel keeps it.
6. On the simulator (no document camera), New pages → "Couldn't add the pages." with "This iPhone can't scan pages. Try From Photos instead."

Not in this PR: deleting JPEGs left when a multi-photo import fails part way; `model_version` filter tests; an undo for remove.

---

## H5a · Mobile: study fixes, plurals, `useQuery` keys and the minute clock

Branch `fix/h5a-study`. Builds on `main` at `856b81d`; merge after H4b (both edit `YourPagesScreen.tsx`, different lines). Files, and no others:

- `apps/mobile/src/platform/db.ts`
- `apps/mobile/src/core/format.ts`, `src/core/study/generate.ts`, `src/core/study/cards.ts`, `src/core/study/help.ts`
- `apps/mobile/src/app/dev/model.tsx`
- `apps/mobile/src/features/capture/HomeScreen.tsx`, `SpaceScreen.tsx`, `SessionScreen.tsx`, `YourPagesScreen.tsx`, `SpacePickerScreen.tsx`
- `apps/mobile/src/features/study/ReviewHomeScreen.tsx`, `MadeScreen.tsx`, `HelpPickScreen.tsx`, `HelpStepsScreen.tsx`
- `apps/mobile/test/format.test.ts`, `generate.test.ts`, `cards.test.ts`, `help.test.ts`, `units.test.ts`

### 1. `useQuery` takes a key; a minute clock (M4, M11a)

Now: `db.ts:45-55` caches by write version only, so a `read` that closes over a route param keeps the old result if the param changes on the same screen; `HomeScreen.tsx:21` and `ReviewHomeScreen.tsx:16-28` read "cards due now" with `Date.now()` inside the query, so on tabs that stay mounted "All caught up" never turns into "1 card due" until some unrelated write.

`db.ts`: import `useEffect, useRef, useState, useSyncExternalStore` from `react`; replace `useQuery` with, exactly:

```ts
// Re-runs `read` after every writeDb call, and when `key` changes. Pass as `key` every value `read` uses
// that can change while the screen is open (an id from the route, the time), joined into one string.
// The result is cached per version and key, as useSyncExternalStore requires.
export function useQuery<T>(read: (db: SqlDb) => T, key = ""): T {
  const cache = useRef<{ version: number; key: string; value: T } | null>(null);
  const getSnapshot = (): T => {
    if (cache.current === null || cache.current.version !== version || cache.current.key !== key) {
      cache.current = { version, key, value: read(getDb()) };
    }
    return cache.current.value;
  };
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

and add at the end, exactly:

```ts
const MINUTE_MS = 60_000;

// The time, rounded down to the minute, for reads that depend on it (cards due now). Re-checked every 15 s.
export function useMinuteNow(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS);
  useEffect(() => {
    const timer = setInterval(() => setMinute(Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS), 15_000);
    return () => clearInterval(timer);
  }, []);
  return minute;
}
```

Pass the key at every call that reads a route param: `SpaceScreen` (`, id`), `SessionScreen` (`, id` after the closing `}` of the read), `YourPagesScreen` (`, id`), `SpacePickerScreen` (`currentId`: `, sessionId ?? ""`), `HelpPickScreen` (`, sessionId`, see 6).

`HomeScreen.tsx`: `const now = useMinuteNow();` then `const due = useQuery((db) => countDue(db, now), String(now));`. `ReviewHomeScreen.tsx`: `const now = useMinuteNow();` above the query, delete `const now = Date.now();` inside it, and pass `String(now)` as the key.

### 2. Plurals (M10a, M11a)

`src/core/format.ts`, at the end, exactly:

```ts
// "1 page", "3 pages", "0 pages".
export function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
```

Use it everywhere a count is followed by a noun on these screens:
- `HomeScreen.tsx`: `` {`${countLabel(due, "card", "cards")} due`} ``; `countLabel(latest.pages, "page", "pages")` for the detail line (`:54`); the three chips use `countLabel` and the local `plural` function (`:97`) is deleted.
- `SpaceScreen.tsx:25` and `SessionScreen.tsx:35`: `countLabel(<n>, "page", "pages")`.
- `ReviewHomeScreen.tsx:53`: `` {`${countLabel(data.due, "card", "cards")} due`} ``.
- `MadeScreen.tsx:30`, exactly:

  ```tsx
        <Title>
          {isRecording
            ? `${countLabel(cards, "flashcard", "flashcards")} from your recording.`
            : `${countLabel(cards, "flashcard", "flashcards")} from your ${countLabel(pages, "page", "pages")}.`}
        </Title>
  ```

### 3. Flashcard sources across line breaks; blank units (M8)

Now: `generate.ts:129-130` compares the whitespace-collapsed front with page text that has `"\n"` between lines, so "Solve 3x + 7 = 22" on two lines of page 2 is sourced to page 1. `plan` (`:113-117`) divides by the total size; all-blank units give `NaN` ("Make up to NaN flashcards").

Above `plan`, exactly:

```ts
// Lower case with every run of whitespace as one space, so a front matches page text across its line breaks.
function looseText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
```

`plan`'s comment becomes `// Each group gets its share of the total, by its estimated size. Blank units (a page with no text) are left out.` and its first line `const groups = packUnits(units.filter((unit) => unit.text.trim() !== ""), inputBudget(port.contextSize()));`. In `makeCardsFromUnits`:

```ts
      const front = looseText(card.front);
      const source = group.find((unit) => looseText(unit.text).includes(front)) ?? group[0];
```

`src/app/dev/model.tsx` (so the M8 device check "a 30,000-character transcript through `makeCardsFromUnits`" can run): import `makeCardsFromUnits` from `../../core/study/generate.ts`, drop `cleanCards` from the drafts import, and the Cards action becomes, exactly:

```tsx
    // Through the same packing and halving as the Flashcards screen, so a long transcript can be checked here.
    { label: "Cards", run: () => makeCardsFromUnits({ contextSize: getContextSize, makeCards, makeQuiz }, [{ text, captureId: null, t: null }], 10) },
```

### 4. Making flashcards again does not double the deck (M11a)

Now: the Review tab shows "Flashcards" for every recent session; a second tap saves another 12, duplicates included (`cards.ts:74-89`).

Replace the comment and the start of `saveCards` up to the loop, exactly:

```ts
// Same front: case and spacing ignored.
function frontKey(front: string): string {
  return front.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

// Writes the cards for one session, each new and due now. A card whose front the session already has is skipped,
// so making flashcards twice does not double the deck. Returns the saved rows.
export function saveCards(db: SqlDb, deps: Deps, sessionId: string, cards: NewCard[], madeBy: "device_model" | "quiz_miss"): CardRow[] {
  const now = deps.now();
  const rows: CardRow[] = [];
  db.transaction(() => {
    const seen = new Set(db.all<{ front: string }>("SELECT front FROM cards WHERE session_id = ?", [sessionId]).map((row) => frontKey(row.front)));
    for (const card of cards) {
      const key = frontKey(card.front);
      if (seen.has(key)) continue;
      seen.add(key);
```

(the insert and `rows.push` stay as they are). New fronts from a second run are still added.

### 5. Help shows step 1 at once (M11b)

Now: `startHelp` returns `shown: 0` (`help.ts:28`), so the screen opens with the problem and a "Next step" button with nothing above it. The card says step 1 shows from the start.

```ts
// Step 1 shows straight away; "Next step" shows the rest one at a time.
export function startHelp(draft: HelpDraft): HelpState {
  return { steps: draft.steps, answer: draft.answer, shown: Math.min(1, draft.steps.length), answerShown: false };
}
```

### 6. The help SQL moves into core (M11b)

Now: `HelpPickScreen.tsx:14-21` and `HelpStepsScreen.tsx:15-27` run `SELECT ... FROM captures` in the feature; `problemOf` has no test.

`help.ts`: imports become `import type { SqlDb } from "../db/sql.ts";` and `import { groupBlocks, parseLines, type Block } from "../pages/blocks.ts";`; add at the end, exactly:

```ts
export type PageWithLines = { id: string; file: string; found_text: string | null; found_lines: string | null };

// A session's pages in page order, with the text and lines found on each.
export function pagesWithLines(db: SqlDb, sessionId: string): PageWithLines[] {
  return db.all<PageWithLines>(
    "SELECT id, file, found_text, found_lines FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id",
    [sessionId],
  );
}

export type Problem = { text: string; context: string };

// The problem at `index` among the page's blocks, with the rest of its page for the model. Null when the page,
// its text or that block is missing.
export function problemOf(db: SqlDb, captureId: string, index: number): Problem | null {
  const page = db.get<{ found_text: string | null; found_lines: string | null }>(
    "SELECT found_text, found_lines FROM captures WHERE id = ? AND kind = 'page'",
    [captureId],
  );
  if (page === null || page.found_text === null) return null;
  const block = groupBlocks(parseLines(page.found_lines))[index];
  if (block === undefined) return null;
  return { text: block.text, context: problemContext(page.found_text, block) };
}
```

`HelpPickScreen.tsx`: delete the `SqlDb` import, `PageRow` and `pagesOf`; import `pagesWithLines, type PageWithLines` from `../../core/study/help.ts`; `const pages = useQuery((db) => pagesWithLines(db, sessionId), sessionId);`; rename `PageRow` to `PageWithLines` where used. `HelpStepsScreen.tsx`: delete the `SqlDb` and `blocks.ts` imports, `type Problem` and the local `problemOf`; import `problemOf` (instead of `problemContext`) from `../../core/study/help.ts`. Nothing else changes.

### Tests

`test/format.test.ts`: import `countLabel` and add, exactly:

```ts
describe("countLabel", () => {
  it("uses the singular only for exactly one", () => {
    expect(countLabel(1, "page", "pages")).toBe("1 page");
    expect(countLabel(0, "page", "pages")).toBe("0 pages");
    expect(countLabel(12, "card", "cards")).toBe("12 cards");
  });
});
```

`test/generate.test.ts`, inside the last `describe`, exactly:

```ts
  it("finds the source page when the front spans a line break on the page", async () => {
    const { port } = fakePort(() => [term("Solve 3x + 7 = 22")]);
    const units = [unit("Page one intro.", "p1", null), unit("Worksheet\nSolve 3x + 7\n= 22\nmore", "p2", null)];
    const cards = await makeCardsFromUnits(port, units, 5);
    expect(cards.map((c) => c.captureId)).toEqual(["p2"]);
  });

  it("asks the model nothing when every unit is blank", async () => {
    const { port, calls } = fakePort(() => [term("x")]);
    expect(await makeCardsFromUnits(port, [unit("", "p1"), unit("  \n ", "p2")], 5)).toEqual([]);
    expect(calls).toEqual([]);
  });
```

`test/cards.test.ts`, inside `describe("cards", ...)`, exactly:

```ts
  it("saveCards skips a front the session already has, ignoring case and spacing", () => {
    saveCards(db, deps(), sessionId, [card("Elasticity")], "device_model");
    const second = saveCards(db, deps(), sessionId, [card("elasticity "), card("Supply")], "device_model");
    expect(second.map((c) => c.front)).toEqual(["Supply"]);
    expect(sessionCardCount(db, sessionId)).toBe(2);
  });

  it("saveCards keeps where each card came from, and a missed quiz question is saved as quiz_miss", () => {
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('cap-1', ?, 'page', 0, 0, 'p.jpg')", [sessionId]);
    const rows = saveCards(db, deps(), sessionId, [{ ...card("Ohm's law"), captureId: "cap-1", t: 4000 }], "quiz_miss");
    expect(dueCards(db, NOW, { limit: 10 })).toEqual(rows);
    expect(rows[0]).toMatchObject({ captureId: "cap-1", t: 4000 });
    expect(db.get<{ made_by: string }>("SELECT made_by FROM cards WHERE id = ?", [rows[0]?.id ?? ""])).toEqual({ made_by: "quiz_miss" });
  });

  it("a late review records the time the card was due, not the time it was reviewed", () => {
    saveCards(db, deps(), sessionId, [card("A")], "device_model");
    reviewCard(db, "card-1", Rating.Good, NOW + 5 * MIN);
    expect(db.get<{ due_before: number }>("SELECT due_before FROM reviews")?.due_before).toBe(NOW);
  });

  it("several reviews over days match ts-fsrs without fuzz, including a late one", () => {
    saveCards(db, deps(), sessionId, [card("A")], "device_model");
    const f = fsrs(generatorParameters({ enable_fuzz: false }));
    let expected = createEmptyCard(new Date(NOW));
    let at = NOW;
    for (const step of [0, 10 * MIN, 0, 0, 3 * 86_400_000]) {
      at = Math.max(at, expected.due.getTime()) + step;
      expected = f.next(expected, new Date(at), Rating.Good).card;
      expect(reviewCard(db, "card-1", Rating.Good, at).dueAt).toBe(expected.due.getTime());
    }
    expect(expected.scheduled_days).toBeGreaterThanOrEqual(3);
  });
```

`test/units.test.ts`, inside `describe("study units", ...)`, exactly:

```ts
  it("pages come in page order, not id order", () => {
    addPage("a", 1, "Second page");
    addPage("b", 0, "First page");
    expect(studyUnits(db, "pages").map((u) => u.captureId)).toEqual(["b", "a"]);
  });

  it("a cloud transcript segment is not used", () => {
    addSegment(0, "Spoken words.");
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('rec', 0, 1000, 'Cloud words.', 'cloud')");
    expect(studyUnits(db, "rec").map((u) => u.text)).toEqual(["Spoken words."]);
  });
```

`test/help.test.ts`: imports become

```ts
import { describe, expect, it } from "vitest";
import { createSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { HelpDraft } from "../src/core/study/drafts.ts";
import { pagesWithLines, problemContext, problemOf, showAnswer, showNextStep, startHelp } from "../src/core/study/help.ts";
import { createMemoryDb } from "./helpers/db.ts";
```

(keep the `Block` import); the first `help steps` test becomes `it("starts with step 1 shown and no answer", ...)` expecting `shown: 1`; the second test uses `const state = startHelp(draft);` (two steps, one shown); and add at the end, exactly:

```ts
describe("pages and problems from the database", () => {
  const line = (text: string, y: number) => ({ text, x: 0.1, y, width: 0.5, height: 0.04 });
  function setup() {
    const db = createMemoryDb();
    migrate(db);
    const space = ensureDefaultSpace(db, { now: () => 1, newId: () => "space" });
    createSession(db, { now: () => 1, newId: () => "s1" }, { spaceId: space.id, kind: "pages", title: "Worksheet", state: "saved" });
    const add = (id: string, position: number, text: string | null, lines: object[] | null) =>
      db.run("INSERT INTO captures (id, session_id, kind, t, position, file, found_text, found_lines) VALUES (?, 's1', 'page', 0, ?, ?, ?, ?)", [
        id, position, `${id}.jpg`, text, lines === null ? null : JSON.stringify(lines),
      ]);
    add("p2", 1, "1. Solve 3x = 6.\n2. Solve 2x = 8.", [line("1. Solve 3x = 6.", 0.1), line("2. Solve 2x = 8.", 0.2)]);
    add("p1", 0, null, null);
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('ph', 's1', 'photo', 0, 0, 'ph.jpg')");
    return db;
  }

  it("pagesWithLines lists only the session's pages, in page order", () => {
    expect(pagesWithLines(setup(), "s1").map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("problemOf returns the block at the index with its page as context", () => {
    expect(problemOf(setup(), "p2", 1)).toEqual({ text: "2. Solve 2x = 8.", context: "1. Solve 3x = 6. 2. Solve 2x = 8." });
  });

  it("problemOf is null for a page with no text, an index past the last block, or a photo", () => {
    const db = setup();
    expect(problemOf(db, "p1", 0)).toBeNull();
    expect(problemOf(db, "p2", 2)).toBeNull();
    expect(problemOf(db, "ph", 0)).toBeNull();
  });
});
```

Each bullet is one test (all above):
- `countLabel` singular only for 1.
- A front split over page lines is sourced to that page; all-blank units call nothing.
- A repeated front is skipped; source fields and `quiz_miss` are stored; `due_before` is the due time on a late review; five reviews match ts-fsrs without fuzz.
- Pages in `position` order; cloud segments left out.
- Help starts at step 1; `pagesWithLines` order and filter; `problemOf` found and null cases.

### Device check

1. With one card due, Home says "1 card due"; with one page, a pages session says "1 page".
2. Rate a card Again, stay on the Review tab for two minutes: "All caught up" turns into "1 card due" without touching anything.
3. Make flashcards for a session twice: the second time adds only new cards.
4. Help with a problem: step 1 is on screen when the steps load.
5. `dev/model`: paste 30,000 characters and tap Cards: cards come back (no `context_too_long`).

Not in this PR: `?t=` on the source chip (no transcript view yet); re-reading model availability on focus; a confirm before making flashcards again.

---

## H5b · Mobile: settings rows, permissions refresh, space names

Branch `fix/h5b-settings`. Builds on `main` at `856b81d`; merge after H4b (both edit `ui/kit.tsx`: H4b `Screen`, this card `Row`). Files, and no others:

- `apps/mobile/src/ui/kit.tsx` (`Row` only)
- `apps/mobile/src/features/capture/SpacePickerScreen.tsx`
- `apps/mobile/src/features/settings/PermissionsScreen.tsx`, `SettingsScreen.tsx`, `StorageScreen.tsx`
- `apps/mobile/src/core/settings/format.ts`, `src/core/db/spaces.ts`
- `apps/mobile/test/settings-format.test.ts`, `spaces.test.ts`

### 1. `Row`: information rows, and a selected state (M10a, M12)

Now: `Row` (`kit.tsx:69-98`) requires `onPress`, so Apple Intelligence, Version and the three permission rows pass `() => undefined` and VoiceOver reads them as buttons that do nothing; the space picker's checkmark is visual only.

Replace `Row` with, exactly:

```tsx
// A row that does something when onPress is given (a button to VoiceOver), or shows information when it is not.
// `selected` marks the chosen row in a list of choices, for VoiceOver.
export function Row({
  title,
  subtitle,
  leading,
  right,
  onPress,
  selected = false,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  right?: ReactNode;
  onPress?: (() => void) | undefined;
  selected?: boolean;
}) {
  const colors = useColors();
  const style = [styles.row, { backgroundColor: colors.surface, borderColor: colors.line }];
  const content = (
    <>
      {leading}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSubtitle, { color: colors.ink3 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </>
  );
  if (onPress === undefined) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={style}
    >
      {content}
    </Pressable>
  );
}
```

The information row is a plain `View` (not `accessible`), so the Allow button inside the Microphone row stays reachable. `onPress` is typed `(() => void) | undefined` because `exactOptionalPropertyTypes` is on and the Speech pack row passes a value that can be `undefined`.

`SpacePickerScreen.tsx`: add `selected={space.id === currentId}` to the `Row`.

### 2. Settings screens (M12)

- `PermissionsScreen.tsx:29-34`: the screen is not blurred while the app is in iOS Settings, so `useFocusEffect` misses the change. Import `useEffect` and `AppState`, and replace the block with, exactly:

  ```tsx
    // Refreshes when the screen opens or comes back, and when the app comes back from iOS Settings
    // (the screen is not blurred while the app is in the background, so focus alone misses that).
    const refresh = useCallback(() => {
      getMicPermission().then(setMic, () => setMic(null));
    }, []);
    useFocusEffect(refresh);
    useEffect(() => {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") refresh();
      });
      return () => subscription.remove();
    }, [refresh]);
  ```
  and remove `onPress={() => undefined}` from the Microphone, Speech recognition and Camera rows.
- `SettingsScreen.tsx`: the Speech pack row gets `onPress={speech?.pack === "not_installed" ? downloadPack : undefined}`; the Apple Intelligence row loses its `onPress`; the Version row becomes `<Row title={versionLabel(Constants.expoConfig?.version ?? null, Constants.nativeBuildVersion)} />` (import `versionLabel` with `percentLabel`).
- `src/core/settings/format.ts`, at the end, exactly:

  ```ts
  // "Version 1.0.0 (42)"; the build number is left out when there is none (Expo Go, web).
  export function versionLabel(version: string | null, build: string | null): string {
    const name = `Version ${version ?? "unknown"}`;
    return build === null || build === "" ? name : `${name} (${build})`;
  }
  ```
- `StorageScreen.tsx:47-49`: the bar is always 100% full and says nothing (a student may read it as "the phone is full"). Delete the `track` view and the `track` and `fill` styles. The segmented K5 bar is a later card.

### 3. Space names compared beyond A to Z (M4)

Now: `spaces.ts:60` uses `COLLATE NOCASE`, which folds only A–Z, so "Écologie" and "écologie" can both exist.

Replace the two `taken` lines with, exactly:

```ts
  // Compared in JavaScript: SQLite's NOCASE folds only A to Z, so "Écologie" and "écologie" would both be allowed.
  const fold = (text: string): string => text.normalize("NFC").toLocaleLowerCase();
  if (listSpaces(db).some((space) => fold(space.name) === fold(trimmed))) throw new SpaceNameError("taken");
```

### Tests

- `test/settings-format.test.ts` (import `versionLabel`), exactly:

  ```ts
    it("versionLabel leaves out a missing build number", () => {
      expect(versionLabel("1.0.0", "42")).toBe("Version 1.0.0 (42)");
      expect(versionLabel("1.0.0", null)).toBe("Version 1.0.0");
      expect(versionLabel("1.0.0", "")).toBe("Version 1.0.0");
    });
  ```
- `test/spaces.test.ts`, after the "taken for a name that exists in another case" test, exactly:

  ```ts
    it("createSpace throws taken for an accented name that exists in another case", () => {
      createSpace(db, deps(), "Écologie");
      expect(nameError(() => createSpace(db, deps(), "écologie"))).toBe("taken");
    });
  ```

### Device check

1. Settings → Permissions with the microphone denied → Allow → turn it on in iOS Settings → switch back: the row says Allowed without leaving the screen.
2. VoiceOver on Settings: Apple Intelligence and Version are read as text, not "button"; Permissions and Storage are buttons.
3. VoiceOver in the space picker: the current space is read as "selected".
4. Create "Écologie", then try "écologie": "taken" message.

Not in this PR: the segmented storage bar; refreshing the speech pack row on app active.

---

## H5c · Mobile: Apple sign-in errors, device setup that cannot hang, config staleness, dev routes, SSE

Branch `fix/h5c-account-client`. Builds on `main` at `856b81d`. Files, and no others:

- `apps/mobile/src/platform/auth.tsx`, `src/shell/SignInScreen.tsx`
- `apps/mobile/src/core/config/config.ts`, `test/config.test.ts`
- `apps/mobile/src/core/device/registration.ts`, `src/platform/device.ts`, `src/shell/DeviceWaitingScreen.tsx`
- `apps/mobile/src/app/_layout.tsx`
- `packages/api-client/src/sse.ts`, `packages/api-client/test/sse.test.ts`, `packages/api-client/test/client.test.ts`

### 1. Apple sign-in says when it failed (M1b)

Now: `useAppleSignIn` (`auth.tsx:61-74`) returns `false` for both a cancel and a failure, and `SignInScreen.tsx:55-57` ignores it, so a network or Clerk failure does nothing visible. Clerk's flow returns no session on cancel and throws on a failure (read in `useSignInWithApple.ios.js` during the M1b review).

`auth.tsx`, replace `useAppleSignIn` and its comment with, exactly:

```tsx
export type AppleResult = "ok" | "cancelled" | "error";

// Native Sign in with Apple. Clerk returns no session when the person cancels, and throws when Apple or Clerk
// refuses or the network is down.
export function useAppleSignIn(): () => Promise<AppleResult> {
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  return async () => {
    try {
      const { createdSessionId, setActive } = await startAppleAuthenticationFlow();
      if (!createdSessionId || !setActive) return "cancelled";
      await setActive({ session: createdSessionId });
      return "ok";
    } catch {
      return "error";
    }
  };
}
```

`SignInScreen.tsx`, the Apple button's `onPress`, exactly:

```tsx
          onPress={() => {
            void signInWithApple().then((result) => {
              setMessage(result === "error" ? "Couldn't sign in with Apple. Check your connection and try again." : null);
            });
          }}
```

A cancel shows nothing (and clears an old message).

### 2. A damaged `config_fetched_at` counts as stale (M13)

Now: `platform/config.ts:25` does `Number(at)`; a non-numeric value gives `NaN`, every comparison in `isStale` (`config.ts:27-29`) is false, and the cached config (with its `min_native`) is fresh for ever.

```ts
export function isStale(fetchedAt: number | null, now: number): boolean {
  // A value that is not a number (a damaged setting) counts as stale; NaN would fail every comparison below.
  return fetchedAt === null || !Number.isFinite(fetchedAt) || now - fetchedAt >= CONFIG_MAX_AGE_MS || now < fetchedAt;
}
```

### 3. Device setup never stays on "Setting up this iPhone" (M27a)

Now: `device.ts:90-93` handles only a 429 and a `NetworkError`; a 401, a `BadReplyError`, another 409 or a keys-module error (`no_secure_enclave`, `keychain`) leaves the status `checking`, and "Check again" repeats it.

`registration.ts:33`, exactly:

```ts
export type DeviceStatus = "checking" | "approved" | "waiting" | "too_many_waiting" | "offline" | "failed" | "signed_out";
```

`device.ts`, replace the comment above `refreshDevice` and its `.catch`, exactly:

```ts
// Runs the flow unless it is already running. A failure leaves an approved or waiting status in place; while
// still checking it shows offline (no reply) or failed (any other error), so the screen never stays on "Setting up".
function refreshDevice(clerkUserId: string): Promise<void> {
  if (running !== null) return running;
  running = register(clerkUserId)
    .catch((error: unknown) => {
      if (error instanceof ApiCallError && error.status === 429) setStatus("too_many_waiting");
      else if (status !== "checking") return;
      else if (error instanceof NetworkError) setStatus("offline");
      else setStatus("failed");
    })
```

`DeviceWaitingScreen.tsx`, in `COPY` after `offline`, exactly:

```ts
  failed: { title: "Couldn't set up this iPhone", body: "Something went wrong while getting this iPhone ready for credits.", caption: "Tap Check again to try once more." },
```

(`COPY` is a `Record<DeviceStatus, …>`, so typecheck fails until this line exists.)

### 4. Dev routes only in development builds, after sign-in (M5, M7)

Now: `src/app/dev/audio.tsx`, `model.tsx` and `pages.tsx` are in no `Stack.Protected` group (`_layout.tsx:12-35`), so `waypoint://dev/audio` opens before sign-in in a release build and can start the microphone.

`_layout.tsx`, above the `sign_in` group, exactly:

```tsx
      {/* Test screens for the native modules: development builds only, and only when signed in. */}
      <Stack.Protected guard={__DEV__ && gate === "app"}>
        <Stack.Screen name="dev/audio" />
        <Stack.Screen name="dev/model" />
        <Stack.Screen name="dev/pages" />
      </Stack.Protected>
```

(`__DEV__` is declared by React Native's types; typecheck and `export:ios` pass.)

### 5. SSE: CRLF line endings and a cut-off last event (M3)

Now: `readSse` (`sse.ts:13-15`) splits on `"\n\n"` only; `event: delta\r\n…` gives the event name `"delta\r"`, which never matches, so the stream ends as `NetworkError`. At end of stream the tail block is dispatched even without its blank line, so `event: done\ndata: {"x":` reaches `JSON.parse` and the client throws `BadReplyError` ("bad reply") for what was a dropped connection.

Replace the header comment, exactly:

```ts
// Reads server-sent events from a response body (the API writes them with hono's streamSSE, "\n" line endings;
// "\r\n" and "\r" are read as "\n" too): blocks separated by a blank line, each with "event:" and "data:" lines;
// several data lines join with "\n". Comment lines (":") and other fields are ignored. A last block with no blank
// line after it was cut off and is dropped, as the SSE spec says. onEvent returning false stops reading.
```

and the three lines from `buffer += …` to `buffer = done ? "" : …`, exactly:

```ts
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A "\r" at the end may be the first half of "\r\n", so it waits for the next chunk.
      const held = !done && buffer.endsWith("\r") ? "\r" : "";
      const blocks = (held === "" ? buffer : buffer.slice(0, -1)).replace(/\r\n?/g, "\n").split("\n\n");
      buffer = (blocks.pop() ?? "") + held;
```

### Tests

- `test/config.test.ts`, in `stale`: `expect(isStale(Number.NaN, 1)).toBe(true);` and `expect(isStale(Number("garbage"), Date.now())).toBe(true);`.
- `packages/api-client/test/sse.test.ts`: the "last block" test changes (the spec drops a cut-off block), and one test is added, exactly:

  ```ts
    it("multi data lines, comments, ids, empty blocks; a last block with no blank line is dropped", async () => {
      const got: SseEvent[] = [];
      await readSse(bodyOf([enc(": hi\nid: 1\nevent: a\ndata: x\ndata: y\n\nevent: b\n\ndata: z")]), (e) => { got.push(e); return true; });
      expect(got).toEqual([{ event: "a", data: "x\ny" }]);
    });
    it("reads CRLF and CR line endings, including a CRLF split across chunks", async () => {
      const got: SseEvent[] = [];
      await readSse(bodyOf([enc('event: delta\r\ndata: {"a":1}\r'), enc("\n\r\nevent: done\rdata: 2\r\r")]), (e) => { got.push(e); return true; });
      expect(got).toEqual([{ event: "delta", data: '{"a":1}' }, { event: "done", data: "2" }]);
    });
  ```
- `packages/api-client/test/client.test.ts`, in "streamed tasks", above "a stream that stops before done", exactly:

  ```ts
    it("a stream cut off in the middle of its done event is a NetworkError, not a bad reply", async () => {
      const signer = softwareSigner("dev_phone");
      const { client } = fakeApi([sseReply(['event: delta\ndata: {"text":"x"}\n\n', 'event: done\ndata: {"credits":'])], { device: () => signer });
      await expect(client.explain({ word: "w", transcript: "t" }, { key: "key_explain_00004", onDelta: () => undefined })).rejects.toBeInstanceOf(NetworkError);
    });
  ```
- Same file, "matches the waypoint-v1 request vector" (M3 test gap): add `signature: string` to `RequestVector`, and at the end of the test, exactly:

  ```ts
      // The published bytes: the canonical input (with the vector's own nonce) and its signature.
      const published = requestSigningInput(r);
      expect(Buffer.from(published).toString("hex")).toBe(r.signing_input);
      expect(await verifyP256(publicKey, fromBase64Url(r.signature), published)).toBe(true);
  ```

Each bullet is one test (all above):
- `isStale` is true for `NaN` and for `Number("garbage")`.
- A cut-off last block is dropped; CRLF and CR (also a CRLF split across chunks) parse to clean event names.
- A stream cut inside `done` is a `NetworkError`.
- The request vector's `signing_input` matches byte for byte and its `signature` verifies.

### Device check

1. Airplane mode, tap "Continue with Apple", finish Apple's sheet: "Couldn't sign in with Apple. Check your connection and try again." Cancel Apple's sheet: no message.
2. In a release build (`npx expo run:ios --configuration Release`), open `waypoint://dev/audio`: the route does not open.
3. With the API URL pointed at a host that answers 500 for `GET /v1/devices`, open a paid action: "Couldn't set up this iPhone" with Check again, not "Setting up this iPhone".

Not in this PR: restarting an expired pairing and clearing the signer on sign-out (M27b); the waiting-screen copy (design check); a busy guard on the Apple button.

---

## H6 · Mobile: missing tests (Swift crypto refusals, gate, constraints, labels, blocks, search ranking)

Branch `test/h6-mobile-tests`. Builds on `main` at `856b81d`. Tests only: no file under `src/` or `ios/Core/` changes. Files, and no others:

- `apps/mobile/modules/waypoint-keys/ios/Tests/RefusalTests.swift` (new; `Package.swift` already picks up every file in `Tests/`)
- `apps/mobile/test/gate.test.ts`, `transcript.test.ts`, `blocks.test.ts`, `labels.test.ts`, `vectors.test.ts`, `chunks.test.ts`, `schema.test.ts`

Every test below passes on `main` and was checked to fail with the mutant the reviews found surviving (named in each bullet). If one fails on `main`, stop and say so in the pull request: it is a bug, not a test to change.

### Swift (M26a)

New `RefusalTests.swift`, exactly:

```swift
import CryptoKit
import Foundation
import Testing
@testable import KeysCore

// Inputs each format must refuse, one check per test (M26a review: these checks had no test).
private let v = try! readVectors("waypoint-v1.json", as: WaypointV1.self)

private func b64(_ text: String) -> Data { try! Base64URL.decode(text) }

@Test func envelopeParseRefusesACiphertextLengthForTheOtherPurpose() {
  var bytes = b64(v.group_key_envelope.envelope)
  bytes[1] = 2 // account key: its ciphertext is 80 bytes, this one is 48
  #expect(throws: KeysError.badEnvelope) { try Envelope.parse(bytes) }
}

@Test func envelopeParseRefusesAnEncThatIsNotAnUncompressedPoint() {
  var bytes = b64(v.group_key_envelope.envelope)
  bytes[2] = 0x02
  #expect(throws: KeysError.badEnvelope) { try Envelope.parse(bytes) }
}

@Test func envelopeParseRefusesASignerIdThatIsNotAnId() {
  var bytes = b64(v.group_key_envelope.envelope)
  bytes[2 + 65 + 2 + 48 + 1] = 0x20 // first character of the signer id becomes a space
  #expect(throws: KeysError.badEnvelope) { try Envelope.parse(bytes) }
}

@Test func sealedResultRefusesAnotherPurposeByte() {
  let s = v.sealed_result
  var bytes = b64(s.sealed)
  bytes[1] = 1
  let key = try! P256.KeyAgreement.PrivateKey(rawRepresentation: Data(hex: s.device_private_key))
  #expect(throws: KeysError.badSealed) { try SealedResult.open(bytes, jobId: s.job_id, deviceId: s.device_id, recipient: key) }
}

@Test func pairingRefusesANonceThatIsNot32Bytes() {
  let p = v.pairing
  let short = Base64URL.encode(Data(repeating: 7, count: 16))
  #expect(throws: KeysError.badNonce) { try Pairing.commitment(signPub: p.new_sign_pub, boxPub: p.new_box_pub, newNonce: short) }
  #expect(throws: KeysError.badNonce) {
    try Pairing.code(newSignPub: p.new_sign_pub, newBoxPub: p.new_box_pub, approverSignPub: p.approver_sign_pub, approverNonce: short, newNonce: p.new_nonce)
  }
}

@Test func recoveryUnwrapRefusesAnotherVersionByte() throws {
  let r = v.recovery
  let wrapKey = try Recovery.wrapKey(entropy: Data(hex: r.entropy), userId: r.user_id)
  var blob = b64(r.blob)
  blob[0] = 2
  #expect(throws: KeysError.badRecovery) { try Recovery.unwrap(blob, wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id) }
}

@Test func recoveryWrapRefusesAWrongKeyOrNonceLength() throws {
  let r = v.recovery
  let wrapKey = try Recovery.wrapKey(entropy: Data(hex: r.entropy), userId: r.user_id)
  #expect(throws: KeysError.badRecovery) {
    try Recovery.wrap(accountKey: Data(repeating: 1, count: 32), wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id)
  }
  #expect(throws: KeysError.badRecovery) {
    try Recovery.wrap(accountKey: Data(hex: r.account_key), wrapKey: wrapKey, userId: r.user_id, accountDeviceId: r.account_device_id, nonce: Data(repeating: 1, count: 11))
  }
}

@Test func lockedContentWritesAllFourKeyVersionBytes() throws {
  let key = SymmetricKey(data: Data(repeating: 9, count: 32))
  let locked = try LockedContent.lock(key: key, keyVersion: 0xffff_fff1, objectContext: Data([1]), plaintext: Data([2]), nonce: Data(repeating: 3, count: 12))
  #expect([UInt8](locked.prefix(5)) == [1, 0xff, 0xff, 0xff, 0xf1])
  #expect(try LockedContent.keyVersion(locked) == 0xffff_fff1)
  #expect(try LockedContent.unlock(key: key, objectContext: Data([1]), locked: locked) == Data([2]))
}

@Test func publicKeyRawRefusesACompressedPrefix() {
  let compressed = Base64URL.encode(Data([2] + Array(repeating: 1, count: 64)))
  #expect(throws: KeysError.badPublicKey) { try PublicKeys.raw(compressed) }
}
```

Each bullet is one test (all above):
- Envelope: a ct length for the other purpose (mutant: no `ctLength == keyBytes + 16`), an `enc` not starting `0x04`, a signer id with a space (mutant: no `checkId`).
- Sealed result: purpose byte 1 (mutant: no `b[1] == 3`; the open itself still succeeds, because the AAD is the fixed `[1, 3]`).
- Pairing: a 16-byte nonce in `commitment` and `code` (mutant: `checkNonce` always passes).
- Recovery: version byte 2 (mutant: no `b[0] == 1`; the AAD's `1` is fixed, so the open succeeds); a 32-byte key and an 11-byte nonce (mutant: no length guard).
- Locked content: key version `0xfffffff1` writes `ff ff ff f1` (mutant: top byte).
- `PublicKeys.raw` refuses a `0x02` prefix.

Not covered, on purpose: `text.utf8.count % 4 != 1` and `signature.count == 64` (equivalent mutants: later code refuses the same inputs).

### TypeScript

Add each block inside the file's existing top-level `describe` (at its end), exactly:

`test/gate.test.ts` (M1b):

```ts
  it("shows sign-in once Clerk has loaded signed out, even for a phone that signed in before and waited", () => {
    expect(decideGate({ ...base, clerkLoaded: true, clerkSignedIn: false, signedInBefore: true, waitedMs: 5000 })).toBe("sign_in");
  });

  it("a signed-in result wins after a long wait on a phone that signed in before", () => {
    expect(decideGate({ ...base, clerkLoaded: true, clerkSignedIn: true, signedInBefore: true, waitedMs: 15000 })).toBe("app");
  });
```

`test/transcript.test.ts` (M6):

```ts
  it("a segment that only touches the start edge of a part does not overlap it", () => {
    const part = { startMs: 60_000, durationMs: 60_000 };
    expect(partsNeedingTranscription([part], [{ tStart: 50_000, tEnd: 60_000 }])).toEqual([part]);
  });

  it("a part of exactly 10 seconds still needs transcription; one of 9,999 ms does not", () => {
    expect(partsNeedingTranscription([{ startMs: 0, durationMs: 10_000 }], [])).toEqual([{ startMs: 0, durationMs: 10_000 }]);
    expect(partsNeedingTranscription([{ startMs: 0, durationMs: 9_999 }], [])).toEqual([]);
  });
```

`test/blocks.test.ts` (M7), in `describe("groupBlocks", ...)` above "empty input gives no blocks":

```ts
  it("a line indented more than 0.15 from the block's first line starts a new block", () => {
    const blocks = groupBlocks([line("Solve:", 0.1, 0.1), line("x + 1 = 2", 0.4, 0.15)]);
    expect(blocks.map((b) => b.text)).toEqual(["Solve:", "x + 1 = 2"]);
  });

  it("a line on the same row at another x stays in the block", () => {
    const blocks = groupBlocks([line("Name:", 0.1, 0.1, 0.2), line("Date:", 0.5, 0.105, 0.2)]);
    expect(blocks.map((b) => b.text)).toEqual(["Name: Date:"]);
  });

  it("the gap limit uses the median line height, not the tallest line", () => {
    const blocks = groupBlocks([line("one", 0.1, 0.1), line("two", 0.1, 0.18), line("TITLE", 0.1, 0.5, 0.4, 0.1)]);
    expect(blocks.map((b) => b.text)).toEqual(["one", "two", "TITLE"]);
  });
```

`test/labels.test.ts` (M10a):

```ts
  it("dateLine uses the offset: 23:30 UTC on Nov 18 is already Nov 19 in UTC+10", () => {
    expect(dateLine(Date.UTC(2026, 10, 18, 23, 30), UTC_PLUS_10)).toBe("THURSDAY, NOV 19");
  });

  it("usedLabel gives nothing for a time in the future", () => {
    const now = at(2026, 11, 19, 12, 0);
    expect(usedLabel(at(2026, 11, 20, 12, 0), now, UTC_PLUS_10)).toBeNull();
  });
```

`test/vectors.test.ts` (M9a):

```ts
  it("fuse breaks a tie by the smaller id, and uses k = 60", () => {
    expect(fuse([[2], [1]])).toEqual([1, 2]);
    // With k = 60, rank 5 in both lists (2/65) beats rank 1 in one list (1/61); with k = 1 it would not (2/6 < 1/2).
    expect(fuse([[1, 2, 3, 4, 5], [6, 7, 8, 9, 5]])).toEqual([5, 1, 6, 2, 7, 3, 8, 4, 9]);
  });
```

`test/chunks.test.ts` (M9a):

```ts
  it("two paragraphs that add up to exactly 120 words stay in one chunk", () => {
    const chunks = chunkCapture({ id: "cap-3", kind: "page", t: 0, text: `${words(60)}\n\n${words(60)}` });
    expect(chunks.map((c) => count(c.text))).toEqual([120]);
  });
```

`test/schema.test.ts` (M4):

```ts
  it("rejects a negative recorded_ms, a negative segment start and a capture kind of 'video'", () => {
    addSpace();
    expect(() =>
      db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at, recorded_ms) VALUES ('x', 's1', 'recording', 't', 'saved', 1, -1)"),
    ).toThrow();
    addSession();
    expect(() => db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('x1', -1, 10, 'hi', 'device')")).toThrow();
    expect(() => db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('v1', 'x1', 'video', 0, 'v.mov')")).toThrow();
  });

  it("rejects a card made_by other than device_model or quiz_miss, and a search vector with dim 0", () => {
    addSpace();
    addSession();
    expect(() =>
      db.run("INSERT INTO cards (id, session_id, kind, front, back, made_by, created_at, due_at, fsrs) VALUES ('c1', 'x1', 'term', 'f', 'b', 'cloud', 1, 1, '{}')"),
    ).toThrow();
    db.run("INSERT INTO chunks (session_id, source, t_start, t_end, text) VALUES ('x1', 'transcript', 0, 10, 'hello')");
    expect(() => db.run("INSERT INTO search_index (chunk_id, model_version, dim, scale, vector) VALUES (1, 'v1', 0, 1.0, x'')")).toThrow();
  });

  it("deleting a capture deletes its chunks", () => {
    addSpace();
    addSession();
    db.run("INSERT INTO captures (id, session_id, kind, t, file) VALUES ('p1', 'x1', 'page', 0, 'p1.jpg')");
    db.run("INSERT INTO chunks (session_id, source, capture_id, t_start, t_end, text) VALUES ('x1', 'page', 'p1', 0, 0, 'page words')");
    db.run("DELETE FROM captures WHERE id = 'p1'");
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM chunks")?.n).toBe(0);
  });
```

Each bullet is one test (all above):
- Gate: loaded and signed out beats the offline grace (mutant: rules 3 and 4 swapped); signed in wins at 15 s.
- Transcript: a segment ending at a part's start does not cover it (mutant `>=`); exactly 10,000 ms needs transcription (mutant `<=`).
- Blocks: indent split (mutant: rule removed); same-row exemption; median, not max.
- Labels: `dateLine` with UTC+10 (mutant: offset dropped); a future `usedLabel` is null (mutant `Math.abs`).
- `fuse` tie-break and `k = 60`.
- `chunkCapture` keeps 60 + 60 words together (mutant `>=`).
- Schema: `recorded_ms >= 0`, `t_start >= 0`, `captures.kind`, `cards.made_by`, `dim > 0`, `chunks.capture_id` cascade.

No device check (tests only).

Not in this PR: any source change; the `model_version` filter (already covered in one direction); component tests.
