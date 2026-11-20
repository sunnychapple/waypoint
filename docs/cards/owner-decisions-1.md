# Owner decisions 1: D1a to D10

The owner answered open questions 7 (the extension added in hardening 4), 29 (its extension), and 52 to 56 (`docs/build-plan.md`, "Open questions"). This file turns the answers into cards. Every block was written against `main` at `3c90a85` and checked on a copy of it (see "Order"). Question 53 needs no code: `docs/architecture.md` section 1 and `docs/security.md` are corrected in the pull request that adds this file. Review fixes from PR #138 are folded in (D1 was split into D1a and D1b).

Server cards follow `AGENTS.md` and the server card rules in `docs/cards/hardening-1.md`, "Server hardening cards". App cards follow `docs/cards/mobile-stage3-4.md`, section 1 ("What these cards add to the rules").

## Decisions

| Question | Owner's answer | Cards |
|---|---|---|
| 7 (extended) | On Clerk `user.deleted`, release that billing account's Own it and Plus purchase rows, so a later account can claim them once: the entitlement only, no credits, no monthly reset. Packs stay with the deleted account. Default (owner may say otherwise): a Plus renewal after the claim gives the new account its monthly credits, because the person paid for that renewal. | D1a, D1b |
| 29 (extended) | A per-user rate limit on `POST /v1/jobs`: a `ratelimits` binding like `LINK_VIEWS`, 30 a minute, answering 429. | D2 |
| 52 | One notes database per Clerk user (`waypoint-<clerk user id>.db`), opened after sign-in and closed on sign-out. Nothing is deleted; each person sees only their own notes. A short design first (below). | D6, D7 |
| 53 | Keep notes in the iPhone backup. Correct architecture section 1 and `docs/security.md`: notes live on the device and in the person's own iPhone backup (encrypted by Apple; end to end with Advanced Data Protection). | none (docs, in this pull request) |
| 54 | Play a session's own audio from the session screen with `expo-audio`; tapping a transcript line jumps to it. | D9 |
| 55 | A per-user daily byte cap on changes and links (200 MB a day), the hourly cleanup deleting expired links' R2 objects, and a way to buy more with credits from the existing wallet: when the cap is hit, the app shows a sheet ("You've synced 200 MB today. Add 1 GB more for today for N credits"). The price is one named constant, 100 credits per extra 1 GB for the day, to be confirmed (open question 57). | D3, D4, D5, D8 |
| 56 | "When adding someone you can decide what they can see, history or from there." The invite keeps its "From now" / "Everything so far" choice. A "from now" member's iPhone drops (does not defer) a change to a note started before they joined; an "everything" member gets all. | D10 |

## Design: one notes database per person (question 52)

**Today.** `platform/db.ts` opens one SQLite file, `waypoint.db` in `Documents/SQLite`, for whoever is signed in. Signing out keeps it (board K1), so the next person who signs in on the same iPhone or iPad sees the first person's notes. The device keys are already per person (the keys module stores them by server user id), and so are the device settings (`statusKey(user)`, `userIdKey(clerkId)`, `knownDevicesKey(user)`).

**After D6.** The notes of each person live in `Documents/SQLite/waypoint-<clerk user id>.db`. The sign-in gate (`useGate` in `platform/auth.tsx`) opens that file as soon as Clerk says who is signed in, during the same render, before any screen reads notes. Sign-out (`useSignOut`) closes it right after Clerk's sign-out and waits until the Keychain no longer names the person; the gate also closes it whenever Clerk says nobody is signed in (a session that ended elsewhere or expired). Which of these happens is a pure function, `notesStep`, tested in `src/core`. Nothing is deleted: the next time that person signs in, their file opens again. Someone else gets their own file, which starts with the default space, like a new install. The Clerk id of the person whose notes are open is kept in the Keychain (`waypoint.db_user`, readable after the first unlock). It replaces `waypoint.signed_in_before`: "signed in before" now means "a person's notes are remembered", which is what the offline grace in `decideGate` needs.

**The file that exists today.** Before opening a person's own file for the first time, the app looks at `waypoint.db`. It takes it over only if it is theirs or nobody's: the file's settings record every Clerk id that signed in with it (`server_user_id:<clerk id>`, written by device registration), and `legacyIsTheirs` (pure, tested) says yes when that list holds the person or is empty. Then the app folds the write-ahead log in (`PRAGMA wal_checkpoint(TRUNCATE)`), closes the file and renames it to their name. It is never copied, so the notes exist once. If the file records only other people, it stays untouched until one of them signs in, and this person starts with a new file. If the old file cannot be read or renamed, this person also starts with a new file and the old one stays as it is (nothing is logged: the app has no log, and `AGENTS.md` forbids `console.log`). If the old file records two people (a shared iPad today), the first of them to sign in gets it, which is no worse than today.

**Audio, page photos and overviews.** They stay where they are: `Documents/sessions/<session id>/…` and `Documents/overviews/<id>.m4a|.mp4`. Every id is a random UUID, so two people's files never collide, and only a person's own database names their files, so no screen can show another person's. Moving the files into a folder per person would change the paths that three native modules write (`waypoint-audio`, `waypoint-pages`, `waypoint-video`/`waypoint-voices`) for no gain in privacy against someone who can already open the app as themselves. The one place that adds up the whole folder is the storage screen (below).

**Silent pushes and alerts.** A silent "sync" push can wake the app with no screen. The headless task opens the notes of the person in `waypoint.db_user`. Nobody signed in: nothing is opened and nothing syncs (D6 adds this check to the task). Signed in as B while a push for one of A's groups arrives (A's device and push token stay registered on the server): B's database has no such group, so `runOnce` returns at once, as it does today for a group with no space. A's changes wait on the server and arrive when A signs in again, from A's last sequence number. An alert push for A (a finished job, a device request) can still show on the lock screen while B is signed in. It carries no content ("Your result is ready."); tapping it opens a job B's database does not have, which shows nothing. Removing a signed-out person's push token is not part of this decision.

**The storage screen.** "Recordings and pages" adds up the sizes of the open person's session folders only (D7), not the whole `sessions` folder.

**Background work at sign-out.** The tabs and their hooks unmount when the gate turns to sign-in, so the loops stop. A loop that holds the closed file gets an error on its next read or write and stops. Work that awaits and then writes through `writeDb` (which opens whoever's notes are open now) could write into the next person's notes, so it reads `dbGeneration()` (a counter that every open and close moves) before it awaits and writes only if it has not moved: D6 does this in the indexer, D8 in the sync-limit handling and the purchase. Other loops write rows of a session, which fail their foreign key in another person's file. A screen on its way out keeps showing what it showed (`useQuery` does not open anything while nobody is signed in). The `LAST_USER_KEY` write in `platform/device.ts` runs only while notes are open.

**Not changed.** Device registration, keys, pairing and recovery are already per person. Signing out never deletes anything (K1). There is no switch-person menu and no kid or parent mode: a person signs out and the other signs in.

## Design: buying more sync for today (question 55)

D3 counts the bytes of every locked change (`POST /v1/groups/:id/changes`) and every shared link's data (`POST /v1/links`, counted once its row exists) against a daily budget per person in a new D1 table, `sync_days (user_id, day, bytes)`, where `day` is the UTC day. The budget is `SYNC_DAILY_BYTES` plus the extras bought for that day, one row each in `sync_extras (user_id, key, day, bytes)` (same migration). One SQL statement checks and counts, so two requests at once cannot both pass. Over the budget, the reply is 429 `rate_limited` with the message `daily sync limit reached` and `retry_after` = the seconds until 00:00 UTC. Nothing is stored for that request: `idempotent()` does not store a reply with `Retry-After` (H9), so the same request goes through after the person buys more. Media files are not counted: they have their own 3 GB cap.

D5 adds `POST /v1/sync/extra { credits }`, signed and idempotent. It spends through the Wallet Durable Object the way an instant task does: a hold of `SYNC_EXTRA_CREDITS` with id `sync_extra:<user id>:<Idempotency-Key>`, then one `sync_extras` row whose primary key is (user, Idempotency-Key), then a settle at the full price (ids `sync_extra_settle:…`, and `sync_extra_release:…` if the D1 write fails). The row's key makes the grant idempotent: the same request never adds its gigabyte twice. If the settle fails after the row was written, the same request sent again (its hold still open) settles it then. There is no new wallet command and no App Store product. `credits` in the body is the price the app showed: any other number gets 409 "price changed" and nothing is held. 402 and its shortfall work as for any task, so the app's Out of credits path applies.

D8 is the app. When a send gets the limit, the app stops sending until the time the server gave (pulls go on), the space screen says so with "Add more for today", and that button opens the sheet. Making a shared link that hits the limit opens the sheet directly. The sheet says "You've synced 200 MB today", offers "Add 1 GB · 100 credits", and on success sends what waited.

## Order

| Card | Branch | Area | Merge after |
|---|---|---|---|
| D1a | `feat/d1a-release-purchases` | API: a deleted account's Own it and Plus can be claimed once (question 7). Migration `0010` | `main` at `3c90a85` or later |
| D1b | `feat/d1b-claimed-purchases` | API: no take-back on refund and no yearly top-ups for a claimed row | D1a (the column and the claim) |
| D2 | `feat/d2-job-rate-limit` | API: 30 new jobs a minute per person (question 29) | `main` at `3c90a85` or later |
| D3 | `feat/d3-sync-budget` | API and contracts: the daily byte budget on changes and links (question 55). Migration `0011` | D1a (migration number, and both edit `db/d1/test/schema.test.mjs`) |
| D4 | `feat/d4-cleanup-links` | API: the hourly cleanup deletes expired links and old day counts | D3 (the two tables) |
| D5 | `feat/d5-sync-extra` | API, contracts and API client: `POST /v1/sync/extra` | D3 (`sync_extras`; both edit `packages/contracts/src/sync.ts`) |
| D6 | `feat/d6-notes-per-person` | App: one notes database per person (question 52) | `main` at `3c90a85` or later |
| D7 | `feat/d7-storage-per-person` | App: the storage screen counts only your recordings | `main` at `3c90a85` or later |
| D8 | `feat/d8-sync-limit-sheet` | App: the sync limit sheet (question 55) | D5 (the API client method), D6 (`dbGeneration`; both edit `apps/mobile/src/platform/sync.ts`) |
| D9 | `feat/d9-play-recording` | App: play a recording from the session screen (question 54) | `main` at `3c90a85` or later |
| D10 | `fix/d10-history-from-now` | App: "from now" members drop changes to older notes (question 56) | `main` at `3c90a85` or later |

D1a, D2, D6, D7, D9 and D10 touch different files and can be built at the same time. D1b and D3 wait for D1a, D4 and D5 for D3, D8 for D5 and D6. Every card's blocks are written against `main` at `3c90a85`; a card that merges after another one finds the lines it changes unchanged, because no two cards change the same lines (in the shared files the second card adds its lines next to the first card's, as each card says).

Every block was applied, card by card in the order above, to a copy of `main` at `3c90a85` (after `npm install`) and checked there:

- `npm run typecheck`: exit 0.
- `npm test`: api 1,046 = 1,019 + 27, mobile 468 = 449 + 19, api-client 49 = 48 + 1, d1-schema 59 = 56 + 3; the other packages unchanged.
- `npm run bundle -w @waypoint/api`: the dry run passes.
- `npm run export:ios -w @waypoint/mobile`: exports.
- No card changes Swift, so `npm run test:swift -w @waypoint/mobile` is unchanged.

Then each card's source changes were removed and its tests kept: every new test that checks new behaviour failed on the code without them. The tests that pass either way are marked as guards in their cards (D1a: the pack, "account still exists" and "never existed" tests; D10: the "everything" test).

---

## D1a · API: a deleted account's Own it and Plus can be claimed once

Branch `feat/d1a-release-purchases`. From `main` at `3c90a85`. No dependency. Migration `0010_purchases_released.sql` (merge before D3, which adds `0011`). Files, and no others:

- `db/d1/migrations/0010_purchases_released.sql` (new), `db/d1/test/schema.test.mjs`
- `apps/api/src/webhooks/clerk.ts`, `apps/api/test/clerk-webhook.test.ts`
- `apps/api/src/apple/purchases.ts`, `apps/api/src/apple/route.ts`, `apps/api/test/apple-purchase.test.ts`

**Why.** Someone who deletes their account and signs up again can never restore Own it or a running Plus: the purchase rows keep the old billing account (409 "purchase belongs to another account"). The owner's decision (open question 7): on `user.deleted`, that account's Own it and Plus rows are released, and the next account to send one of those transactions claims them once. It gets the entitlement only. The credits (Own it's 2,000) and the monthly reset (Plus) went to the deleted account's wallet when the transaction was first recorded, so the claim gives no credits and no reset (D1b makes sure nothing is taken back from the new wallet later either). Packs are not released.

Default, unless the owner says otherwise: a Plus renewal after the claim is a new transaction the person paid for, so it resets the new account's monthly credits as any renewal does.

A released row can be claimed only while no account with its billing account exists, so a release that happened while the user row was somehow still there cannot be claimed by someone else, and a claimed row belongs to the claiming account like any other row. Two accounts claiming at the same moment cannot both win: the claim is one `UPDATE` that moves only rows whose account is gone, and the ownership check runs after it.

### 1. The migration

`db/d1/migrations/0010_purchases_released.sql` (new), exactly:

```sql
-- Own it and Plus rows of an account that was deleted (Clerk user.deleted, open question 7). The next account to send
-- such a transaction claims its rows once: the entitlement only, never the credits or the monthly reset it already gave.
ALTER TABLE purchases ADD COLUMN released_at INTEGER;
-- Accounts deleted before this migration: their rows are released now (0: the time is not known).
UPDATE purchases SET released_at = 0
  WHERE kind IN ('non_consumable', 'subscription') AND billing_account_id NOT IN (SELECT billing_account_id FROM users);
```

The `UPDATE` releases the rows of accounts deleted before this ships (`released_at` 0: the time is not known).

`db/d1/test/schema.test.mjs`:

- In `EXPECTED`, replace the `purchases` line with, exactly:

```js
  purchases: ["transaction_id", "original_id", "billing_account_id", "product_id", "kind", "status", "purchased_at", "released_at"],
```

- In `EXPECTED_TYPES`, replace the `purchases` line with, exactly:

```js
  purchases: { transaction_id: "TEXT", original_id: "TEXT", billing_account_id: "TEXT", product_id: "TEXT", kind: "TEXT", status: "TEXT", purchased_at: "INTEGER", released_at: "INTEGER?" },
```

- Add at the end of the file, exactly:

```js

test("0010 releases the Own it and Plus rows of accounts already deleted, and nothing else", () => {
  const names = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();
  const at = names.indexOf("0010_purchases_released.sql");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrations.slice(0, at)) db.exec(sql);
  seedUser(db);
  const insert = db.prepare(
    "INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES (?, ?, ?, 'p', ?, 'active', 1)",
  );
  insert.run("t_gone_own", "t_gone_own", "ba_gone", "non_consumable");
  insert.run("t_gone_plus", "t_gone_plus", "ba_gone", "subscription");
  insert.run("t_gone_pack", "t_gone_pack", "ba_gone", "consumable");
  insert.run("t_live_own", "t_live_own", "ba_1", "non_consumable");
  for (const sql of migrations.slice(at)) db.exec(sql);
  const rows = db.prepare("SELECT transaction_id, released_at FROM purchases ORDER BY transaction_id").all();
  assert.deepEqual(
    rows.map((r) => [r.transaction_id, r.released_at]),
    [["t_gone_own", 0], ["t_gone_pack", null], ["t_gone_plus", 0], ["t_live_own", null]],
  );
});
```

### 2. `user.deleted` releases the rows

`apps/api/src/webhooks/clerk.ts`: replace the `user.deleted` branch, so it reads, exactly:

```ts
    } else if (event.type === "user.deleted") {
      // Own it and Plus are released (open question 7): the next account to send one of these transactions claims it
      // once, for the entitlement only. Packs stay with the deleted account, and so does its wallet.
      await c.env.DB.prepare(
        `UPDATE purchases SET released_at = ? WHERE kind IN ('non_consumable', 'subscription')
           AND billing_account_id = (SELECT billing_account_id FROM users WHERE clerk_id = ?)`,
      )
        .bind(now, event.data.id)
        .run();
      await c.env.DB.prepare("DELETE FROM users WHERE clerk_id = ?").bind(event.data.id).run();
    }
```

`apps/api/test/clerk-webhook.test.ts`: in `describe("user.deleted")`, before the test `"an unknown Clerk id gives 200 and changes nothing"`, add exactly:

```ts
  test("releases the user's Own it and Plus rows, keeps their packs and other users' rows unreleased", async () => {
    await send(userCreated("user_abc"));
    const billing = (await db.prepare("SELECT billing_account_id FROM users").first<{ billing_account_id: string }>())?.billing_account_id ?? "";
    const insert = "INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at) VALUES (?, ?, ?, ?, ?, 'active', 1)";
    await db.prepare(insert).bind("t_own", "t_own", billing, "waypoint.own_it", "non_consumable").run();
    await db.prepare(insert).bind("t_plus", "t_plus", billing, "waypoint.plus.monthly", "subscription").run();
    await db.prepare(insert).bind("t_pack", "t_pack", billing, "waypoint.credits.1000", "consumable").run();
    await db.prepare(insert).bind("t_other", "t_other", "ba_other", "waypoint.own_it", "non_consumable").run();

    const res = await send(JSON.stringify({ type: "user.deleted", data: { id: "user_abc" } }));
    expect(res.status).toBe(200);
    const rows = await db.prepare("SELECT transaction_id, released_at FROM purchases ORDER BY transaction_id").all<{ transaction_id: string; released_at: number | null }>();
    expect(rows.results).toEqual([
      { transaction_id: "t_other", released_at: null },
      { transaction_id: "t_own", released_at: NOW },
      { transaction_id: "t_pack", released_at: null },
      { transaction_id: "t_plus", released_at: NOW },
    ]);
  });
```

### 3. The next account claims the rows, for the entitlement only

`apps/api/src/apple/purchases.ts`:

- Replace the `PurchaseRow` type with, exactly:

```ts
type PurchaseRow = { billing_account_id: string; status: "active" | "refunded" | "revoked" | "expired"; released_at: number | null };
```

- In `applyTransaction`, replace the block `if (txn.inAppOwnershipType === "PURCHASED") { … }` (the owner check) with, exactly:

```ts
  if (txn.inAppOwnershipType === "PURCHASED") {
    // Rows released by a deleted account (released_at, open question 7) are claimed first, in one statement that moves
    // only rows whose account is gone: of two accounts claiming at once, the second finds them owned and moves nothing.
    await db
      .prepare(
        `UPDATE purchases SET billing_account_id = ? WHERE original_id = ? AND billing_account_id <> ? AND released_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM users u WHERE u.billing_account_id = purchases.billing_account_id)`,
      )
      .bind(account.billing_account_id, txn.originalTransactionId, account.billing_account_id)
      .run();
    // Then, as before: a subscription or purchase belongs to the account that recorded it first, renewals included.
    const owner = await db
      .prepare("SELECT 1 AS found FROM purchases WHERE original_id = ? AND billing_account_id <> ? LIMIT 1")
      .bind(txn.originalTransactionId, account.billing_account_id)
      .first<{ found: number }>();
    if (owner !== null) return { ok: false, reason: "other_account" };
  }
```

  The ownership check reads the rows after the claim, so it sees whoever won, before anything is granted.

- Replace `.prepare("SELECT billing_account_id, status FROM purchases WHERE transaction_id = ?")` with, exactly:

```ts
    .prepare("SELECT billing_account_id, status, released_at FROM purchases WHERE transaction_id = ?")
```

- Replace the line `if (!shared) {` (the one above `const id = transactionCommandId(txn.transactionId);`) with, exactly:

```ts
    // A released row gives the entitlement only: its credits or monthly reset went to the deleted account.
    if (!shared && row.released_at === null) {
```

### 4. The app's token of a deleted account

**Why.** The app sets each purchase's `appAccountToken` to the user id (M14). The deleted account's id is in every one of its transactions, so the route refused them with 409 before `applyTransaction` could see the released rows. A token that names no account is let through only when rows of that purchase were released.

`apps/api/src/apple/route.ts`:

- After the line `import { idempotent } from "../idempotency.ts";`, add exactly:

```ts
import type { Db } from "../storage.ts";
```

- After the line `export type ApplePurchaseDeps = { now: () => number; rootSha256: string };`, add exactly:

```ts

// True when the account named by `token` no longer exists and rows of this purchase were released (open question 7).
async function releasedByDeletedAccount(db: Db, originalId: string, token: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS found FROM purchases WHERE original_id = ? AND released_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = ?) LIMIT 1")
    .bind(originalId, token)
    .first<{ found: number }>();
  return row !== null;
}
```

- Replace the `if (` block that throws `"purchase belongs to another account"` for another `appAccountToken` with, exactly:

```ts
    // Another person's token is refused, unless that account is gone and released this purchase (open question 7):
    // then applyTransaction decides who may claim it.
    if (
      txn.inAppOwnershipType === "PURCHASED" &&
      txn.appAccountToken !== undefined &&
      txn.appAccountToken.toLowerCase() !== user.id.toLowerCase() &&
      !(await releasedByDeletedAccount(c.env.DB, txn.originalTransactionId, txn.appAccountToken.toLowerCase()))
    ) {
      throw new ApiFailure("conflict", "purchase belongs to another account");
    }
```

`apps/api/test/apple-purchase.test.ts`:

- Replace these import lines:

```ts
import { addMonths } from "../src/apple/products.ts";
import { applePurchaseRoute } from "../src/apple/route.ts";
```

  with exactly:

```ts
import { addMonths, appleProduct } from "../src/apple/products.ts";
import { applyTransaction, type PurchaseOutcome } from "../src/apple/purchases.ts";
import { applePurchaseRoute } from "../src/apple/route.ts";
import { AppleTransactionSchema } from "../src/apple/transaction.ts";
```

- Replace the line `import type { Db } from "../src/storage.ts";` with exactly:

```ts
import type { Db, DbStatement } from "../src/storage.ts";
```

- Add at the end of the file, exactly:

```ts

// A Db that runs `between` right after the first statement it is given, before handing back that statement's result:
// another request lands in the middle of this one.
function interrupted(inner: Db, between: () => Promise<void>): Db {
  let done = false;
  const once = async (): Promise<void> => {
    if (done) return;
    done = true;
    await between();
  };
  const wrap = (statement: DbStatement): DbStatement => ({
    bind: (...values: unknown[]) => wrap(statement.bind(...values)),
    first: async <T,>() => {
      const result = await statement.first<T>();
      await once();
      return result;
    },
    all: async <T,>() => {
      const result = await statement.all<T>();
      await once();
      return result;
    },
    run: async () => {
      const result = await statement.run();
      await once();
      return result;
    },
  });
  return { prepare: (query: string) => wrap(inner.prepare(query)) };
}

// What Clerk's user.deleted does to an account's purchases (apps/api/src/webhooks/clerk.ts).
async function deleteAccount(id: string): Promise<void> {
  await db.prepare("UPDATE purchases SET released_at = ? WHERE billing_account_id = ? AND kind IN ('non_consumable', 'subscription')").bind(NOW, id).run();
  await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
}

describe("POST /v1/purchases/apple: purchases of a deleted account", () => {
  test("Own it: the next account gets the entitlement and plan own with 0 credits, once; a third account gets 409", async () => {
    const own = await jwsFor({ transactionId: "2000000000000050", originalTransactionId: "2000000000000050", productId: "waypoint.own_it", type: "Non-Consumable", appAccountToken: A });
    expect((await send(own, { user: userA })).status).toBe(200);
    await deleteAccount(A);
    commands.splice(0);
    const userC = await addUser(C);
    const res = await send(own, { user: userC });
    expect(ApplePurchaseResponseSchema.parse(await res.json())).toEqual({ transaction_id: "2000000000000050", product: "own_it", credits: 0, plan: "own" });
    expect(commands).toHaveLength(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM purchases WHERE billing_account_id = ?", C)).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ? AND product = 'own_it' AND ended_at IS NULL", C)).toBe(1);
    expect(ApplePurchaseResponseSchema.parse(await (await send(own, { user: userC })).json()).credits).toBe(0);
    expect(commands).toHaveLength(0);
    expect(walletFor(C).read().purchased).toBe(0);
    const userD = await addUser(D);
    await expectError(await send(own, { user: userD }), 409, "conflict", "purchase belongs to another account");
  });

  test("Plus: the claimed period gives plan plus and no reset; the next renewal resets to 2,000 for the new account", async () => {
    const plus = { productId: "waypoint.plus.monthly", type: "Auto-Renewable Subscription", appAccountToken: A, expiresDate: NOW + 20 * DAY };
    expect((await send(await jwsFor({ ...plus, transactionId: "2000000000000060", originalTransactionId: "2000000000000060" }), { user: userA })).status).toBe(200);
    await deleteAccount(A);
    commands.splice(0);
    const userC = await addUser(C);
    const claimed = await send(await jwsFor({ ...plus, transactionId: "2000000000000060", originalTransactionId: "2000000000000060" }), { user: userC });
    expect(ApplePurchaseResponseSchema.parse(await claimed.json())).toMatchObject({ product: "plus", credits: 0, plan: "plus" });
    expect(commands).toHaveLength(0);
    const renewal = await send(
      await jwsFor({ ...plus, transactionId: "2000000000000061", originalTransactionId: "2000000000000060", purchaseDate: NOW, expiresDate: NOW + 30 * DAY }),
      { user: userC },
    );
    expect(ApplePurchaseResponseSchema.parse(await renewal.json())).toMatchObject({ credits: 2000, plan: "plus" });
    expect(commands.map((c) => c.type)).toEqual(["reset"]);
    expect(walletFor(C).read().monthly).toBe(2000);
  });

  test("two accounts claiming at once: the claim that lands second gets other_account and no entitlement", async () => {
    const fields = { transactionId: "2000000000000090", originalTransactionId: "2000000000000090", productId: "waypoint.own_it", type: "Non-Consumable", appAccountToken: A };
    expect((await send(await jwsFor(fields), { user: userA })).status).toBe(200);
    await deleteAccount(A);
    await addUser(C);
    await addUser(D);
    const txn = AppleTransactionSchema.parse(transaction(fields));
    const product = appleProduct("waypoint.own_it");
    if (product === undefined) throw new Error("unknown product");
    const claim = (id: string, on: Db) => applyTransaction(on, WALLET.get(id), { user_id: id, billing_account_id: id }, txn, product, NOW);
    const second: PurchaseOutcome[] = [];
    // D's first statement runs, then C's whole claim, then the rest of D's.
    const first = await claim(D, interrupted(db, async () => void second.push(await claim(C, db))));
    expect(first).toMatchObject({ ok: true, credits: 0 });
    expect(second).toEqual([{ ok: false, reason: "other_account" }]);
    expect(await countRows("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?", C)).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM purchases WHERE billing_account_id = ?", D)).toBe(1);
  });

  test("a token of an account that never existed, for a purchase nobody released, gets 409", async () => {
    const own = await jwsFor({ transactionId: "2000000000000095", originalTransactionId: "2000000000000095", productId: "waypoint.own_it", type: "Non-Consumable", appAccountToken: C });
    await expectError(await send(own, { user: userB }), 409, "conflict", "purchase belongs to another account");
  });

  test("a pack stays with the deleted account: the next account gets 409 and no credits", async () => {
    const pack = await jwsFor({ transactionId: "2000000000000070", originalTransactionId: "2000000000000070", appAccountToken: A });
    expect((await send(pack, { user: userA })).status).toBe(200);
    await deleteAccount(A);
    const userC = await addUser(C);
    await expectError(await send(pack, { user: userC }), 409, "conflict", "purchase belongs to another account");
    expect(walletFor(C).read().purchased).toBe(0);
  });

  test("the account still exists: its released rows cannot be claimed", async () => {
    const own = await jwsFor({ transactionId: "2000000000000080", originalTransactionId: "2000000000000080", productId: "waypoint.own_it", type: "Non-Consumable" });
    expect((await send(own, { user: userA })).status).toBe(200);
    await db.prepare("UPDATE purchases SET released_at = ? WHERE billing_account_id = ?").bind(NOW, A).run();
    await expectError(await send(own, { user: userB }), 409, "conflict", "purchase belongs to another account");
  });
});
```

The two-claims test runs one claim inside the other: the second account's first statement, then the first account's whole claim, then the rest of the second's. With an ownership check before the claim (both checks pass, then both move the rows) it fails. The pack, "never existed" and "account still exists" tests are guards: they pass on `main` too, and must keep passing.

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api 1,026 = 1,019 + 7; d1-schema 57 = 56 + 1, two lines changed), `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Not in this PR

- Refunds and yearly top-ups of a claimed row (D1b).
- Cleaning up a deleted account's groups, room data and R2 objects (the rest of open question 7).
- Apple notices for a released row before it is claimed: `findAccount` finds no account (the user row is gone), so they are dropped as today; after the claim they find the new account.
- Moving the deleted account's packs or credits. They stay with its wallet (the money record), as decided.

---

## D1b · API: no take-back and no yearly top-ups for a claimed row

Branch `feat/d1b-claimed-purchases`. From `main` at `3c90a85`, **after D1a is merged** (the `released_at` column and the claim). No migration. Files, and no others:

- `apps/api/src/apple/notifications.ts`, `apps/api/test/apple-notices.test.ts`
- `apps/api/src/apple/allowance.ts`, `apps/api/test/allowance.test.ts`

**Why.** A row claimed under D1a gave the new wallet nothing. A refund of a claimed Own it would claw 2,000 credits back from the new wallet, which never got them; a refund of a claimed Plus period would reset the new account's monthly credits for a period that gave it none. The hourly yearly top-up would give a claimed yearly Plus 2,000 credits a month, which the decision rules out ("no monthly reset"). A renewal after the claim is a new row with `released_at` NULL, so it is refunded and topped up as usual.

### 1. Refunds

`apps/api/src/apple/notifications.ts`, in `applyNotice`, in the `refund`/`revoke` branch:

- Replace the `const row = await db … .first<{ status: string }>();` statement with, exactly:

```ts
    const row = await db
      .prepare("SELECT status, released_at FROM purchases WHERE transaction_id = ? AND billing_account_id = ?")
      .bind(txn.transactionId, account.billing_account_id)
      .first<{ status: string; released_at: number | null }>();
```

- Replace the line `if (row.status === "active" && purchased) {` with, exactly:

```ts
    // A row claimed from a deleted account gave this wallet nothing, so nothing is taken back from it.
    if (row.status === "active" && purchased && row.released_at === null) {
```

  The status update, the end of the entitlement and the plan refresh below it are unchanged, so a refund still ends the claimed entitlement.

`apps/api/test/apple-notices.test.ts`: in `describe("refunds, revokes and lapses")`, before the test `"a refund of Plus resets monthly to 0 under the notice's id, ends the entitlement and turns zero retention off"`, add exactly:

```ts
  test("a refund of Own it claimed from a deleted account makes no wallet command, ends the new entitlement and sets the plan to free", async () => {
    const txn = transaction("t1", "waypoint.own_it");
    await record(accountA, txn);
    await db.prepare("UPDATE purchases SET released_at = ? WHERE billing_account_id = ?").bind(NOW, A).run();
    await db.prepare("DELETE FROM users WHERE id = ?").bind(A).run();
    await record(accountB, txn);
    expect(await planOf(B)).toBe("own");
    commands.splice(0);
    await apply(accountB, notice("REFUND", uuid(2)), txn);
    expect(commands).toHaveLength(0);
    expect(read(accountB).purchased).toBe(0);
    expect((await one<{ status: string }>("SELECT status FROM purchases WHERE transaction_id = ?", "t1")).status).toBe("refunded");
    expect(await planOf(B)).toBe("free");
  });
```

### 2. Yearly top-ups

`apps/api/src/apple/allowance.ts`:

- Replace the comment line `// with an open Plus entitlement from a purchase are topped up. Returns how many resets were applied.` with, exactly:

```ts
// with an open Plus entitlement from a purchase are topped up. A year claimed from a deleted account (released_at)
// gets no top-ups: it gives the entitlement only. Returns how many resets were applied.
```

- In the SQL, replace the line that ends `AND p.status = 'active'` with, exactly:

```ts
       WHERE p.product_id IN (${YEARLY_PLUS.map(() => "?").join(", ")}) AND p.status = 'active' AND p.released_at IS NULL
```

`apps/api/test/allowance.test.ts`: in `describe("topUpYearlyPlus")`, after the last test (`"a monthly Plus subscription gets no command"`), add exactly:

```ts
  test("a yearly subscription claimed from a deleted account (released_at set) gets no command", async () => {
    const db = createTestDb();
    await userWithPlus(db, "u1", "ba1");
    await db
      .prepare("INSERT INTO purchases (transaction_id, original_id, billing_account_id, product_id, kind, status, purchased_at, released_at) VALUES ('t1', 'o1', 'ba1', 'waypoint.plus.yearly', 'subscription', 'active', ?, ?)")
      .bind(YEARLY_START, NOW - DAY)
      .run();
    const commands: Command[] = [];
    expect(await topUpYearlyPlus(db, recordingWallet(commands), NOW)).toBe(0);
    expect(commands).toEqual([]);
  });
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api + 2), `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Not in this PR

- Lapse notices of a claimed Plus: they reset monthly credits to 0 as for any lapse, which takes nothing the claimed period gave.

---

## D2 · API: at most 30 new jobs a minute per person

Branch `feat/d2-job-rate-limit`. From `main` at `3c90a85`. No dependency, no migration. Files, and no others:

- `apps/api/wrangler.jsonc`, `apps/api/src/env.ts`
- `apps/api/src/jobs/routes.ts`, `apps/api/test/helpers/jobs.ts`, `apps/api/test/jobs.test.ts`

**Why.** A job cancelled before it settles is never charged (open question 29), so a modified client can start a job and cancel it just before the settle, again and again, and use the models for free. Nothing limits `POST /v1/jobs` per person. The owner's decision: keep the cancel rule and add a per-user rate limit, a `ratelimits` binding like `LINK_VIEWS`, 30 a minute.

The app already handles the reply. `classifyFailure` (`apps/mobile/src/core/cloud/failure.ts`) turns any 429 into `busy` ("Still working on it… Try again in a moment.") and `keepsKey` keeps the Idempotency-Key for it; the API client does not retry a 429 by itself. The reply carries `Retry-After`, so `idempotent()` does not store it (H9) and the same request goes through on "Try again" a minute later.

### 1. The binding

`apps/api/wrangler.jsonc`: in `ratelimits`, replace the `LINK_PASSCODES` line with these two lines, exactly:

```jsonc
    { "name": "LINK_PASSCODES", "namespace_id": "1002", "simple": { "limit": 10, "period": 60 } },
    { "name": "JOB_STARTS", "namespace_id": "1003", "simple": { "limit": 30, "period": 60 } }
```

`apps/api/src/env.ts`: after the line `ASSETS: Fetcher;`, add exactly:

```ts
  JOB_STARTS: RateLimit;
```

### 2. The limit

`apps/api/src/jobs/routes.ts`:

- After the line `type JobRoute = { tier: Tier; model: string; retention: "standard" | "zero" };`, add exactly:

```ts

// Seconds to wait after JOB_STARTS says no (its period is 60 s, wrangler.jsonc).
export const JOB_STARTS_RETRY_AFTER = 60;
```

- In the `POST /v1/jobs` handler, after its first line `const user = c.get("user");`, add exactly:

```ts
      // At most 30 new jobs a minute per person (open question 29). A job cancelled before it settles costs nothing,
      // so this bounds how often a modified client can run the models for free.
      const starts = await c.env.JOB_STARTS.limit({ key: user.id });
      if (!starts.success) throw new ApiFailure("rate_limited", "too many jobs", JOB_STARTS_RETRY_AFTER);
```

  It runs inside `idempotent()`, so a replayed reply of an earlier request is not counted.

### 3. Tests

`apps/api/test/helpers/jobs.ts`: in `makeJobsWorld`, in the `env` object, after the `PUSH_QUEUE` line, add exactly:

```ts
    JOB_STARTS: { limit: async (_options: { key: string }) => ({ success: true }) },
```

`apps/api/test/jobs.test.ts`: in `describe("POST /v1/jobs")`, before the test `"fallback_voice true gives 400 with no hold, no row and no Workflow; false quotes 50 as without it"`, add exactly:

```ts
  test("when JOB_STARTS says no: 429 with retry_after 60, keyed by the user id, and no hold, row or Workflow", async () => {
    const w = await makeJobsWorld();
    const keys: string[] = [];
    const limit = async (options: { key: string }) => {
      keys.push(options.key);
      return { success: false };
    };
    const env = { ...w.env, JOB_STARTS: { limit } };
    const res = await post(w, appFor(U1, w), OVERVIEW, { env });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await errorOf(res)).toEqual({ code: "rate_limited", message: "too many jobs", retry_after: 60 });
    expect(keys).toEqual(["u1"]);
    expect(holdCommands(w)).toHaveLength(0);
    expect(w.workflow.created).toHaveLength(0);
    expect(await w.db.prepare("SELECT count(*) AS n FROM jobs").first<{ n: number }>()).toEqual({ n: 0 });
  });
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api 1,020 = 1,019 + 1), `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Owner setup

The namespace id `1003` must be unique in the Cloudflare account, like `1001` and `1002` (`docs/build-plan.md`, "Owner setup").

### Not in this PR

- Limits on the instant task routes. Their holds are released only when the model fails, so cancelling gains nothing there.
- Charging a job that is cancelled after the model ran (the other half of open question 29, unchanged).

---

## D3 · API: a daily byte budget on changes and links

Branch `feat/d3-sync-budget`. From `main` at `3c90a85`, **after D1a is merged** (migration `0011` follows D1a's `0010`, and both edit `db/d1/test/schema.test.mjs`, different lines). Migration `0011_sync_days.sql`. Files, and no others:

- `db/d1/migrations/0011_sync_days.sql` (new), `db/d1/test/schema.test.mjs`
- `packages/contracts/src/sync.ts`
- `apps/api/src/sync/budget.ts` (new), `apps/api/test/sync-budget.test.ts` (new)
- `apps/api/src/sync/routes.ts`, `apps/api/test/sync.test.ts`
- `apps/api/src/links/routes.ts`, `apps/api/test/links.test.ts`

**Why.** Changes have no per-person byte budget (only media has the 3 GB cap), and links are unlimited at up to 4 MiB each, so one account can fill R2 and the group rooms (open question 55). The owner's decision: 200 MB a day per person on changes and links together, counted per UTC day. D5 lets a person buy more for the day, one `sync_extras` row per purchase; this card creates that table (so the budget can include it) and adds the budget and its 429. Nothing writes `sync_extras` until D5.

### 1. The tables

`db/d1/migrations/0011_sync_days.sql` (new), exactly:

```sql
-- Bytes of locked changes and shared-link data each person sent per UTC day (day = Unix ms / 86,400,000, rounded
-- down), against their daily budget (open question 55). Sizes only.
CREATE TABLE sync_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
-- Extra bytes bought for a day (POST /v1/sync/extra, card D5), one row per purchase. The key is the purchase's
-- Idempotency-Key, so a purchase that runs again can never add its bytes twice.
CREATE TABLE sync_extras (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  day INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
```

`db/d1/test/schema.test.mjs`:

- In `EXPECTED`, after the `apple_notifications` line, add exactly:

```js
  sync_days: ["user_id", "day", "bytes"],
  sync_extras: ["user_id", "key", "day", "bytes"],
```

- In `EXPECTED_TYPES`, after the `apple_notifications` line, add exactly:

```js
  sync_days: { user_id: "TEXT", day: "INTEGER", bytes: "INTEGER" },
  sync_extras: { user_id: "TEXT", key: "TEXT", day: "INTEGER", bytes: "INTEGER" },
```

- Add at the end of the file (after D1a's test), exactly:

```js

test("deleting a user deletes their sync_days and sync_extras rows", () => {
  const db = freshDb();
  seedUser(db);
  db.exec("INSERT INTO sync_days (user_id, day, bytes) VALUES ('u1', 20000, 10)");
  db.exec("INSERT INTO sync_extras (user_id, key, day, bytes) VALUES ('u1', 'k1', 20000, 10)");
  db.prepare("DELETE FROM users WHERE id = 'u1'").run();
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sync_days"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sync_extras"), 0);
});

test("a purchase's key can add a sync_extras row only once per user", () => {
  const db = freshDb();
  seedUser(db);
  db.exec("INSERT INTO sync_extras (user_id, key, day, bytes) VALUES ('u1', 'k1', 20000, 10)");
  assert.throws(() => db.exec("INSERT INTO sync_extras (user_id, key, day, bytes) VALUES ('u1', 'k1', 20000, 10)"), /UNIQUE constraint failed/);
});
```

### 2. The numbers both sides share

`packages/contracts/src/sync.ts`: add at the end of the file, exactly:

```ts

// Open question 55: each person may send this many bytes of locked changes and shared-link data per UTC day. Over it,
// POST /v1/groups/:id/changes and POST /v1/links answer 429 rate_limited with this message and retry_after = the
// seconds until 00:00 UTC.
export const SYNC_DAILY_BYTES = 200_000_000;
export const SYNC_DAILY_LIMIT_MESSAGE = "daily sync limit reached";
```

### 3. Counting

`apps/api/src/sync/budget.ts` (new), exactly:

```ts
import { SYNC_DAILY_BYTES, SYNC_DAILY_LIMIT_MESSAGE } from "@waypoint/contracts";
import { ApiFailure } from "../errors.ts";
import type { Db } from "../storage.ts";

const DAY_MS = 86_400_000;

// The UTC day a time falls in: whole days since 1 January 1970. Each person's sync budget starts again at 00:00 UTC.
export function utcDay(now: number): number {
  return Math.floor(now / DAY_MS);
}

// Counts `bytes` (locked change bytes or shared-link data) against the person's budget for today: SYNC_DAILY_BYTES
// plus the extra bought for today (sync_extras). One statement checks and counts, so two requests at once cannot both
// pass the limit. Over it: nothing is counted, and 429 says how many seconds remain until 00:00 UTC.
export async function spendSyncBytes(db: Db, userId: string, bytes: number, now: number): Promise<void> {
  const day = utcDay(now);
  const counted = await db
    .prepare(
      `INSERT INTO sync_days (user_id, day, bytes) VALUES (?, ?, ?)
       ON CONFLICT (user_id, day) DO UPDATE SET bytes = sync_days.bytes + excluded.bytes
       WHERE sync_days.bytes + excluded.bytes <= ? +
         (SELECT COALESCE(SUM(e.bytes), 0) FROM sync_extras e WHERE e.user_id = sync_days.user_id AND e.day = sync_days.day)`,
    )
    .bind(userId, day, bytes, SYNC_DAILY_BYTES)
    .run();
  if (counted.meta.changes === 0) {
    throw new ApiFailure("rate_limited", SYNC_DAILY_LIMIT_MESSAGE, Math.ceil(((day + 1) * DAY_MS - now) / 1000));
  }
}
```

The first request of a day inserts its row without a check: one change is at most 1 MiB and one link at most 4 MiB, far below the budget.

`apps/api/test/sync-budget.test.ts` (new), exactly:

```ts
import { SYNC_DAILY_BYTES, SYNC_DAILY_LIMIT_MESSAGE } from "@waypoint/contracts";
import { describe, expect, test } from "vitest";
import { ApiFailure } from "../src/errors.ts";
import { spendSyncBytes, utcDay } from "../src/sync/budget.ts";
import type { BatchDb } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";

const DAY = 86_400_000;
// 18:00 UTC: six hours (21,600 s) before the next UTC day.
const NOW = 20_400 * DAY + 18 * 60 * 60 * 1000;

async function makeDb(): Promise<BatchDb> {
  const db = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, 0, ?)").bind(id, `clerk_${id}`, id).run();
  }
  return db;
}

async function bytesOf(db: BatchDb, userId: string, day: number): Promise<number | null> {
  const row = await db.prepare("SELECT bytes FROM sync_days WHERE user_id = ? AND day = ?").bind(userId, day).first<{ bytes: number }>();
  return row?.bytes ?? null;
}

describe("spendSyncBytes", () => {
  test("utcDay counts whole days since 1970: the last millisecond of a day and the first of the next differ by one", () => {
    expect(utcDay(NOW)).toBe(20_400);
    expect(utcDay(20_401 * DAY - 1)).toBe(20_400);
    expect(utcDay(20_401 * DAY)).toBe(20_401);
  });

  test("bytes add up per person per day, up to exactly the budget", async () => {
    const db = await makeDb();
    await spendSyncBytes(db, "u1", 1_000, NOW);
    await spendSyncBytes(db, "u1", SYNC_DAILY_BYTES - 1_000, NOW);
    await spendSyncBytes(db, "u2", 5, NOW);
    expect(await bytesOf(db, "u1", 20_400)).toBe(SYNC_DAILY_BYTES);
    expect(await bytesOf(db, "u2", 20_400)).toBe(5);
  });

  test("one byte over the budget: 429 rate_limited with the seconds until 00:00 UTC, and nothing is counted", async () => {
    const db = await makeDb();
    await spendSyncBytes(db, "u1", SYNC_DAILY_BYTES, NOW);
    const failure = await spendSyncBytes(db, "u1", 1, NOW).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure).toMatchObject({ code: "rate_limited", message: SYNC_DAILY_LIMIT_MESSAGE, retryAfter: 21_600 });
    expect(await bytesOf(db, "u1", 20_400)).toBe(SYNC_DAILY_BYTES);
  });

  test("a new UTC day starts from 0", async () => {
    const db = await makeDb();
    await spendSyncBytes(db, "u1", SYNC_DAILY_BYTES, NOW);
    await spendSyncBytes(db, "u1", 10, 20_401 * DAY);
    expect(await bytesOf(db, "u1", 20_401)).toBe(10);
  });

  test("extra bytes bought for today raise today's budget only", async () => {
    const db = await makeDb();
    await db.prepare("INSERT INTO sync_days (user_id, day, bytes) VALUES ('u1', 20400, ?)").bind(SYNC_DAILY_BYTES).run();
    await db.prepare("INSERT INTO sync_extras (user_id, key, day, bytes) VALUES ('u1', 'k_today', 20400, 300), ('u1', 'k_today2', 20400, 200), ('u1', 'k_old', 20399, 900)").run();
    await spendSyncBytes(db, "u1", 500, NOW);
    await expect(spendSyncBytes(db, "u1", 1, NOW)).rejects.toThrow(SYNC_DAILY_LIMIT_MESSAGE);
  });
});
```

### 4. The two routes count

The count runs after every check of the request, so a refused request is never counted, and inside `idempotent()`, so a replayed reply is not counted again. A 429 carries `Retry-After`, so `idempotent()` does not store it (H9): the same request goes through once the person has bought more (D5) or the day has turned.

`apps/api/src/sync/routes.ts`:

- After the line `import type { Db } from "../storage.ts";`, add exactly:

```ts
import { spendSyncBytes } from "./budget.ts";
```

- In the `POST /v1/groups/:id/changes` handler, after the line that checks `req.blob_key` (`if (req.blob_key !== null && !req.blob_key.startsWith(…)) throw …`), add exactly:

```ts
      await spendSyncBytes(db, user.id, bytes.length, now);
```

`apps/api/src/links/routes.ts`: a link is counted once its row exists, so a request refused for a taken id is not counted.

- After the line `import type { FetchLike } from "../push/apns.ts";`, add exactly:

```ts
import { spendSyncBytes } from "../sync/budget.ts";
```

- In the `POST /v1/links` handler, after the `try { await db.prepare("INSERT INTO links …") … } catch (error) { … "link id taken" … }` block and before `const bucket: LinkBucket = c.env.BUCKET;`, add exactly:

```ts
      // Counted once the link exists (open question 55); over the day's budget, the row goes again and nothing is stored.
      try {
        await spendSyncBytes(db, user.id, data.length, now);
      } catch (error) {
        await db.prepare("DELETE FROM links WHERE id = ?").bind(req.id).run();
        throw error;
      }
```

`apps/api/test/sync.test.ts`:

- Replace the first import line with, exactly:

```ts
import { ChangesPageSchema, PostChangeResponseSchema, SYNC_DAILY_BYTES, type ApiError } from "@waypoint/contracts";
```

- Before the test `"a viewer's post gets 403 'viewers cannot write'"`, add exactly:

```ts
test("a post over the day's sync budget gets 429 'daily sync limit reached' and nothing is appended; the bytes are counted otherwise", async () => {
  const w = await world();
  const locked = await sealed(U1A, "note_edit");
  expect((await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, locked))).status).toBe(201);
  const day = Math.floor(NOW / 86_400_000);
  const counted = await w.env.DB.prepare("SELECT bytes FROM sync_days WHERE user_id = 'u1' AND day = ?").bind(day).first<{ bytes: number }>();
  expect(counted?.bytes).toBe(fromBase64Url(locked).length);
  await w.env.DB.prepare("UPDATE sync_days SET bytes = ? WHERE user_id = 'u1'").bind(SYNC_DAILY_BYTES).run();
  const res = await call(w.env, "u1", "POST", CHANGES, changeBody(U1A, await sealed(U1A, "note_edit")));
  expect(res.status).toBe(429);
  expect(await errorOf(res)).toEqual({ code: "rate_limited", message: "daily sync limit reached" });
  expect(w.env.GROUP_ROOM.roomFor(G).store.after(0, 10).changes).toHaveLength(1);
});
```

`apps/api/test/links.test.ts`:

- Replace the first import line with, exactly:

```ts
import { LinkRevokedSchema, LinkViewSchema, SYNC_DAILY_BYTES } from "@waypoint/contracts";
```

- In `describe("POST /v1/links")`, before the test `"a passcode is stored only as its peppered hash, and no column holds the passcode"`, add exactly:

```ts
  test("a link over the day's sync budget gets 429 'daily sync limit reached' with no row and nothing in R2", async () => {
    const rig = await makeRig();
    await rig.db.prepare("INSERT INTO sync_days (user_id, day, bytes) VALUES ('u2', ?, ?)").bind(Math.floor(NOW / 86_400_000), SYNC_DAILY_BYTES).run();
    const res = await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, toBase64Url(await lockedFor(LINK))));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited", message: "daily sync limit reached" });
    expect(await rowOf(rig, LINK)).toBeNull();
    expect(rig.mem.state.puts).toBe(0);
  });

  test("a link id that is taken gets 409 and its bytes are not counted", async () => {
    const rig = await makeRig();
    const data = toBase64Url(await lockedFor(LINK));
    expect((await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data))).status).toBe(201);
    expect((await signed(rig, "u2", "POST", "/v1/links", createBody(LINK, data))).status).toBe(409);
    const row = await rig.db.prepare("SELECT bytes FROM sync_days WHERE user_id = 'u2'").first<{ bytes: number }>();
    expect(row?.bytes).toBe((await lockedFor(LINK)).length);
  });
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api + 8: five in `sync-budget.test.ts`, one in `sync.test.ts`, two in `links.test.ts`; d1-schema + 2), `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Not in this PR

- Buying more for the day (D5) and the app's sheet (D8).
- Deleting old `sync_days` and `sync_extras` rows (D4).
- Media uploads: they keep the 3 GB cap and are not counted here.
- A change counted whose room append then fails is counted anyway; its retry counts again (at most 1 MiB each).

---

## D4 · API: the hourly cleanup deletes expired links and old day counts

Branch `feat/d4-cleanup-links`. From `main` at `3c90a85`, **after D3 is merged** (it needs `sync_days`, `sync_extras` and `utcDay`). No migration. Files, and no others:

- `apps/api/src/cleanup.ts`, `apps/api/test/cleanup.test.ts`

**Why.** A shared link that expires keeps its locked data in R2 (`links/{id}/data`) for ever; only a revoke deletes it (open question 55). The viewer refuses an expired link already, so the object is dead weight. The cleanup now deletes the object and the row of every link whose `expires_at` has passed. The viewer and the app answer a link that is gone exactly as they answer an expired one: the viewer shows "This link doesn't work anymore" for any 404, and the app's turn-off treats a 404 as already off (`platform/links.ts`, `revokeLink`). The cleanup still never lists `links/`: it deletes the keys of the rows it found. It also deletes D3's daily counts and D5's extras older than yesterday.

### 1. The cleanup

`apps/api/src/cleanup.ts`:

- Replace the first line, `import type { Db } from "./storage.ts";`, with exactly:

```ts
import { linkKey } from "./links/routes.ts";
import type { Db } from "./storage.ts";
import { utcDay } from "./sync/budget.ts";
```

- After the line `export const MAX_SCAN_PAGES = 100;`, add exactly:

```ts
// Expired shared links are deleted this many at a time (D1 binds at most 100 values per statement), at most
// MAX_LIST_PAGES pages per run.
export const LINKS_PAGE = 50;
```

- After the line `export type CleanupEnv = { DB: Db; BUCKET: CleanupBucket };`, add exactly:

```ts

// Shared links past their expiry (open question 55): the locked data in R2 and the row are deleted. The viewer and the
// app already answer a link that is gone as they answer an expired one (404). Revoked links lost their data when they
// were revoked. Returns how many were deleted.
async function deleteExpiredLinks(env: CleanupEnv, now: number): Promise<number> {
  let deleted = 0;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { results } = await env.DB.prepare("SELECT id FROM links WHERE expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at, id LIMIT ?")
      .bind(now, LINKS_PAGE)
      .all<{ id: string }>();
    if (results.length === 0) break;
    await env.BUCKET.delete(results.map((row) => linkKey(row.id)));
    await env.DB.prepare(`DELETE FROM links WHERE id IN (${results.map(() => "?").join(", ")})`)
      .bind(...results.map((row) => row.id))
      .run();
    deleted += results.length;
    if (results.length < LINKS_PAGE) break;
  }
  return deleted;
}
```

- Replace the return type of `cleanup` (the line `): Promise<{ results: number; … waiting_devices: number }> {`) with, exactly:

```ts
): Promise<{
  results: number;
  tmp_audio: number;
  tmp_input: number;
  idempotency: number;
  request_nonces: number;
  pending_blobs: number;
  waiting_devices: number;
  expired_links: number;
  sync_days: number;
  sync_extras: number;
}> {
```

- After the `waitingDevices` statement (it ends `.bind(now, now - WAITING_DEVICE_KEEP_MS, now)` and `.run();`) and before `return {`, add exactly:

```ts
  const expiredLinks = await deleteExpiredLinks(env, now);
  // Daily sync counts and extras (open question 55) are needed for today only; yesterday's are kept for a request that
  // crossed 00:00 UTC.
  const syncDays = await env.DB.prepare("DELETE FROM sync_days WHERE day < ?").bind(utcDay(now) - 1).run();
  const syncExtras = await env.DB.prepare("DELETE FROM sync_extras WHERE day < ?").bind(utcDay(now) - 1).run();
```

- In the returned object, after `waiting_devices: waitingDevices.meta.changes,`, add exactly:

```ts
    expired_links: expiredLinks,
    sync_days: syncDays.meta.changes,
    sync_extras: syncExtras.meta.changes,
```

### 2. Tests

`apps/api/test/cleanup.test.ts`:

- In the test `"request_nonces 1 ms past expiry are deleted, one expiring at now kept; the counts cover each kind"`, replace the `expect(counts).toEqual({ … });` line with, exactly:

```ts
    expect(counts).toEqual({ results: 1, tmp_audio: 1, tmp_input: 0, idempotency: 0, request_nonces: 1, pending_blobs: 0, waiting_devices: 0, expired_links: 0, sync_days: 0, sync_extras: 0 });
```

- In `describe("cleanup")`, after the last test, add exactly:

```ts
  test("a link expired 1 ms ago and one expiring now lose their R2 object and row; a later, a never-expiring and a revoked one are kept", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'u1')").run();
    await db.prepare("INSERT INTO groups (id, kind, name_locked, created_by) VALUES ('g1', 'shared', 'sealed', 'u1')").run();
    const insert = "INSERT INTO links (id, group_id, blob_key, expires_at, revoked_at, created_by, created_at) VALUES (?, 'g1', ?, ?, ?, 'u1', 0)";
    for (const [id, expiresAt, revokedAt] of [
      ["l_past", NOW - 1, null],
      ["l_now", NOW, null],
      ["l_later", NOW + 1, null],
      ["l_never", null, null],
      ["l_revoked", null, NOW - DAY],
    ] as const) {
      await db.prepare(insert).bind(id, `links/${id}/data`, expiresAt, revokedAt).run();
    }
    const { bucket, remaining } = fakeBucket(
      ["l_past", "l_now", "l_later", "l_never"].map((id) => ({ key: `links/${id}/data`, uploaded: new Date(NOW - 30 * DAY) })),
    );
    const counts = await cleanup({ DB: db, BUCKET: bucket }, NOW);
    expect(counts.expired_links).toBe(2);
    expect(remaining()).toEqual(["links/l_later/data", "links/l_never/data"]);
    const rows = await db.prepare("SELECT id FROM links ORDER BY id").all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "l_later" }, { id: "l_never" }, { id: "l_revoked" }]);
  });

  test("120 expired links are deleted in pages of 50 in one run", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'u1')").run();
    await db.prepare("INSERT INTO groups (id, kind, name_locked, created_by) VALUES ('g1', 'shared', 'sealed', 'u1')").run();
    for (let i = 0; i < 120; i++) {
      await db.prepare("INSERT INTO links (id, group_id, blob_key, expires_at) VALUES (?, 'g1', 'b', ?)").bind(padded("l_", i), NOW - DAY).run();
    }
    const deletes: number[] = [];
    const bucket: CleanupBucket = { list: async () => ({ objects: [], truncated: false }), delete: async (keys) => void deletes.push(keys.length) };
    expect((await cleanup({ DB: db, BUCKET: bucket }, NOW)).expired_links).toBe(120);
    expect(deletes).toEqual([50, 50, 20]);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM links").first<{ n: number }>()).toEqual({ n: 0 });
  });

  test("sync_days and sync_extras rows older than yesterday (UTC) are deleted; yesterday's and today's are kept", async () => {
    const db = createTestDb();
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'u1')").run();
    const today = Math.floor(NOW / DAY);
    for (const day of [today - 2, today - 1, today]) {
      await db.prepare("INSERT INTO sync_days (user_id, day, bytes) VALUES ('u1', ?, 1)").bind(day).run();
      await db.prepare("INSERT INTO sync_extras (user_id, key, day, bytes) VALUES ('u1', ?, ?, 1)").bind(`key-${day}`, day).run();
    }
    const counts = await cleanup({ DB: db, BUCKET: fakeBucket([]).bucket }, NOW);
    expect([counts.sync_days, counts.sync_extras]).toEqual([1, 1]);
    const rows = await db.prepare("SELECT day FROM sync_days ORDER BY day").all<{ day: number }>();
    expect(rows.results).toEqual([{ day: today - 1 }, { day: today }]);
    const extras = await db.prepare("SELECT day FROM sync_extras ORDER BY day").all<{ day: number }>();
    expect(extras.results).toEqual([{ day: today - 1 }, { day: today }]);
  });
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api + 3, one test line changed), `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Not in this PR

- Links of a deleted account (their rows go with the user, `ON DELETE CASCADE`, and their R2 objects stay): part of open question 7's cleanup.
- Revoked links' rows: their R2 object is already gone; the row is a few bytes.

---

## D5 · API: buy more sync for today with credits

Branch `feat/d5-sync-extra`. From `main` at `3c90a85`, **after D3 is merged** (D3 creates `sync_extras` and `utcDay`, and both cards add to the end of `packages/contracts/src/sync.ts`: this card's block goes after D3's). No migration. Files, and no others:

- `packages/contracts/src/sync.ts`
- `apps/api/src/sync/extra.ts` (new), `apps/api/src/app.ts`, `apps/api/test/sync-extra.test.ts` (new)
- `packages/api-client/src/client.ts`, `packages/api-client/test/groups-sync.test.ts`

**Why.** The owner wants people to be able to buy more than the daily budget (open question 55), with the credit wallet they already have rather than a new App Store product. `POST /v1/sync/extra` spends `SYNC_EXTRA_CREDITS` (100, to be confirmed: open question 57) for `SYNC_EXTRA_BYTES` (1 GB) more for the rest of the current UTC day. It uses the wallet's existing spend path, the one every instant task uses: a hold, the work, a settle at the full price. Its command ids come from the user id and the Idempotency-Key and are never random, so a retry never pays twice. The gigabyte is one `sync_extras` row whose primary key is (user, Idempotency-Key), so a retry never adds it twice either. The route is signed, because it spends credits (`docs/security.md` section 15), and `idempotent()`.

### 1. The contract

`packages/contracts/src/sync.ts`: add at the end of the file (after D3's block), exactly:

```ts

// POST /v1/sync/extra (open question 55): SYNC_EXTRA_CREDITS buys SYNC_EXTRA_BYTES more for the rest of the UTC day.
// The price is not confirmed yet (open question 57). The request names the price the app showed; another price gets
// 409 "price changed" and nothing is charged. extra_bytes in the reply is all the extra bought for today.
export const SYNC_EXTRA_BYTES = 1_000_000_000;
export const SYNC_EXTRA_CREDITS = 100;
export const SyncExtraRequestSchema = z.strictObject({ credits: z.number().int().min(1) });
export const SyncExtraResponseSchema = z.strictObject({ credits: z.number().int().min(1), extra_bytes: z.number().int().min(1) });
export type SyncExtraResponse = z.infer<typeof SyncExtraResponseSchema>;
```

### 2. The route

`apps/api/src/sync/extra.ts` (new), exactly:

```ts
import { IDEMPOTENCY_KEY_HEADER, SYNC_EXTRA_BYTES, SYNC_EXTRA_CREDITS, SyncExtraRequestSchema, type SyncExtraResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure, InsufficientCredits } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { readTaskBody } from "../tasks/instant.ts";
import { utcDay } from "./budget.ts";

// The hold lives one minute; the D1 write between the hold and the settle takes milliseconds.
const HOLD_MS = 60_000;

// POST /v1/sync/extra (open question 55): more sync for the rest of today (UTC), paid in credits. The wallet runs it
// like a task: hold the price, add the bytes, settle. If the bytes cannot be added, the hold is released and nothing is
// charged. Signed (it spends credits) and idempotent; the wallet ids come from the user id and the Idempotency-Key, and
// the bytes are one sync_extras row under that key, so a request that runs again (a settle that failed, a lost reply
// while the hold is still open) never adds them twice.
export function syncExtraRoute(deps: { now: () => number }) {
  return new Hono<AppEnv>().post("/v1/sync/extra", requireDeviceSignature(deps), idempotent(deps), async (c) => {
    const user = c.get("user");
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER) ?? "";
    const request = await readTaskBody(c, SyncExtraRequestSchema);
    if (request.credits !== SYNC_EXTRA_CREDITS) throw new ApiFailure("conflict", "price changed");
    const now = deps.now();
    const holdId = `sync_extra:${user.id}:${key}`;
    const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
    const held = await wallet.apply({
      type: "hold",
      id: holdId,
      hold_id: holdId,
      user_id: user.id,
      task: "sync_extra",
      credits: SYNC_EXTRA_CREDITS,
      expires_at: now + HOLD_MS,
    });
    if (!held.ok) {
      if ("shortfall" in held) throw new InsufficientCredits(held.shortfall);
      // This request ran before and added its bytes, but its settle failed while the hold stayed open: settle it now.
      const added = await c.env.DB.prepare("SELECT 1 AS found FROM sync_extras WHERE user_id = ? AND key = ?").bind(user.id, key).first<{ found: number }>();
      if (held.reason !== "hold_in_progress" || added === null) {
        if (held.reason === "hold_closed") throw new ApiFailure("conflict", "request already finished");
        if (held.reason === "hold_in_progress") throw new ApiFailure("conflict", "request in progress", 1);
        throw new ApiFailure("internal", "something went wrong");
      }
    }
    const day = utcDay(now);
    let row: { bytes: number } | null;
    try {
      await c.env.DB.prepare("INSERT INTO sync_extras (user_id, key, day, bytes) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO NOTHING")
        .bind(user.id, key, day, SYNC_EXTRA_BYTES)
        .run();
      row = await c.env.DB.prepare("SELECT SUM(bytes) AS bytes FROM sync_extras WHERE user_id = ? AND day = ?").bind(user.id, day).first<{ bytes: number }>();
    } catch (error) {
      await wallet.apply({ type: "release", id: `sync_extra_release:${user.id}:${key}`, hold_id: holdId }).catch(() => undefined);
      throw error;
    }
    await wallet.apply({ type: "settle", id: `sync_extra_settle:${user.id}:${key}`, hold_id: holdId, actual: SYNC_EXTRA_CREDITS });
    const reply: SyncExtraResponse = { credits: SYNC_EXTRA_CREDITS, extra_bytes: row?.bytes ?? SYNC_EXTRA_BYTES };
    return c.json(reply);
  });
}
```

What each wallet answer means: a shortfall is 402 with the shortfall (the app's Out of credits path). `hold_in_progress` means the same request ran before and its hold is still open. If that run already wrote its `sync_extras` row, its settle failed (a Durable Object error after the D1 write), so this run settles it: one gigabyte, charged once. Otherwise the first run is still going, and the reply is 409 "request in progress" with `retry_after` 1, which the API client waits for and retries. `hold_closed` (the hold was settled or released already, and the stored reply is gone) is 409 "request already finished". If the D1 write fails, the hold is released and nothing is charged. If a failed settle is never retried, the hold's alarm releases it a minute later and that gigabyte was free; that needs a Durable Object failure and an app that gives up, so it is accepted.

`apps/api/src/app.ts`:

- Replace the line `import { syncRoutes } from "./sync/routes.ts";` with exactly:

```ts
import { syncExtraRoute } from "./sync/extra.ts";
import { syncRoutes } from "./sync/routes.ts";
```

- After the line `app.route("/", viewerRoute());`, add exactly:

```ts
  app.route("/", syncExtraRoute({ now: deps.now }));
```

`apps/api/test/sync-extra.test.ts` (new), exactly:

```ts
import { SYNC_DAILY_BYTES, SYNC_EXTRA_BYTES, SYNC_EXTRA_CREDITS, SyncExtraResponseSchema } from "@waypoint/contracts";
import type { Command } from "@waypoint/ledger";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { spendSyncBytes } from "../src/sync/budget.ts";
import { syncExtraRoute } from "../src/sync/extra.ts";
import { createWalletStore } from "../src/wallet/store.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";
import { createTestStore } from "./helpers/sql.ts";

const NOW = 1_763_560_000_000;
const DAY = Math.floor(NOW / 86_400_000);
const PATH = "/v1/sync/extra";
const U1: SessionUser = { id: "u1", clerk_id: "clerk_u1", plan: "free", billing_account_id: "ba_u1", zero_retention: false };

// u1 with an approved phone and a wallet holding `purchased` credits; every wallet command is recorded. failSettles:
// how many settles throw before they reach the wallet (a Durable Object call that fails).
async function world(purchased: number, failSettles = 0) {
  const db = createTestDb();
  await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'ba_u1')").run();
  const phone: TestDevice = await makeTestDevice("dev_phone");
  await insertDevice(db, phone, { userId: "u1" });
  const store = createWalletStore(createTestStore());
  if (purchased > 0) store.apply({ type: "grant", id: "seed", bucket: "purchased", credits: purchased, ref: "test" }, NOW);
  const commands: Command[] = [];
  let settlesToFail = failSettles;
  const env = {
    DB: db,
    WALLET: {
      idFromName: (name: string) => name,
      get: (_name: string) => ({
        apply: async (command: Command) => {
          commands.push(command);
          if (command.type === "settle" && settlesToFail > 0) {
            settlesToFail -= 1;
            throw new Error("wallet unavailable");
          }
          return store.apply(command, NOW);
        },
      }),
    },
  };
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", U1);
    await next();
  });
  app.route("/", syncExtraRoute({ now: () => NOW }));
  const buy = async (body: unknown, key = "key-extra-0123456789") =>
    app.request(PATH, await signedInit(phone, { method: "POST", path: PATH, body, now: NOW, idempotencyKey: key }), env);
  return { db, store, commands, app, env, buy };
}

describe("POST /v1/sync/extra", () => {
  test("100 credits add 1 GB for today: hold then settle, and today's budget grows by that much", async () => {
    const w = await world(250);
    const res = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(res.status).toBe(200);
    expect(SyncExtraResponseSchema.parse(await res.json())).toEqual({ credits: SYNC_EXTRA_CREDITS, extra_bytes: SYNC_EXTRA_BYTES });
    expect(w.commands.map((c) => c.type)).toEqual(["hold", "settle"]);
    expect(w.commands[0]).toMatchObject({ id: "sync_extra:u1:key-extra-0123456789", task: "sync_extra", credits: SYNC_EXTRA_CREDITS });
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [] });
    await spendSyncBytes(w.db, "u1", SYNC_DAILY_BYTES + SYNC_EXTRA_BYTES, NOW);
    await expect(spendSyncBytes(w.db, "u1", 1, NOW)).rejects.toThrow("daily sync limit reached");
  });

  test("a second purchase the same day adds another 1 GB; the same request again replays and charges once", async () => {
    const w = await world(250);
    await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-aaaaaaaaaa");
    const replay = await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-aaaaaaaaaa");
    expect(SyncExtraResponseSchema.parse(await replay.json()).extra_bytes).toBe(SYNC_EXTRA_BYTES);
    const second = await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-bbbbbbbbbb");
    expect(SyncExtraResponseSchema.parse(await second.json()).extra_bytes).toBe(2 * SYNC_EXTRA_BYTES);
    expect(w.store.read().purchased).toBe(50);
    const row = await w.db.prepare("SELECT SUM(bytes) AS bytes FROM sync_extras WHERE user_id = 'u1' AND day = ?").bind(DAY).first<{ bytes: number }>();
    expect(row?.bytes).toBe(2 * SYNC_EXTRA_BYTES);
  });

  test("a settle that fails, then the same request again while its hold is open: 1 GB added once, 100 credits charged once", async () => {
    const w = await world(250, 1);
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS })).status).toBe(500);
    const retry = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(retry.status).toBe(200);
    expect(SyncExtraResponseSchema.parse(await retry.json()).extra_bytes).toBe(SYNC_EXTRA_BYTES);
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [] });
  });

  test("not enough credits: 402 with the shortfall, nothing added", async () => {
    const w = await world(40);
    const res = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "insufficient_credits", shortfall: 60 });
    expect(await w.db.prepare("SELECT COUNT(*) AS n FROM sync_days").first<{ n: number }>()).toEqual({ n: 0 });
  });

  test("a price the server does not charge gets 409 'price changed' and no wallet command", async () => {
    const w = await world(250);
    const res = await w.buy({ credits: SYNC_EXTRA_CREDITS + 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "price changed", retry_after: null });
    expect(w.commands).toHaveLength(0);
  });

  test("a request signed by a device that is not this person's gets 401 and no wallet command", async () => {
    const w = await world(250);
    const stranger = await makeTestDevice("dev_stranger");
    const init = await signedInit(stranger, { method: "POST", path: PATH, body: { credits: SYNC_EXTRA_CREDITS }, now: NOW });
    const res = await w.app.request(PATH, init, w.env);
    expect(res.status).toBe(401);
    expect(w.commands).toHaveLength(0);
  });
});
```

### 3. The API client

`packages/api-client/src/client.ts`:

- In the import list from `@waypoint/contracts`, after `StreamDoneSchema,`, add exactly:

```ts
  SyncExtraResponseSchema,
```

- In the same import list, after `type StreamDone,`, add exactly:

```ts
  type SyncExtraResponse,
```

- After the `revokeLink` method (the two lines starting `revokeLink: (linkId: string): Promise<LinkRevoked> =>`), add exactly:

```ts
    // More sync for today (open question 55). `credits` is the price the app showed; the key stays the same when the
    // person buys credits after a 402 and tries again.
    buySyncExtra: (credits: number, key: string): Promise<SyncExtraResponse> =>
      json({ method: "POST", target: "/v1/sync/extra", body: { credits }, key, signing: "device", retry: true }, SyncExtraResponseSchema),
```

`packages/api-client/test/groups-sync.test.ts`: in `describe("sync, media, links")`, after the test `"links are signed; the socket URL is wss"`, add exactly:

```ts
  it("buySyncExtra is signed and sends the price under the given key", async () => {
    const me = softwareSigner("dev_me");
    const { client, sent } = fakeApi([jsonReply(200, { credits: 100, extra_bytes: 1_000_000_000 })], { device: () => me });
    expect(await client.buySyncExtra(100, "key-extra-0123456789")).toEqual({ credits: 100, extra_bytes: 1_000_000_000 });
    expect([sent[0]?.init.method, sent[0]?.url.slice(BASE.length), h(sent[0]!, "Waypoint-Device"), h(sent[0]!, "Idempotency-Key")]).toEqual([
      "POST",
      "/v1/sync/extra",
      "dev_me",
      "key-extra-0123456789",
    ]);
    expect(sent[0]?.init.body).toBe(JSON.stringify({ credits: 100 }));
  });
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (api + 6, api-client + 1), `npm run bundle -w @waypoint/api`. Paste the last lines of each.

### Not in this PR

- The app's sheet (D8).
- An `activity` row or usage event for the purchase. It is not a model task; the wallet's ledger records the hold and the settle under `sync_extra:<user id>:<key>`.
- A price in KV. The price is one constant in `packages/contracts`, read by the server and the app; changing it means a release of both (open question 57).

---

## D6 · App: one notes database per person

Branch `feat/d6-notes-per-person`. From `main` at `3c90a85`. No dependency, no new package (`expo-secure-store`, `expo-file-system` and `expo-sqlite` are in the app). Files, and no others:

- `apps/mobile/src/core/db/users.ts` (new), `apps/mobile/test/user-db.test.ts` (new)
- `apps/mobile/src/platform/db.ts`
- `apps/mobile/src/platform/auth.tsx`
- `apps/mobile/src/platform/sync.ts`
- `apps/mobile/src/platform/device.ts`
- `apps/mobile/src/platform/indexer.ts`

**Why.** Open question 52, decided: each person who signs in on an iPhone or iPad gets their own notes database, opened after sign-in and closed on sign-out, and nothing is deleted. Read "Design: one notes database per person" at the top of this file first: it explains where the file lives, when the existing `waypoint.db` is taken over, why media files do not move, and what silent pushes and background work do.

### 1. The decisions, as pure functions

`apps/mobile/src/core/db/users.ts` (new), exactly:

```ts
import { userIdKey } from "../device/registration.ts";

// One notes database per person on this iPhone (open question 52), named after their Clerk user id. Clerk ids are
// "user_" and letters and digits; anything else is refused, so a name can never reach outside the database folder.
export const LEGACY_DB_NAME = "waypoint.db";

export function userDbName(clerkUserId: string): string {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(clerkUserId)) throw new Error("not a Clerk user id");
  return `waypoint-${clerkUserId}.db`;
}

// The Clerk ids a database's settings record as having signed in with it (the userIdKey rows device.ts writes).
export function clerkIdsIn(settingKeys: readonly string[]): string[] {
  const prefix = userIdKey("");
  return settingKeys.filter((key) => key.startsWith(prefix) && key.length > prefix.length).map((key) => key.slice(prefix.length));
}

// Whether the one database the app kept before (waypoint.db) becomes this person's: when it records them, or records
// nobody. Someone else's stays where it is until one of the people it records signs in.
export function legacyIsTheirs(recorded: readonly string[], clerkUserId: string): boolean {
  return recorded.length === 0 || recorded.includes(clerkUserId);
}

// What the sign-in gate does with the notes: open the signed-in person's, close them once Clerk says nobody is signed
// in, and leave them as they are while Clerk is still loading (offline, the person signed in last is opened on use).
export type NotesStep = { kind: "open"; user: string } | { kind: "close" } | { kind: "keep" };

export function notesStep(input: { clerkLoaded: boolean; clerkSignedIn: boolean | undefined; clerkUserId: string | null | undefined }): NotesStep {
  if (!input.clerkLoaded) return { kind: "keep" };
  if (input.clerkSignedIn === true && typeof input.clerkUserId === "string" && input.clerkUserId !== "") return { kind: "open", user: input.clerkUserId };
  if (input.clerkSignedIn === false) return { kind: "close" };
  return { kind: "keep" };
}
```

`apps/mobile/test/user-db.test.ts` (new), exactly:

```ts
import { describe, expect, it } from "vitest";
import { clerkIdsIn, LEGACY_DB_NAME, legacyIsTheirs, notesStep, userDbName } from "../src/core/db/users.ts";

describe("userDbName", () => {
  it("names a person's database after their Clerk user id", () => {
    expect(userDbName("user_2abcDEF123")).toBe("waypoint-user_2abcDEF123.db");
  });

  it("is never the old shared name", () => {
    expect(userDbName("user_1")).not.toBe(LEGACY_DB_NAME);
  });

  it("refuses an empty id, a path, a dot or an id longer than 64 characters", () => {
    for (const bad of ["", "../user_1", "user/1", "user.1", "a".repeat(65)]) {
      expect(() => userDbName(bad)).toThrow("not a Clerk user id");
    }
  });
});

describe("taking over the old database", () => {
  it("reads the Clerk ids from the server_user_id settings and nothing else", () => {
    expect(clerkIdsIn(["server_user_id:user_a", "device_status:u1", "server_user_id:", "server_user_id:user_b"])).toEqual(["user_a", "user_b"]);
  });

  it("is theirs when it records them, or nobody; not when it records only someone else", () => {
    expect(legacyIsTheirs(["user_a", "user_b"], "user_b")).toBe(true);
    expect(legacyIsTheirs([], "user_b")).toBe(true);
    expect(legacyIsTheirs(["user_a"], "user_b")).toBe(false);
  });
});

describe("notesStep", () => {
  it("opens the signed-in person's notes once Clerk has loaded", () => {
    expect(notesStep({ clerkLoaded: true, clerkSignedIn: true, clerkUserId: "user_a" })).toEqual({ kind: "open", user: "user_a" });
  });

  it("closes them when Clerk says nobody is signed in", () => {
    expect(notesStep({ clerkLoaded: true, clerkSignedIn: false, clerkUserId: null })).toEqual({ kind: "close" });
  });

  it("leaves them while Clerk is loading, or signed in without an id yet", () => {
    expect(notesStep({ clerkLoaded: false, clerkSignedIn: undefined, clerkUserId: undefined })).toEqual({ kind: "keep" });
    expect(notesStep({ clerkLoaded: true, clerkSignedIn: true, clerkUserId: null })).toEqual({ kind: "keep" });
  });
});
```

### 2. Opening and closing a person's notes

`apps/mobile/src/platform/db.ts`:

- Replace everything above the line `let version = 0;` (the imports, `openDeviceDb`, `let device` and `getDb`) with, exactly:

```ts
import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { openDatabaseSync } from "expo-sqlite";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { migrate } from "../core/db/migrate.ts";
import { ensureDefaultSpace } from "../core/db/spaces.ts";
import type { SqlDb, SqlValue } from "../core/db/sql.ts";
import { LEGACY_DB_NAME, clerkIdsIn, legacyIsTheirs, userDbName } from "../core/db/users.ts";
import { userIdKey } from "../core/device/registration.ts";

function openDeviceDb(name: string): { db: SqlDb; close: () => void } {
  const db = openDatabaseSync(name);
  db.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    db: {
      exec: (sql) => db.execSync(sql),
      run: (sql, params: SqlValue[] = []) => {
        const r = db.runSync(sql, params);
        return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
      },
      all: <T,>(sql: string, params: SqlValue[] = []) => db.getAllSync<T>(sql, params),
      get: <T,>(sql: string, params: SqlValue[] = []) => db.getFirstSync<T>(sql, params),
      transaction: (task) => db.withTransactionSync(task),
    },
    close: () => db.closeSync(),
  };
}

// Whose notes are open (open question 52). The Keychain keeps the Clerk user id of the person signed in last, readable
// after the first unlock, so a silent push that wakes the app with no screen opens that same person's notes.
const DB_USER_KEY = "waypoint.db_user";
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

let open: { user: string; db: SqlDb; close: () => void } | null = null;
// The Keychain value once read: a Clerk user id, null for nobody, undefined before the first read.
let stored: string | null | undefined;
// The Keychain delete of the last sign-out, awaited by the next one.
let forgetting: Promise<void> = Promise.resolve();
// Counts every open and close. Work that awaits between reading and writing notes compares it before writing, so it
// never writes into the notes of someone who signed in meanwhile.
let generation = 0;

export function dbGeneration(): number {
  return generation;
}

// The person whose notes this iPhone opens: the one signed in, or signed in last. null when nobody is.
export function dbUser(): string | null {
  if (stored === undefined) {
    try {
      stored = SecureStore.getItem(DB_USER_KEY, KEYCHAIN);
    } catch {
      return null; // not readable yet (before the first unlock): asked again next time
    }
  }
  return stored;
}

// Before this change the app kept one database, waypoint.db, for everyone. A person who signs in takes it over when it
// is theirs or nobody's (legacyIsTheirs): it is renamed to their name, never copied, after its write-ahead log is folded
// in. Someone else's is left untouched. If it cannot be read or renamed, this person starts with a new file and it stays
// for its owner (nothing is logged: the app has no log). expo-sqlite keeps its files in Documents/SQLite on iOS.
function adoptLegacyDb(clerkUserId: string, name: string): void {
  const legacy = new File(Paths.document, "SQLite", LEGACY_DB_NAME);
  if (!legacy.exists || new File(Paths.document, "SQLite", name).exists) return;
  try {
    const old = openDatabaseSync(LEGACY_DB_NAME);
    try {
      const keys = old.getAllSync<{ key: string }>("SELECT key FROM settings WHERE key LIKE ?", [`${userIdKey("")}%`]).map((row) => row.key);
      if (!legacyIsTheirs(clerkIdsIn(keys), clerkUserId)) return;
      old.execSync("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      old.closeSync();
    }
    legacy.rename(name);
    for (const suffix of ["-wal", "-shm"]) {
      const leftover = new File(Paths.document, "SQLite", `${LEGACY_DB_NAME}${suffix}`);
      if (leftover.exists) leftover.delete();
    }
  } catch {
    // A new file for this person; the old one stays as it is.
  }
}

// Opens one person's notes, closing anyone else's. Called by the sign-in gate on every render once Clerk says who is
// signed in, before any screen reads notes, so it does nothing when that person's notes are already open.
export function openUserDb(clerkUserId: string): SqlDb {
  if (open !== null && open.user === clerkUserId) return open.db;
  open?.close();
  open = null;
  const name = userDbName(clerkUserId);
  adoptLegacyDb(clerkUserId, name);
  const { db, close } = openDeviceDb(name);
  migrate(db);
  ensureDefaultSpace(db, { now: Date.now, newId: randomUUID });
  open = { user: clerkUserId, db, close };
  generation += 1;
  if (stored !== clerkUserId) {
    stored = clerkUserId;
    try {
      SecureStore.setItem(DB_USER_KEY, clerkUserId, KEYCHAIN);
    } catch {
      // Not kept: a silent push does nothing until the next sign-in keeps it.
    }
  }
  version += 1; // every query reads the newly opened notes
  return db;
}

// Signed out (or Clerk found the session gone): this person's notes are closed and nothing is deleted. They open again
// when this person signs in; anyone else who signs in gets their own. Resolves once the Keychain no longer names them.
export async function closeUserDb(): Promise<void> {
  open?.close();
  open = null;
  generation += 1;
  version += 1;
  if (stored !== null) {
    stored = null;
    forgetting = SecureStore.deleteItemAsync(DB_USER_KEY, KEYCHAIN).catch(() => undefined);
  }
  await forgetting;
}

// The open person's notes, opened first for the person signed in last (a silent push with no screen). Throws when
// nobody is signed in on this iPhone.
export function getDb(): SqlDb {
  if (open !== null) return open.db;
  const user = dbUser();
  if (user === null) throw new Error("nobody is signed in");
  return openUserDb(user);
}
```

  `version` is declared below these functions; they only run after the module has loaded, so that is fine. `openUserDb` is called during a render (section 3), so it never calls the `useQuery` listeners: it only bumps `version`, and every component that renders afterwards reads the newly opened notes. `dbGeneration` is what work that awaits compares before it writes (section 5, and D8).

- In `useQuery`, replace the first line of `getSnapshot`'s body, `if (cache.current === null || cache.current.version !== version || cache.current.key !== key) {`, with exactly:

```ts
    // Signed out: a screen on its way out keeps what it showed, and nothing is opened.
    if (open === null && dbUser() === null && cache.current !== null) return cache.current.value;
    if (cache.current === null || cache.current.version !== version || cache.current.key !== key) {
```

### 3. The gate and sign-out

`apps/mobile/src/platform/auth.tsx`:

- Replace these lines:

```ts
import { useSignInWithApple } from "@clerk/expo/apple";
import * as SecureStore from "expo-secure-store";
import { REQUIRE_SIGN_IN, decideGate, type Gate } from "../core/auth/gate.ts";

const publishableKey: string = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const SIGNED_IN_BEFORE = "waypoint.signed_in_before";
```

  with exactly:

```ts
import { useSignInWithApple } from "@clerk/expo/apple";
import { REQUIRE_SIGN_IN, decideGate, type Gate } from "../core/auth/gate.ts";
import { notesStep } from "../core/db/users.ts";
import { closeUserDb, dbUser, openUserDb } from "./db.ts";

const publishableKey: string = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
```

- Replace the whole `useGate` function with, exactly (the comment above it is new):

```tsx
// Also decides whose notes are open (open question 52): the person Clerk says is signed in, opened here, before any
// screen reads them. Before Clerk has loaded (offline), the person signed in last time ("signed in before"). When Clerk
// says nobody is signed in, their notes are closed; nothing is deleted.
export function useGate(): Gate {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const notes = notesStep({ clerkLoaded: isLoaded, clerkSignedIn: isSignedIn, clerkUserId: userId });
  if (notes.kind === "open") openUserDb(notes.user);
  const signedInBefore = dbUser() !== null;
  const [waitedMs, setWaitedMs] = useState(0);
  const started = useRef(Date.now());
  const gate = decideGate({ requireSignIn: REQUIRE_SIGN_IN, clerkLoaded: isLoaded, clerkSignedIn: isSignedIn === true, signedInBefore, waitedMs });
  const waiting = gate === "wait";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setWaitedMs(Date.now() - started.current), 500);
    return () => clearInterval(timer);
  }, [waiting]);
  // A backstop for a session that ended without useSignOut (it expired, or was ended elsewhere).
  useEffect(() => {
    if (notes.kind === "close") void closeUserDb();
  }, [notes.kind]);
  return gate;
}
```

- Replace the comment above `useSignOut` and the function with, exactly:

```tsx
// Signing out never deletes notes (K1: "Signing out doesn't delete your notes."). They are closed right after Clerk's
// sign-out, and the Keychain stops naming this person before this resolves; they open again when this person signs in.
export function useSignOut(): () => Promise<void> {
  const { signOut } = useAuth();
  return async () => {
    await signOut();
    await closeUserDb();
  };
}
```

The old Keychain item `waypoint.signed_in_before` is no longer read or written; it is harmless and is left alone. After the update, the first launch reads no `waypoint.db_user` yet, so if Clerk cannot load (offline) the gate waits up to 15 s and then shows sign-in, as on a new phone; once Clerk loads, the person's notes open (and take over `waypoint.db` if it is theirs).

### 4. A silent push with nobody signed in

`apps/mobile/src/platform/sync.ts`:

- Replace the line `import { getDb, writeDb } from "./db.ts";` with exactly:

```ts
import { dbUser, getDb, writeDb } from "./db.ts";
```

- Replace the comment line above `TaskManager.defineTask(SYNC_TASK, …)` and the whole `defineTask` call with, exactly:

```ts
// The person comes from the stored identity (device.ts); when that is not known, or nobody is signed in on this iPhone
// (open question 52: no notes are open), nothing is done. A push for a group only someone else on this iPhone is in
// finds no such group in these notes and does nothing either (runOnce).
TaskManager.defineTask(SYNC_TASK, async ({ data, error }) => {
  if (error !== null) return;
  const groupId = groupFromPush(data);
  if (groupId !== null && dbUser() !== null && restoreApprovedUser() !== null) await syncNow(groupId);
});
```

### 5. No writes into the wrong person's notes

`apps/mobile/src/platform/device.ts`:

- Replace the line `import { getDb, writeDb } from "./db.ts";` with exactly:

```ts
import { dbUser, getDb, writeDb } from "./db.ts";
```

- In `useDeviceRegistration`, replace the line `if (userId !== null || (isLoaded && isSignedIn === false)) writeDb((db) => deleteSetting(db, LAST_USER_KEY));` with exactly:

```ts
      // Only while that person's notes are still open (open question 52: sign-out closes them).
      if (dbUser() !== null && (userId !== null || (isLoaded && isSignedIn === false))) writeDb((db) => deleteSetting(db, LAST_USER_KEY));
```

`apps/mobile/src/platform/indexer.ts`:

- Replace the line `import { getDb, writeDb } from "./db.ts";` with exactly:

```ts
import { dbGeneration, getDb, writeDb } from "./db.ts";
```

- Replace the line `let staleChecked = false;` with exactly:

```ts
// The notes (dbGeneration) whose stale vectors were marked: once per launch and per person who signs in.
let staleChecked = -1;
```

- In `tick`, replace these lines:

```ts
    const db = getDb();
    if (!staleChecked) {
      writeDb((d) => markStale(d, model.modelVersion));
      staleChecked = true;
    }
    for (const sessionId of sessionsToIndex(db, SESSIONS_PER_TICK)) {
```

  with exactly:

```ts
    const db = getDb();
    const generation = dbGeneration();
    if (staleChecked !== generation) {
      writeDb((d) => markStale(d, model.modelVersion));
      staleChecked = generation;
    }
    for (const sessionId of sessionsToIndex(db, SESSIONS_PER_TICK)) {
      if (dbGeneration() !== generation) return; // signed out or another person meanwhile: stop
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (mobile + 8), `npm run export:ios -w @waypoint/mobile`. Paste the last lines of each.

### Device check

On the iPhone (or the simulator), in this order:

1. Install a build of `main` before this card, sign in as A, make a recording and a page set. Install this card's build over it (do not delete the app). A is still signed in and sees both, and `Documents/SQLite` (Xcode › Devices › the app's container) holds `waypoint-<A's Clerk id>.db` and no `waypoint.db`.
2. Settings › Sign out. Sign in as B (another email). B sees an empty Home (the default space only), no recordings, no search results for A's words, and Settings › Storage counts only B's (after D7).
3. B records something. Sign out, sign in as A: A's notes are all there and B's recording is not.
4. Repeat step 1 on a fresh install, but after installing this card's build sign out first and sign in as B: B gets a new, empty file and `waypoint.db` is still there. Sign out, sign in as A: A's notes are back and `waypoint.db` is gone.
5. With A signed in and a synced space, sign out, then from another device change a note in that space: no notes open on this iPhone (the silent push does nothing). Sign in as A: the change arrives.
6. With B signed in, change a note in A's synced space from another device: nothing appears for B. Sign in as A: it arrives.
7. Turn on airplane mode, force-quit, open the app: A (signed in last) gets in after the offline wait and sees their notes.

### Not in this PR

- The storage screen's numbers (D7).
- Moving media into a folder per person (see the design: not needed).
- Removing a signed-out person's push token, or hiding their alert pushes from the next person.
- A "switch person" menu, or a kid or parent mode.
- A generation check in the other loops (transcription, page reading, overviews, jobs): their writes are rows of one session, which fail their foreign key in another person's file.

---

## D7 · App: the storage screen counts only your recordings

Branch `feat/d7-storage-per-person`. From `main` at `3c90a85`. No dependency. Files, and no others:

- `apps/mobile/src/platform/files.ts`
- `apps/mobile/src/features/settings/StorageScreen.tsx`

**Why.** Recordings and page photos live in `Documents/sessions/<session id>/`, one folder shared by everyone who signs in on the iPhone (each session id is a random UUID; see the design for question 52). Settings › Storage & search adds up the whole `sessions` folder, so after D6 it would show one person how much everybody's recordings take. It now adds up only the folders of the sessions in the open person's notes. This card works the same before D6 (one database: every session is counted), so it can merge in any order.

### 1. Count given sessions

`apps/mobile/src/platform/files.ts`: replace the `sessionsBytes` function with, exactly:

```ts
// What these sessions' recordings and pages take. The sessions folder is shared by everyone who signs in on this iPhone
// (each session has its own random id), so only the open person's sessions are counted (open question 52).
export function sessionsBytes(sessionIds: readonly string[]): number {
  let bytes = 0;
  for (const id of sessionIds) {
    const folder = new Directory(Paths.document, "sessions", id);
    if (folder.exists) bytes += folder.info().size ?? 0;
  }
  return bytes;
}
```

`apps/mobile/src/features/settings/StorageScreen.tsx`: replace the line `const bytes = sessionsBytes();` with exactly:

```ts
  const sessionIds = useQuery((db) => db.all<{ id: string }>("SELECT id FROM sessions").map((row) => row.id));
  const bytes = sessionsBytes(sessionIds);
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (mobile unchanged: `platform/` has no test setup), `npm run export:ios -w @waypoint/mobile`. Paste the last lines of each.

### Device check

Make a recording and a page set, open Settings › Storage & search: "Recordings and pages" shows about their size. After D6: sign out, sign in as someone with no notes: it shows 0 KB.

### Not in this PR

- Overviews' audio and video (`Documents/overviews/`): not counted today either.

---

## D8 · App: the sync limit sheet

Branch `feat/d8-sync-limit-sheet`. From `main` at `3c90a85`, **after D5 and D6 are merged** (D5 adds `api.buySyncExtra` and the contract constants; D6 adds `dbGeneration` and also edits `apps/mobile/src/platform/sync.ts`, other lines). No new package. Files, and no others:

- `apps/mobile/src/core/sync/limit.ts` (new), `apps/mobile/test/sync-limit.test.ts` (new)
- `apps/mobile/src/platform/sync.ts`
- `apps/mobile/src/app/sync-limit.tsx` (new), `apps/mobile/src/app/_layout.tsx`
- `apps/mobile/src/features/capture/SyncLimitScreen.tsx` (new), `apps/mobile/src/features/capture/SpaceScreen.tsx`
- `apps/mobile/src/features/share/ShareSessionScreen.tsx`

**Why.** After D3 the server answers 429 "daily sync limit reached" when a person has sent their 200 MB for the UTC day (open question 55). Without this card the app would try again every 5 seconds, and the share screen would say "Still working on it". The owner's decision: the app shows a sheet, "You've synced 200 MB today. Add 1 GB more for today for 100 credits", which spends credits through D5's `POST /v1/sync/extra`.

What the app does:

- A send that gets the limit stores the time sync may start again (the reply's `retry_after`: the next 00:00 UTC) in the setting `sync_limit_until`. Until then `runOnce` does not send; it still pulls, so other people's changes keep arriving. Changes made meanwhile wait in the outbox, as they do offline.
- The space screen of a synced space shows "Today's sync is used up. Changes wait on this iPhone." and an "Add more for today" button that opens the sheet. The sheet does not open by itself from a background send: it could appear over a recording.
- Making a shared link that gets the limit opens the sheet at once.
- The sheet's "Add 1 GB · 100 credits" calls `POST /v1/sync/extra` with the price it showed. On success it clears the pause and sends what waited. Out of credits shows the shortfall and "Get credits" (the Plans screen); the same Idempotency-Key is kept for the retry, so one purchase is never paid twice. "Wait" closes the sheet. The title always says "You've synced 200 MB today".
- Each of these reads `dbGeneration()` (D6) before its request and writes the setting only if no one signed out or in meanwhile.

### 1. The rules and the words

`apps/mobile/src/core/sync/limit.ts` (new), exactly:

```ts
import { SYNC_DAILY_BYTES, SYNC_DAILY_LIMIT_MESSAGE, SYNC_EXTRA_BYTES, SYNC_EXTRA_CREDITS } from "@waypoint/contracts";
import { bytesLabel } from "../settings/format.ts";

const HOUR_MS = 3_600_000;

// While today's sync budget is used up (open question 55): the time (Unix ms) sending may start again.
export const SYNC_LIMIT_KEY = "sync_limit_until";

// The server's 429 when today's budget is used up (POST /v1/groups/:id/changes, POST /v1/links).
export function isSyncLimit(status: number, message: string): boolean {
  return status === 429 && message === SYNC_DAILY_LIMIT_MESSAGE;
}

// When sending may start again: after the reply's retry_after (the next 00:00 UTC), or in an hour without one.
export function limitUntil(now: number, retryAfterSeconds: number | null): number {
  return now + (retryAfterSeconds === null ? HOUR_MS : retryAfterSeconds * 1000);
}

// Whether sending waits: a stored SYNC_LIMIT_KEY time still ahead.
export function sendingPaused(stored: string | null, now: number): boolean {
  return stored !== null && Number(stored) > now;
}

// The sheet's words. `againAt` is when sync starts again, as the screen shows a time.
export function syncLimitCopy(againAt: string): { title: string; body: string; buy: string } {
  const extra = `${SYNC_EXTRA_BYTES / 1_000_000_000} GB`;
  return {
    title: `You've synced ${bytesLabel(SYNC_DAILY_BYTES)} today`,
    body: `Add ${extra} more for today for ${SYNC_EXTRA_CREDITS} credits, or wait until ${againAt}, when sync starts again. Your notes stay on this iPhone meanwhile.`,
    buy: `Add ${extra} · ${SYNC_EXTRA_CREDITS} credits`,
  };
}
```

`apps/mobile/test/sync-limit.test.ts` (new), exactly:

```ts
import { describe, expect, it } from "vitest";
import { isSyncLimit, limitUntil, sendingPaused, syncLimitCopy } from "../src/core/sync/limit.ts";

const DAY = 86_400_000;
const NOW = 20_400 * DAY + 18 * 3_600_000;

describe("the daily sync limit", () => {
  it("is a 429 with the server's message, nothing else", () => {
    expect(isSyncLimit(429, "daily sync limit reached")).toBe(true);
    expect(isSyncLimit(429, "too many requests")).toBe(false);
    expect(isSyncLimit(409, "daily sync limit reached")).toBe(false);
  });

  it("waits retry_after seconds, or an hour without one", () => {
    expect(limitUntil(NOW, 21_600)).toBe(NOW + 21_600_000);
    expect(limitUntil(NOW, null)).toBe(NOW + 3_600_000);
  });

  it("pauses sending only while the stored time is ahead", () => {
    expect(sendingPaused(String(NOW + 1), NOW)).toBe(true);
    expect(sendingPaused(String(NOW), NOW)).toBe(false);
    expect(sendingPaused(null, NOW)).toBe(false);
  });

  it("says what was synced today and what more costs", () => {
    expect(syncLimitCopy("7:00 PM")).toEqual({
      title: "You've synced 200 MB today",
      body: "Add 1 GB more for today for 100 credits, or wait until 7:00 PM, when sync starts again. Your notes stay on this iPhone meanwhile.",
      buy: "Add 1 GB · 100 credits",
    });
  });
});
```

### 2. Pausing, and buying more

`apps/mobile/src/platform/sync.ts` (as D6 left it):

- Replace these two lines:

```ts
import { SyncServerMessageSchema } from "@waypoint/contracts";
import { deleteSetting, setSetting } from "../core/db/settings.ts";
```

  with exactly:

```ts
import { SYNC_EXTRA_CREDITS, SyncServerMessageSchema } from "@waypoint/contracts";
import { keepsKey, type CloudFailure } from "../core/cloud/failure.ts";
import { deleteSetting, getSetting, setSetting } from "../core/db/settings.ts";
```

- After the line `} from "../core/sync/rules.ts";`, add exactly:

```ts
import { SYNC_LIMIT_KEY, isSyncLimit, limitUntil, sendingPaused } from "../core/sync/limit.ts";
```

- Replace these three lines (the first is D6's):

```ts
import { dbUser, getDb, writeDb } from "./db.ts";
import { currentUserId, restoreApprovedUser, useDeviceStatus } from "./device.ts";
import { createGroup, ensureKeys, refreshGroups } from "./groups.ts";
```

  with exactly:

```ts
import { dbGeneration, dbUser, getDb, writeDb } from "./db.ts";
import { currentUserId, requireApprovedDevice, restoreApprovedUser, useDeviceStatus } from "./device.ts";
import { createGroup, ensureKeys, refreshGroups } from "./groups.ts";
import { toFailure } from "./tasks.ts";
```

- In `runOnce`, after the line `if (pull) pullQueued.delete(groupId);`, add exactly:

```ts
  const generation = dbGeneration();
```

- In `runOnce`, replace the line `await sendPending(user, group, keys.deviceId);` with exactly:

```ts
    // Today's sync is used up (open question 55): changes wait in the outbox; pulls go on.
    if (!sendingPaused(getSetting(getDb(), SYNC_LIMIT_KEY), Date.now())) await sendPending(user, group, keys.deviceId);
```

- In `runOnce`, replace both lines `await afterFailure(groupId, error);` with exactly:

```ts
    await afterFailure(groupId, error, generation);
```

- Before the comment `// The group's key moved on (a member was removed): take the new key now; the outbox waits for it.` (above `afterFailure`), add exactly:

```ts
// True when `error` says today's sync is used up (open question 55). Sending then waits until the time the server gave,
// and the space screen offers more (the sync-limit sheet). The share screen calls this for a link, too. `generation` is
// dbGeneration() from before the request: if someone else's notes are open by now, nothing is written.
export function syncLimitHit(error: unknown, generation: number): boolean {
  if (!(error instanceof ApiCallError && isSyncLimit(error.status, error.message))) return false;
  if (dbGeneration() === generation) writeDb((db) => setSetting(db, SYNC_LIMIT_KEY, String(limitUntil(Date.now(), error.retryAfter))));
  return true;
}

let extraKey: string | null = null;

// The sheet's "Add 1 GB": spends SYNC_EXTRA_CREDITS for more sync today (POST /v1/sync/extra), then sends what waited.
// The Idempotency-Key is kept while a retry may still buy the same thing (after a purchase of credits, offline), so one
// tap never pays twice. null when it worked. An iPhone that is not approved yet gets the screen that says why, and
// "device" back.
export async function buyMoreSync(): Promise<CloudFailure | null> {
  if (!requireApprovedDevice()) return { kind: "device" };
  extraKey ??= randomUUID();
  const generation = dbGeneration();
  try {
    await api.buySyncExtra(SYNC_EXTRA_CREDITS, extraKey);
    extraKey = null;
    if (dbGeneration() !== generation) return null; // signed out meanwhile: the next sign-in finds the limit again
    writeDb((db) => deleteSetting(db, SYNC_LIMIT_KEY));
    for (const groupId of syncedGroupIds(getDb())) void syncNow(groupId);
    return null;
  } catch (error) {
    const failure = toFailure(error);
    if (!keepsKey(failure)) extraKey = null;
    return failure;
  }
}

```

- Replace the first line of `afterFailure`, `async function afterFailure(groupId: string, error: unknown): Promise<void> {`, with these two lines, exactly:

```ts
async function afterFailure(groupId: string, error: unknown, generation: number): Promise<void> {
  if (syncLimitHit(error, generation)) return;
```

### 3. The sheet

`apps/mobile/src/app/sync-limit.tsx` (new), exactly:

```ts
export { default } from "../features/capture/SyncLimitScreen.tsx";
```

`apps/mobile/src/app/_layout.tsx`: after the line `<Stack.Screen name="new-space" options={{ presentation: "formSheet" }} />`, add exactly:

```tsx
        <Stack.Screen name="sync-limit" options={{ presentation: "formSheet" }} />
```

`apps/mobile/src/features/capture/SyncLimitScreen.tsx` (new), exactly:

```tsx
import { useState } from "react";
import { router } from "expo-router";
import { failureCopy, type CloudFailure } from "../../core/cloud/failure.ts";
import { getSetting } from "../../core/db/settings.ts";
import { SYNC_LIMIT_KEY, syncLimitCopy } from "../../core/sync/limit.ts";
import { useQuery } from "../../platform/db.ts";
import { buyMoreSync } from "../../platform/sync.ts";
import { Body, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";

// Today's sync is used up (open question 55): add more for today with credits, or wait until it starts again.
export default function SyncLimitScreen() {
  const until = useQuery((db) => getSetting(db, SYNC_LIMIT_KEY));
  const againAt = until === null ? "tomorrow" : new Date(Number(until)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const copy = syncLimitCopy(againAt);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CloudFailure | null>(null);

  async function buy(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await buyMoreSync();
    setBusy(false);
    if (result === null) router.back();
    else setFailure(result);
  }

  const problem = failure === null ? null : failureCopy(failure);
  return (
    <Screen>
      <Title>{copy.title}</Title>
      <Body>{copy.body}</Body>
      <PrimaryButton label={busy ? "Adding…" : copy.buy} icon="arrow.up.circle" onPress={() => void buy()} />
      {problem !== null ? <Body>{`${problem.title}. ${problem.body}`}</Body> : null}
      {failure?.kind === "out_of_credits" ? <SecondaryButton label="Get credits" icon="creditcard" onPress={() => router.push("/plans")} /> : null}
      <SecondaryButton label="Wait" onPress={() => router.back()} />
    </Screen>
  );
}
```

### 4. Where the sheet opens

`apps/mobile/src/features/capture/SpaceScreen.tsx`:

- Replace these lines:

```ts
import { useQuery } from "../../platform/db.ts";
import { SYNC_PLAN_KEY, isSpaceSynced, turnOnSync } from "../../platform/sync.ts";
import { Body, Row, Screen, Title } from "../../ui/kit.tsx";
```

  with exactly:

```ts
import { SYNC_LIMIT_KEY, sendingPaused } from "../../core/sync/limit.ts";
import { useMinuteNow, useQuery } from "../../platform/db.ts";
import { SYNC_PLAN_KEY, isSpaceSynced, turnOnSync } from "../../platform/sync.ts";
import { Body, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
```

- Replace the `const data = useQuery(…);` statement with, exactly:

```ts
  const now = useMinuteNow();
  const data = useQuery(
    (db) => ({
      space: getSpace(db, id),
      sessions: sessionsInSpace(db, id),
      synced: isSpaceSynced(db, id),
      planRequired: getSetting(db, SYNC_PLAN_KEY) === "1",
      limited: sendingPaused(getSetting(db, SYNC_LIMIT_KEY), now),
    }),
    `${id}:${now}`,
  );
```

- After the line `{data.synced && data.planRequired ? <Body>Photos and audio sync on paid plans.</Body> : null}`, add exactly:

```tsx
      {data.synced && data.limited ? (
        <>
          <Body>Today's sync is used up. Changes wait on this iPhone.</Body>
          <SecondaryButton label="Add more for today" icon="arrow.up.circle" onPress={() => router.push("/sync-limit")} />
        </>
      ) : null}
```

`apps/mobile/src/features/share/ShareSessionScreen.tsx`:

- Replace the line `import { useLocalSearchParams } from "expo-router";` with exactly:

```ts
import { router, useLocalSearchParams } from "expo-router";
```

- Replace the line `import { useQuery } from "../../platform/db.ts";` with exactly:

```ts
import { dbGeneration, useQuery } from "../../platform/db.ts";
```

- After the line `import { createLink, linkFailureText, revokeLink } from "../../platform/links.ts";`, add exactly:

```ts
import { syncLimitHit } from "../../platform/sync.ts";
```

- In the function that makes the link, after the line `setBusy(true);` (the one just above `try { setMade(await createLink(…`), add exactly:

```ts
    const generation = dbGeneration();
```

- In the same function, replace the line `setError(linkFailureText(failure, "make"));` with exactly:

```ts
      // Today's sync is used up (open question 55): the sheet offers more for today.
      if (syncLimitHit(failure, generation)) router.push("/sync-limit");
      else setError(linkFailureText(failure, "make"));
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (mobile + 4), `npm run export:ios -w @waypoint/mobile`. Paste the last lines of each. `test/boundaries.test.ts` passes: `SyncLimitScreen` is in `features/capture` and `ShareSessionScreen` opens it by its route, not by an import.

### Device check

Against a staging API with D3 and D5 deployed (set a test user's `sync_days.bytes` to 200,000,000 for today with `wrangler d1 execute`):

1. Edit a note in a synced space. The space screen shows "Today's sync is used up…" within a few seconds, and the other device does not get the edit. Changes from the other device still arrive.
2. "Add more for today": the sheet says "You've synced 200 MB today" and "Add 1 GB more for today for 100 credits, or wait until <the local time of 00:00 UTC>…". Tap "Add 1 GB · 100 credits": the sheet closes, the edit arrives on the other device, and Plans shows 100 credits fewer.
3. With fewer than 100 credits: the sheet says "Out of credits. You need N more credits…" and shows "Get credits".
4. Share a link while the limit is reached: the sheet opens instead of an error.

### Not in this PR

- Opening the sheet by itself when a background send hits the limit.
- Showing how much of today's budget is used, or what was bought today (no read route; not asked for).

---

## D9 · App: play a recording from the session screen

Branch `feat/d9-play-recording`. From `main` at `3c90a85`. No dependency, no new package (`expo-audio` is already in the app; `OverviewScreen` uses it). Files, and no others:

- `apps/mobile/src/core/capture/playback.ts` (new), `apps/mobile/test/playback.test.ts` (new)
- `apps/mobile/src/features/capture/RecordingPlayer.tsx` (new)
- `apps/mobile/src/features/capture/SessionScreen.tsx`

**Why.** No screen plays back a session's own recording (open question 54). The owner's decision: a small player on the session screen with `expo-audio`, where tapping a transcript line jumps to it. A tap on a line's words already opens Explain (M15), so the line's time (the "4:12" on its left) is the tap target: it plays the recording from there. The time is shown in the accent colour when the recording can be played.

A recording is stored as parts (`captures` of kind `audio`, one `.m4a` each, `t` = where the part starts on the session's clock, which is the clock of the transcript's `t_start`). The player plays the parts in order with `useAudioPlaylist`; a jump finds the part that holds the time (`partAt`) and seeks inside it. A part that came from another device and has not been downloaded yet (`file = ''`) is left out. Nothing plays while a recording is running, as on the overview screen. The only audio setting the player changes is `playsInSilentMode` (so a recording is heard with the silent switch on), and only when nothing records; it does not ask to keep playing in the background. The time label has a `hitSlop` of 12 points, so it is easy to tap. The player lives in `features/capture`, so `SessionScreen` does not import the overview feature, and `src/core` gets only a pure function.

### 1. Where a time is

`apps/mobile/src/core/capture/playback.ts` (new), exactly:

```ts
// A recording plays as its audio parts in order (open question 54). startMs is where a part starts on the session's
// clock, the clock the transcript's times use; durationMs is 0 when it was never measured.
export type PlayPart = { startMs: number; durationMs: number };

// Where session time `ms` is in the parts: the part that holds it and how far into it. A time before the first part or
// in a gap between parts (a pause) goes to the start of the next part; a time after the end, to the end of the last.
// A part of unknown length runs until the next part starts. null when there are no parts.
export function partAt(parts: readonly PlayPart[], ms: number): { index: number; offsetMs: number } | null {
  for (const [index, part] of parts.entries()) {
    if (ms < part.startMs) return { index, offsetMs: 0 };
    const end = part.durationMs > 0 ? part.startMs + part.durationMs : (parts[index + 1]?.startMs ?? Number.POSITIVE_INFINITY);
    if (ms < end) return { index, offsetMs: ms - part.startMs };
  }
  const last = parts.length - 1;
  const part = parts[last];
  return part === undefined ? null : { index: last, offsetMs: part.durationMs };
}
```

`apps/mobile/test/playback.test.ts` (new), exactly:

```ts
import { describe, expect, it } from "vitest";
import { partAt } from "../src/core/capture/playback.ts";

// Two parts with a 10 s pause between them: 0–60 s and 70–100 s on the session's clock.
const PARTS = [
  { startMs: 0, durationMs: 60_000 },
  { startMs: 70_000, durationMs: 30_000 },
];

describe("partAt", () => {
  it("finds the part that holds a time and the offset into it", () => {
    expect(partAt(PARTS, 0)).toEqual({ index: 0, offsetMs: 0 });
    expect(partAt(PARTS, 59_999)).toEqual({ index: 0, offsetMs: 59_999 });
    expect(partAt(PARTS, 85_000)).toEqual({ index: 1, offsetMs: 15_000 });
  });

  it("a time in the pause starts the next part from its beginning", () => {
    expect(partAt(PARTS, 65_000)).toEqual({ index: 1, offsetMs: 0 });
  });

  it("a time after the end goes to the end of the last part", () => {
    expect(partAt(PARTS, 500_000)).toEqual({ index: 1, offsetMs: 30_000 });
  });

  it("a part of unknown length runs until the next one starts", () => {
    const parts = [
      { startMs: 0, durationMs: 0 },
      { startMs: 70_000, durationMs: 0 },
    ];
    expect(partAt(parts, 65_000)).toEqual({ index: 0, offsetMs: 65_000 });
    expect(partAt(parts, 200_000)).toEqual({ index: 1, offsetMs: 130_000 });
  });

  it("no parts: null", () => {
    expect(partAt([], 1_000)).toBeNull();
  });
});
```

### 2. The player

`apps/mobile/src/features/capture/RecordingPlayer.tsx` (new), exactly:

```tsx
import { useEffect } from "react";
import { setAudioModeAsync, useAudioPlaylist, useAudioPlaylistStatus } from "expo-audio";
import { getRecorderStatus } from "../../../modules/waypoint-audio/index.ts";
import { partAt, type PlayPart } from "../../core/capture/playback.ts";
import { formatOffset } from "../../core/format.ts";
import { fileUri } from "../../platform/files.ts";
import { Caption, PrimaryButton } from "../../ui/kit.tsx";

export type PlayFile = PlayPart & { file: string };

// Plays a session's own recording on this iPhone (open question 54): its parts in order. `seek` is set (a new object
// each time) when a transcript line's time is tapped: playback jumps there. Nothing plays while a recording runs.
export function RecordingPlayer({ parts, seek }: { parts: PlayFile[]; seek: { ms: number } | null }) {
  const playlist = useAudioPlaylist({ sources: parts.map((part) => fileUri(part.file)) });
  const status = useAudioPlaylistStatus(playlist);
  const recording = getRecorderStatus().state !== "idle";
  const at = (parts[status.currentIndex]?.startMs ?? 0) + status.currentTime * 1000;

  async function play(from: number | null): Promise<void> {
    if (recording) return;
    // Heard with the silent switch on, as the overview player. Nothing else about the audio session changes, and it is
    // set only when nothing records (the recorder keeps its own settings).
    await setAudioModeAsync({ playsInSilentMode: true });
    const where = from === null ? null : partAt(parts, from);
    if (where !== null) {
      if (where.index !== status.currentIndex) playlist.skipTo(where.index);
      await playlist.seekTo(where.offsetMs / 1000);
    }
    playlist.play();
  }

  useEffect(() => {
    if (seek !== null) void play(seek.ms);
  }, [seek]);

  return (
    <>
      <PrimaryButton
        label={recording ? "Stop the recording to play" : status.playing ? "Pause" : "Play the recording"}
        icon={status.playing ? "pause.fill" : "play.fill"}
        onPress={() => (status.playing ? playlist.pause() : void play(null))}
      />
      <Caption>{`${formatOffset(at)} · tap a time to play from there`}</Caption>
    </>
  );
}
```

### 3. The session screen

`apps/mobile/src/features/capture/SessionScreen.tsx`:

- Replace these lines:

```tsx
import { useColors } from "../../ui/theme.ts";

// One session: its title, when and where it was saved, and what to do with it.
// A recording's transcript lists its lines; tapping a word opens Explain (M15).
```

  with exactly:

```tsx
import { useColors } from "../../ui/theme.ts";
import { RecordingPlayer } from "./RecordingPlayer.tsx";

// One session: its title, when and where it was saved, and what to do with it.
// A recording's transcript lists its lines; tapping a word opens Explain (M15), tapping a line's time plays the
// recording from there (open question 54).
```

- In the `useQuery` read, replace the line `second: session.kind === "recording" ? secondTranscript(db, id) : null,` with exactly:

```tsx
      second: session.kind === "recording" ? secondTranscript(db, id) : null,
      // The recording's parts that are on this iPhone (a synced part may not be downloaded yet).
      playParts: session.kind === "recording" ? uploadParts(db, id).filter((part) => part.file !== "") : [],
```

- After the line `const [showSecond, setShowSecond] = useState(view === "second");`, add exactly:

```tsx
  const [seek, setSeek] = useState<{ ms: number } | null>(null);
```

- Replace the line `const { session, spaceName, pages, segments, research, second, overviews, links, role } = data;` with exactly:

```tsx
  const { session, spaceName, pages, segments, research, second, overviews, links, role, playParts } = data;
  const playable = playParts.length > 0 && (session.state === "saved" || session.state === "interrupted");
```

- Before the line `{second !== null ? (` (the one above `<View style={styles.switchRow}>`), add exactly:

```tsx
      {playable ? <RecordingPlayer parts={playParts} seek={seek} /> : null}

```

- In the transcript lines, replace the line `<Text style={[styles.time, { color: colors.ink3 }]}>{formatOffset(segment.tStart)}</Text>` with exactly:

```tsx
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Play from ${formatOffset(segment.tStart)}`}
              hitSlop={12}
              disabled={!playable}
              onPress={() => setSeek({ ms: segment.tStart })}
            >
              <Text style={[styles.time, { color: playable ? colors.accent : colors.ink3 }]}>{formatOffset(segment.tStart)}</Text>
            </Pressable>
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (mobile + 5), `npm run export:ios -w @waypoint/mobile`. Paste the last lines of each.

### Device check

1. Record about two minutes with a pause in the middle (so the recording has two parts), then open the session. "Play the recording" plays from the start, through the pause into the second part; the clock under the button follows.
2. Tap the time of a line in the second part while the first part plays: playback jumps to that line within about a second. Tap a word: Explain opens, as before.
3. With the ring/silent switch on silent, playback is heard (`playsInSilentMode`).
4. Start a new recording, then go back to an older session: the button says "Stop the recording to play" and nothing plays.
5. A session synced from another device whose audio has not downloaded shows no player and plain times.

### Not in this PR

- Highlighting the line being played, a speed control or a scrubber.
- Playing the second transcript's lines (it shows words per part, without times).

---

## D10 · App: "from now" members drop changes to older notes

Branch `fix/d10-history-from-now`. From `main` at `3c90a85`. No dependency. Files, and no others:

- `apps/mobile/src/core/sync/changes.ts`, `apps/mobile/test/sync.test.ts`
- `apps/mobile/src/features/share/InviteScreen.tsx`

**Why.** When an owner invites someone, the invite screen asks "History": "From now" (`history_from` = now) or "Everything so far" (0) (`platform/share.ts`). The owner confirmed that choice (open question 56: "when adding someone you can decide what they can see, history or from there"). The server sends a member only the changes made after their `history_from`, but an edit to an older note is a change made after it: the member's iPhone gets the edit without the note. A segment or flag waits in `sync_pending` until the 2,000 cap drops it, and a title edit creates the old note there without its text. The fix, on the member's iPhone: a change to a note started before their `history_from` is dropped (answered `"older"`), not kept waiting. A member invited with "Everything so far" (`history_from` 0) and the group's owner get everything, as today.

A note counts by when it was started, also when the owner moves an older note into the shared space later: a "from now" member does not get it.

The invite screen already shows the choice for every invite (editor and viewer; an owner invite does not exist), so it stays. One line under it now says what each option means, because "From now" alone does not say that edits to older notes are not shared.

### 1. Applying changes

`apps/mobile/src/core/sync/changes.ts`:

- In the comment above `applyChange`, replace these two lines:

```ts
// - "applied": written; "older": not newer than what this iPhone has (an echo, a replay, a late change, or its
//   session was deleted);
```

  with exactly:

```ts
// - "applied": written; "older": not newer than what this iPhone has (an echo, a replay, a late change, or its
//   session was deleted), or about a note started before this member joined a group that invited them "from now"
//   (open question 56: they get only notes started after joining, and edits to older notes are dropped, not kept);
```

- Before the comment `// A row that is not here but has a version was deleted.`, add exactly:

```ts
// When this iPhone's person joined the group, for an invite "from now"; 0 for "everything" (and for the group's owner).
function historyFrom(db: SqlDb, groupId: string): number {
  return db.get<{ history_from: number }>("SELECT history_from FROM groups WHERE id = ?", [groupId])?.history_from ?? 0;
}

```

- In `write`, in the `sessions` upsert branch, after the line `if (here !== null && here !== space) return synced(db, here) ? defer(db, groupId, change, deviceId, table, key, key) : "rejected";`, add exactly:

```ts
    // A note started before this member joined "from now" (open question 56) is not theirs to see.
    if (here === null && typeof change.row.started_at === "number" && change.row.started_at < historyFrom(db, groupId)) return "older";
```

  A note that is already on this iPhone (`here` is not null) is never dropped.

- Replace the line `if (parent === null) return wasDeleted(db, "sessions", sessionId) ? "older" : defer(db, groupId, change, deviceId, table, key, sessionId);` with exactly:

```ts
  // Its session is not here. Deleted, or (a member invited "from now", open question 56) a note started before they
  // joined, which they never get: dropped. Otherwise it waits for its session.
  if (parent === null) {
    if (wasDeleted(db, "sessions", sessionId) || historyFrom(db, groupId) > 0) return "older";
    return defer(db, groupId, change, deviceId, table, key, sessionId);
  }
```

  For a "from now" member, a change whose session is not here can only be about an older note. A note started after they joined reaches them whole: its session's first upsert is in the group's log before its segments, flags and cards, because every iPhone sends a note's parent first (`collectChanges`) and stops at a failed send, and the room keeps the order. A card still waits for its photo, as before.

`apps/mobile/test/sync.test.ts`: in `describe("applying changes")`, before the test `"children of a deleted session are dropped, not kept waiting"`, add exactly:

```ts
  it("a member invited from now drops changes to a note started before they joined; a newer note lands", () => {
    const a = device("a");
    const b = device("b");
    const old = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, old.id, { tStart: 0, tEnd: 10, text: "before" });
    addFlag(a.db, a.deps, old.id, 5);
    const before = send(a);
    b.db.run("UPDATE groups SET history_from = ? WHERE id = ?", [old.startedAt + 1, G]);
    expect(before.map((c) => applyChange(b.db, G, c, "dev_a"))).toEqual(["older", "older", "older"]);
    expect(applyChange(b.db, G, { ...one(before, "upsert", "sessions"), at: 9_000, row: { ...one(before, "upsert", "sessions").row, title: "Renamed" } }, "dev_a")).toBe("older");
    expect(count(b, "sessions")).toBe(0);
    expect(count(b, "sync_pending")).toBe(0);
    const later = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, later.id, { tStart: 0, tEnd: 10, text: "after" });
    expect(send(a).map((c) => applyChange(b.db, G, c, "dev_a"))).toEqual(["applied", "applied"]);
    expect(b.db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = ?", [later.id])?.text).toBe("after");
  });
  it("a member invited with everything gets changes to notes from before they joined", () => {
    const a = device("a");
    const b = device("b");
    const old = startRecordingSession(a.db, a.deps, a.space.id, true);
    saveSegment(a.db, old.id, { tStart: 0, tEnd: 10, text: "before" });
    expect(send(a).map((c) => applyChange(b.db, G, c, "dev_a"))).toEqual(["applied", "applied"]);
  });
```

The second test is a guard: it passes on `main` too, and must keep passing.

### 2. The invite screen says what the choice means

`apps/mobile/src/features/share/InviteScreen.tsx`: after the line `<Choices options={HISTORY} value={history} onChange={setHistory} />`, add exactly:

```tsx
      <Caption>
        {history === "from_now"
          ? "They'll see notes started from now on. Older notes, and changes to them, stay with you."
          : "They'll see every note in this space, older ones too."}
      </Caption>
```

### Checks

Root `npm install`, `npm run typecheck`, `npm test` (mobile + 2), `npm run export:ios -w @waypoint/mobile`. Paste the last lines of each.

### Device check

1. Owner: a shared space with an old recording. Invite a second person "From now"; they accept on their iPhone and see an empty space. The owner renames the old recording and adds a flag to it: nothing appears for the member, even after a pull. The owner records something new: it appears for the member with its transcript.
2. Invite a third person "Everything so far": they get the old recording, and the rename.
3. On the invite screen, switching History between the two options changes the line under it.

### Not in this PR

- Changing a member's history after they joined (the server has no route for it).
- Clearing what already waits in `sync_pending` on a member's iPhone from before this fix: it is capped at 2,000 per group and is dropped when its session is deleted, as before.
- A "from now" member's own note started before they joined and moved into the shared space later: it is on their iPhone already, so it stays and is shared from there, but other "from now" members drop it by its start time.
- Clock skew: `started_at` is the creating iPhone's clock and `history_from` the inviter's (capped at the server's time). A note started within a few minutes of the invite may land on either side.
