# Wave 3 cards: groups, sync, blobs and shared links

PR 27, 28, 29 and 30, and an outline of V1 (the shared-link web viewer). Written 19 Nov 2026 against `main` at `57d1577` (S3 merged; S1A, S1B, S1C, S1E, S4, PR 31, 32 and 33 in place; S1D and S2 not yet). Every code block marked "exactly" was built in a scratch copy of the repo with the other blocks of these cards: `npm run typecheck`, `npm test` (every workspace) and `npm run bundle -w @waypoint/api` passed. The group room's WebSocket code, the rate limit binding and a streamed R2 upload were also run in `wrangler dev` (see "What was checked during planning").

## Rules for these cards

The wave 2 rules (top of "## Wave 2" in `docs/build-plan.md`), the wave 3 notes and "Conventions for the cards still to write" still apply: files only where the card says, no `node:` imports in `apps/api/src`, tests through `app.request` with hand-made `env` objects, no Miniflare, no network, Durable Object classes stay thin and tests never import `cloudflare:workers`, run `npm run bundle -w @waypoint/api` and paste its last lines.

Route tests build a fresh app and sign requests with the S1A helpers, as in `docs/cards/security.md`:

```ts
const NOW = 1_763_560_000_000;
const app = new Hono<AppEnv>();
app.onError(handleError);
app.use(async (c, next) => {
  c.set("user", user);
  await next();
});
app.route("/", theRouteUnderTest({ now: () => NOW }));
// signed:   app.request(path, await signedInit(device, { method, path, body, now: NOW }), env)
// unsigned: app.request(path, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": "k".repeat(20) }, body }, env)
```

Users, groups and memberships are inserted with plain SQL; devices with `insertDevice` from `test/helpers/signing.ts`. Group ids in tests must be 16 to 48 characters (for example `group_aaaaaaaaaaaa`).

On top of that:

- **No new dependencies.** Everything uses Hono, zod, `@waypoint/contracts`, `@waypoint/crypto`, WebCrypto and the Workers bindings already in `apps/api`.
- **Never log** tokens, passcodes, locked bytes, link data or request bodies. These cards add no `console` calls.
- **Shared files.** These cards add lines to `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/wrangler.jsonc` (PR 30's `ratelimits` block; V1's `assets` block), `apps/api/src/index.ts` (PR 27 Part B's `runScheduled`), `apps/api/src/auth/session.ts` (PR 30), `packages/contracts/src/index.ts`, `db/d1/test/schema.test.mjs` and `apps/api/test/scheduled.test.ts` (PR 27 Part B adds a test; the `cloudflare:workers` mock line belongs to PR 22B, which adds `WorkflowEntrypoint`; keep whichever mock line has more). Add only your own lines; "Shared files" in `docs/build-plan.md` lists what every card adds.
- **Migrations.** `0007_groups.sql` (PR 27), `0008_blobs.sql` (PR 29), `0009_links.sql` (PR 30), fixed in the "Shared files" table of `docs/build-plan.md`: PR 20's `0006_jobs.sql` comes first in the build order. Each file only adds columns or a table, so none depends on 0006; if a groups card is ready before PR 20 merges, it still uses its number and waits for PR 20 to merge first.
- **Where an exact code block and the prose disagree, the code block wins.** Copy it as it is, including comments.

## Decisions these cards make

1. **The device picks group, blob and link ids.** Each id is part of the AAD of what is locked under it (`docs/security.md` section 11: `context("group-name", group id)`, `context("blob", group id, blob id)`, `context("link", link id)`), so the device must know it before it encrypts. Group ids are 16 to 48 characters of `[A-Za-z0-9_-]` (a UUID fits; 48 is the longest a push message's `ref` takes), blob ids 16 to 64, link ids 22 to 64 (22 is 16 random bytes). A taken id is 409.
2. **Roles.** `owner`: invites and removes members, revokes anyone's link, and everything an editor does. `editor`: writes changes, uploads media, makes shared links. `viewer`: reads only (changes, the socket, media). Any member can leave. A group always keeps an owner: the last owner cannot leave or be removed (409 "a group needs an owner"), which also means the last member cannot leave; deleting a group is not built (open question). A `personal` group has no invites.
3. **`history_from` is a time (Unix ms).** The invite says from when the new member may read: 0 is the whole history; the app's default "Everything from now on" sends its clock's now, and the server lowers any later value to its own now. The server enforces it on reads: `GET /v1/groups/:id/changes` returns only changes written at or after it and `GET /v1/blobs/:id` only files uploaded at or after it. It is not enforced cryptographically: the inviter's device decides which key versions it wraps for the new member (`docs/security.md` section 10, [R12]).
4. **Invite tokens.** The inviter's device makes the token (32 random bytes, base64url, 43 characters) and sends only its SHA-256 (lowercase hex of the token's UTF-8 text). The server never sees the token until someone accepts, and the reply that the idempotency store keeps for 24 hours holds no secret. An invite is used once, by whoever accepts it first, within 7 days. The token reaches the invitee outside Waypoint (the app shares a link; its format is the share bundle's, M29).
5. **Ending a membership.** Removal by an owner, leaving, and the end date of a time-limited membership all do the same thing in one D1 batch: set `left_at`, bump the key version with exactly `UPDATE groups SET key_version = key_version + 1 WHERE id = ?` (`docs/cards/security.md`, "PR 27 bumps a group's key version with exactly"), and withdraw the open invites that member made. A time-limited membership comes from an invite with `ends_at` ("Until a date" on I3; not for owners). Every membership check already refuses it from `ends_at` on; the hourly cron then ends it with `left_at = ends_at` and the bump. A start date in the future ("Set dates") is not built.
6. **Family Sharing covers history, not reprocessing** (board U9). A Family Sharing "Own it" gives `plan = 'own'` (PR 17) and therefore media sync and its own 3 GB, so the family member keeps their notes, audio and photos in sync. It gives no credits: being in a group never shares a wallet, and a cloud task on a shared note is paid from the wallet of the person who asks.
7. **Writes go over HTTP; the socket only announces.** A device sends a change with `POST /v1/groups/:id/changes`. The socket `GET /v1/groups/:id/sync` carries no content in either direction: the room sends `{ "type": "changed", "last_seq": n }`, the app then calls `GET /v1/groups/:id/changes?after=`, and the app may send `{ "type": "ack", "seq": n }`. So every read and write goes through one path that checks the session, the membership, the role, the device and the key version, and the idempotency store protects retries. This changes flow 4 in `docs/architecture.md` (edited in this planning pull request).
8. **Pushes.** After a change, every approved device of an active member (not the writer's device) that has no open socket gets `{ kind: "sync", ref: <group id>, device_id }` on `PUSH_QUEUE` (PR 31: a silent background push), at most once a minute per device per group. PR 28 sends them with `sendBatch` (up to 100 a call) rather than PR 20's one-message `sendPush`; PR 31's consumer drops any message outside `PushMessageSchema` (a `device_id` shorter than 8 characters). The app makes device and group ids as UUIDs (36 characters), which fit.
9. **No device signature on changes or media.** They do not change keys, devices, membership or money (`docs/security.md` section 7), and nobody without a group key can make a change other members accept. The change's `device_id` must still be an approved, not removed device of the signed-in user.
10. **Media goes through the Worker, not a signed URL.** The R2 binding cannot make presigned URLs; that needs an R2 API token (access key and secret as Worker secrets) and an S3 signing library, and a presigned PUT cannot be limited to a size or checked against the 3 GB cap when it is used. `POST /v1/blobs` instead streams the request body straight into R2 (no buffering, so memory stays small) after checking the plan, the membership and the cap. A file is at most 95,000,000 bytes, under the 100 MB request body limit of a Free or Pro zone. This changes the `POST /v1/blobs` row and flow 4 in `docs/architecture.md` (edited here). No R2 API token is needed for PR 29.
11. **Blob retries use the blob id, not the idempotency store.** The store hashes the whole body, which would mean holding up to 95 MB in memory. Sending the same id, group and size again is the retry: a stored file returns 200, a half-finished one is uploaded again.
12. **The 3 GB cap** is per person: the sum of `bytes` of every file they uploaded (in any group, finished or still uploading) must stay at or under `max(media_cap_gb)` of their open entitlements (default 3) × 1,073,741,824. The size is reserved in the same SQL statement that checks the cap, so two uploads at once cannot both pass. Free users cannot upload media (403 `plan_required`); any active member can download, whoever paid for the upload (open question).
13. **Shared links.** `POST /v1/links` carries the locked link data (key version 0, at most 4 MiB) as base64url in JSON, with an optional passcode the server stores only as `linkPasscodeHash` (HMAC with `LINK_PASSCODE_PEPPER`). `GET /v1/links/:id/data` is public (the viewer has no session): it is rate limited per link, and a passcode link also needs `Waypoint-Link-Passcode` and a Turnstile token in `Waypoint-Turnstile`, with attempts rate limited per link and IP address. Revoked, expired and unknown links are 404 with the messages "link revoked", "link expired" and "no such link", so the viewer can draw each state.
14. **The viewer is served by the API Worker** (V1: Workers static assets on the same Worker, the API paths running the Worker first). Same origin, so `GET /v1/links/:id/data` needs no CORS and the Turnstile widget's hostname is the API host.

## What was checked during planning

- **Durable Object WebSockets with hibernation**, in `wrangler dev` (wrangler 4.164.0, compatibility date 2026-11-01) with the `object.ts` and `sockets.ts` below and a throwaway Worker that forwarded the upgrade exactly as `GET /v1/groups/:id/sync` does (`room.fetch("https://group-room/sync", { headers })` returned from a Hono handler): 101 Switching Protocols; `ctx.acceptWebSocket(server, tags)`, `ctx.getWebSockets(tag)`, `ctx.getTags(ws)`; the `ping`/`pong` auto-response answered without waking the room; a second socket for the same device closed the first with 4000; `disconnect(user)` and a passed `until` tag closed sockets with 4003; the writer's own socket got no notice; an append returned the offline device to push, and a second append within a minute returned none; a message that is not an ack closed the socket with 1003; `after()` returned the locked bytes as an `ArrayBuffer` through RPC. Typing: `DurableObjectState` satisfies `SocketHost` and the `override` modifiers are needed (`noImplicitOverride`). Limits from Cloudflare's docs: at most 10 tags per socket, 256 characters each; 32,768 hibernating sockets per object; the auto-response pair is at most 2,048 characters.
- **One quirk to check on staging:** in `wrangler dev`, after the room closed a socket from an RPC call (`disconnect`, or the `until` check), the room's `webSocketClose` ran but the Node client stayed in `CLOSING`; a close made while handling that socket's own message finished normally. The room sends nothing more on a closed socket either way, and `GET /changes` refuses an ended membership, so nothing leaks; the app should treat a received close frame as final.
- **Rate limit binding** (`ratelimits` in `wrangler.jsonc`, wrangler 4.36.0 or later): `limit({ key })` returned `success: false` after the configured count in `wrangler dev`; `period` is 10 or 60 seconds; counts are per Cloudflare location and approximate (Cloudflare's docs). `RateLimit` is in `@cloudflare/workers-types` 5.20261118.1.
- **R2 streaming put** in `wrangler dev`: a 5,000,000-byte request body with `Content-Length` was stored and read back byte for byte; the same body sent chunked (no `Content-Length`) made `put` throw `TypeError: Provided readable stream must have a known length`. Hence the `Content-Length` check in PR 29. `R2Bucket` satisfies the small `BlobBucket` and `LinkBucket` types.
- **Turnstile siteverify** (`POST https://challenges.cloudflare.com/turnstile/v0/siteverify`, JSON body `{ secret, response, remoteip }`): called once with Cloudflare's dummy secret `1x0000000000000000000000000000000AA` and token `XXXX.DUMMY.TOKEN.XXXX` → `{"success":true, ...}`; with `2x0000000000000000000000000000000AA` → `{"success":false,"error-codes":["invalid-input-response"], ...}`. Tokens last 300 seconds, are single use, and are at most 2,048 characters. Tests stub `fetch`; no test calls Cloudflare.
- **The accept upsert** (`INSERT INTO memberships ... SELECT ... FROM invites WHERE ... ON CONFLICT (group_id, user_id) DO UPDATE ... WHERE ...`) and the cap reservation (`INSERT ... SELECT ... WHERE (SELECT SUM ...) ... ON CONFLICT (id) DO NOTHING`) run on `node:sqlite` in the test D1; D1 is SQLite.

---

## PR 27 · Groups, invites and membership

Branch `pr/27-groups`. Builds on S1A (signatures); does not need S1D or S2. No new dependencies. Two sittings on the same branch: Part A (creating groups, listing, invites, accepting), commit and push, then Part B (ending memberships).

What it adds: `POST /v1/groups`, `GET /v1/groups`, `POST /v1/groups/:id/invites`, `POST /v1/invites/:token/accept`, `DELETE /v1/groups/:id/members/:user`, and the hourly end of time-limited memberships. Read "Decisions these cards make" 1 to 6 first. The four writes are signed (`requireDeviceSignature`, then `idempotent`). This card never creates key envelopes: the creator's device posts the first set for version 1 with S2's `POST /v1/groups/:id/keys`, and after a removal a remaining device posts the set for the new version.

### Part A: groups, invites, accepting

Files: `db/d1/migrations/0007_groups.sql`, `db/d1/test/schema.test.mjs`, `packages/contracts/src/groups.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/groups.test.ts`, `apps/api/src/groups/membership.ts`, `apps/api/src/groups/routes.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/groups.test.ts`. No other files.

`db/d1/migrations/0007_groups.sql`, exactly:

```sql
-- Groups, invites and membership (PR 27). Ids, roles and times only: the group's name stays locked
-- (groups.name_locked) and an invite is stored only as the SHA-256 of its token.

-- Who made the invite (an owner), what the new member may read and until when.
ALTER TABLE invites ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE CASCADE;
-- Unix ms. The new member reads changes from this time on; 0 means the whole history.
ALTER TABLE invites ADD COLUMN history_from INTEGER NOT NULL DEFAULT 0;
-- Unix ms. The membership ends then (the hourly cron ends it and bumps the key version); NULL means no end.
ALTER TABLE invites ADD COLUMN ends_at INTEGER;

-- The hourly cron looks for memberships whose end date has passed.
CREATE INDEX memberships_ends_at ON memberships (ends_at) WHERE ends_at IS NOT NULL AND left_at IS NULL;
```

`db/d1/test/schema.test.mjs`: keep every test; change only this:
- `EXPECTED.invites` becomes `["token_hash", "group_id", "role", "expires_at", "accepted_by", "created_by", "history_from", "ends_at"]`; `EXPECTED_TYPES.invites` gains `created_by: "TEXT?"`, `history_from: "INTEGER"`, `ends_at: "INTEGER?"`.
- `REQUIRED_INDEXES` gains `["memberships", ["ends_at"]]`.
- New tests: an invite inserted without `history_from` reads back 0; deleting the user in `invites.created_by` deletes that invite; an invite whose `created_by` is a missing user is rejected (`FOREIGN KEY constraint failed`).

`packages/contracts/src/groups.ts`, exactly, and `export * from "./groups.ts";` at the end of `packages/contracts/src/index.ts`:

```ts
import { z } from "zod";

// PR 27: groups, invites and membership. Ids chosen by the device are random (a UUID is fine); a group id is at most
// 48 characters so it fits a push message's ref.
export const GroupIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,48}$/);
export const UserIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const GroupRoleSchema = z.enum(["owner", "editor", "viewer"]);
export const GroupKindSchema = z.enum(["personal", "shared"]);
// The group's name locked with the group key (docs/security.md, section 11), base64url. The server never reads it.
export const LockedNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/);
// What the invitee gets: 32 random bytes, base64url. The server only ever stores its SHA-256 (lowercase hex).
export const InviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const TokenHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const Millis = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const CreateGroupRequestSchema = z.strictObject({ id: GroupIdSchema, kind: GroupKindSchema, name_locked: LockedNameSchema });

export const MemberViewSchema = z.strictObject({
  user_id: UserIdSchema,
  role: GroupRoleSchema,
  starts_at: Millis,
  ends_at: Millis.nullable(),
  history_from: Millis,
});

export const GroupViewSchema = z.strictObject({
  id: GroupIdSchema,
  kind: GroupKindSchema,
  name_locked: LockedNameSchema,
  key_version: z.number().int().min(1),
  created_by: UserIdSchema.nullable(),
  role: GroupRoleSchema,
  members: z.array(MemberViewSchema),
});
export type GroupView = z.infer<typeof GroupViewSchema>;

export const GroupListSchema = z.strictObject({ groups: z.array(GroupViewSchema) });

export const CreateInviteRequestSchema = z.strictObject({
  token_hash: TokenHashSchema,
  role: GroupRoleSchema,
  history_from: Millis,
  ends_at: Millis.nullable(),
});

export const InviteViewSchema = z.strictObject({
  group_id: GroupIdSchema,
  role: GroupRoleSchema,
  history_from: Millis,
  ends_at: Millis.nullable(),
  expires_at: Millis,
});

export const MembershipEndedSchema = z.strictObject({
  group_id: GroupIdSchema,
  user_id: UserIdSchema,
  key_version: z.number().int().min(1),
});
```

`apps/api/src/groups/membership.ts`, exactly:

```ts
import type { GroupView } from "@waypoint/contracts";
import type { Db } from "../storage.ts";

export type Role = "owner" | "editor" | "viewer";

// A membership counts from the moment it is accepted until it is ended (left_at) or its end date passes.
// The hourly cron (PR 27 Part B) sets left_at for passed end dates and bumps the key version; until it runs,
// this check already refuses the member.
export type Membership = { kind: "personal" | "shared"; key_version: number; role: Role; history_from: number; ends_at: number | null };

export async function activeMembership(db: Db, groupId: string, userId: string, now: number): Promise<Membership | null> {
  return db
    .prepare(
      `SELECT g.kind, g.key_version, m.role, m.history_from, m.ends_at
       FROM groups g JOIN memberships m ON m.group_id = g.id
       WHERE g.id = ? AND m.user_id = ? AND m.left_at IS NULL AND (m.ends_at IS NULL OR m.ends_at > ?)`,
    )
    .bind(groupId, userId, now)
    .first<Membership>();
}

type GroupRow = { id: string; kind: "personal" | "shared"; name_locked: string; key_version: number; created_by: string | null; role: Role };
type MemberRow = { group_id: string; user_id: string; role: Role; starts_at: number; ends_at: number | null; history_from: number };

const ACTIVE = "m.left_at IS NULL AND (m.ends_at IS NULL OR m.ends_at > ?)";

// The groups userId is an active member of, each with its active members, in id order. With groupId, only that group.
export async function groupViews(db: Db, userId: string, now: number, groupId: string | null = null): Promise<GroupView[]> {
  const only = groupId === null ? "" : " AND g.id = ?";
  const values: unknown[] = groupId === null ? [userId, now] : [userId, now, groupId];
  const groups = (
    await db
      .prepare(
        `SELECT g.id, g.kind, g.name_locked, g.key_version, g.created_by, m.role
         FROM groups g JOIN memberships m ON m.group_id = g.id
         WHERE m.user_id = ? AND ${ACTIVE}${only} ORDER BY g.id`,
      )
      .bind(...values)
      .all<GroupRow>()
  ).results;
  if (groups.length === 0) return [];
  const members = (
    await db
      .prepare(
        `SELECT m.group_id, m.user_id, m.role, m.starts_at, m.ends_at, m.history_from
         FROM memberships m
         WHERE ${ACTIVE} AND m.group_id IN (SELECT m2.group_id FROM memberships m2 WHERE m2.user_id = ? AND m2.left_at IS NULL)
         ORDER BY m.group_id, m.starts_at, m.user_id`,
      )
      .bind(now, userId)
      .all<MemberRow>()
  ).results;
  return groups.map((g) => ({
    ...g,
    members: members
      .filter((m) => m.group_id === g.id)
      .map(({ user_id, role, starts_at, ends_at, history_from }) => ({ user_id, role, starts_at, ends_at, history_from })),
  }));
}
```

`apps/api/src/groups/routes.ts`, exactly:

```ts
import { CreateGroupRequestSchema, CreateInviteRequestSchema, InviteTokenSchema } from "@waypoint/contracts";
import { sha256, toHex, utf8 } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { isUniqueViolation } from "../keys/envelopes.ts";
import { activeMembership, groupViews } from "./membership.ts";

export const MAX_GROUPS_PER_USER = 100;
export const MAX_MEMBERS = 50;
export const MAX_OPEN_INVITES = 20;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => {
    throw new ApiFailure("bad_request", "invalid request");
  });
}

async function countGroups(db: AppEnv["Bindings"]["DB"], userId: string): Promise<number> {
  const row = await db.prepare("SELECT count(*) AS n FROM memberships WHERE user_id = ? AND left_at IS NULL").bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

export function groupRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .post("/v1/groups", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const parsed = CreateGroupRequestSchema.safeParse(await readJson(c));
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      const db = c.env.DB;
      const user = c.get("user");
      const now = deps.now();
      if ((await countGroups(db, user.id)) >= MAX_GROUPS_PER_USER) throw new ApiFailure("conflict", "too many groups");
      try {
        await db.batch([
          db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES (?, ?, ?, 1, ?)").bind(req.id, req.kind, req.name_locked, user.id),
          db
            .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, ends_at, history_from, left_at) VALUES (?, ?, 'owner', ?, NULL, 0, NULL)")
            .bind(req.id, user.id, now),
        ]);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "group id taken");
        throw error;
      }
      const [view] = await groupViews(db, user.id, now, req.id);
      return c.json(view, 201);
    })
    .get("/v1/groups", async (c) => {
      return c.json({ groups: await groupViews(c.env.DB, c.get("user").id, deps.now()) });
    })
    .post("/v1/groups/:id/invites", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const parsed = CreateInviteRequestSchema.safeParse(await readJson(c));
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const groupId = c.req.param("id");
      const membership = await activeMembership(db, groupId, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      if (membership.role !== "owner") throw new ApiFailure("forbidden", "only an owner can invite");
      if (membership.kind === "personal") throw new ApiFailure("conflict", "personal groups have no invites");
      if (req.ends_at !== null && (req.role === "owner" || req.ends_at <= now)) throw new ApiFailure("bad_request", "invalid request");
      const open = await db
        .prepare("SELECT count(*) AS n FROM invites WHERE group_id = ? AND accepted_by IS NULL AND expires_at > ?")
        .bind(groupId, now)
        .first<{ n: number }>();
      if ((open?.n ?? 0) >= MAX_OPEN_INVITES) throw new ApiFailure("conflict", "too many open invites");
      const historyFrom = Math.min(req.history_from, now);
      const expiresAt = now + INVITE_TTL_MS;
      try {
        await db
          .prepare("INSERT INTO invites (token_hash, group_id, role, expires_at, accepted_by, created_by, history_from, ends_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)")
          .bind(req.token_hash, groupId, req.role, expiresAt, user.id, historyFrom, req.ends_at)
          .run();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "invite token taken");
        throw error;
      }
      return c.json({ group_id: groupId, role: req.role, history_from: historyFrom, ends_at: req.ends_at, expires_at: expiresAt }, 201);
    })
    .post("/v1/invites/:token/accept", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const token = InviteTokenSchema.safeParse(c.req.param("token"));
      if (!token.success) throw new ApiFailure("not_found", "no such invite");
      const tokenHash = toHex(await sha256(utf8(token.data)));
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const invite = await db
        .prepare(
          `SELECT i.group_id FROM invites i JOIN groups g ON g.id = i.group_id
           WHERE i.token_hash = ? AND i.accepted_by IS NULL AND i.expires_at > ? AND (i.ends_at IS NULL OR i.ends_at > ?) AND g.kind = 'shared'`,
        )
        .bind(tokenHash, now, now)
        .first<{ group_id: string }>();
      if (invite === null) throw new ApiFailure("not_found", "no such invite");
      if ((await activeMembership(db, invite.group_id, user.id, now)) !== null) throw new ApiFailure("conflict", "already a member");
      const members = await db
        .prepare("SELECT count(*) AS n FROM memberships WHERE group_id = ? AND left_at IS NULL")
        .bind(invite.group_id)
        .first<{ n: number }>();
      if ((members?.n ?? 0) >= MAX_MEMBERS) throw new ApiFailure("conflict", "group is full");
      if ((await countGroups(db, user.id)) >= MAX_GROUPS_PER_USER) throw new ApiFailure("conflict", "too many groups");
      // One batch: the membership is written only while the invite is still open, then the invite is used up. A user
      // who was a member before gets their old row back with the invite's terms.
      await db.batch([
        db
          .prepare(
            `INSERT INTO memberships (group_id, user_id, role, starts_at, ends_at, history_from, left_at)
             SELECT group_id, ?, role, ?, ends_at, history_from, NULL FROM invites
             WHERE token_hash = ? AND accepted_by IS NULL AND expires_at > ?
             ON CONFLICT (group_id, user_id) DO UPDATE SET role = excluded.role, starts_at = excluded.starts_at,
               ends_at = excluded.ends_at, history_from = excluded.history_from, left_at = NULL
             WHERE memberships.left_at IS NOT NULL OR memberships.ends_at <= ?`,
          )
          .bind(user.id, now, tokenHash, now, now),
        db.prepare("UPDATE invites SET accepted_by = ? WHERE token_hash = ? AND accepted_by IS NULL AND expires_at > ?").bind(user.id, tokenHash, now),
      ]);
      const used = await db.prepare("SELECT accepted_by FROM invites WHERE token_hash = ?").bind(tokenHash).first<{ accepted_by: string | null }>();
      if (used?.accepted_by !== user.id) throw new ApiFailure("not_found", "no such invite");
      const [view] = await groupViews(db, user.id, now, invite.group_id);
      if (view === undefined) throw new ApiFailure("not_found", "no such invite");
      return c.json(view);
    });
}
```

What the routes do, in short:
- `POST /v1/groups` (signed): one batch makes the group (`key_version` 1, `created_by` the caller) and the caller's `owner` membership (`starts_at` now, `history_from` 0). 201 with the group's `GroupView`. A taken id → 409 "group id taken"; 100 current memberships already → 409 "too many groups".
- `GET /v1/groups`: the caller's active groups with their active members.
- `POST /v1/groups/:id/invites` (signed, owners of shared groups only): stores the hash, role, `history_from` (lowered to now), `ends_at`, `created_by`, and `expires_at` = now + 7 days. 201 with an `InviteView`. At most 20 open invites per group.
- `POST /v1/invites/:token/accept` (signed): the token is hashed; an open, unexpired invite of a shared group makes (or, for a former member, renews) the membership with the invite's role, `history_from` and `ends_at`, and `starts_at` = now; the same batch marks the invite used. 200 with the `GroupView`. At most 50 members per group.

`apps/api/src/app.ts`: `import { groupRoutes } from "./groups/routes.ts";` and `app.route("/", groupRoutes({ now: deps.now }));` at the end of the route list.

Tests (`packages/contracts/test/groups.test.ts`), one bullet one test:
- `GroupIdSchema` accepts a UUID (36 characters) and a 48-character id; rejects 15 and 49 characters and one with `.`.
- `InviteTokenSchema` accepts 43 characters and rejects 42 and 44; `TokenHashSchema` rejects upper-case hex.
- `CreateGroupRequestSchema` rejects `kind: "team"`, a `name_locked` with `+`, and an extra key.
- `CreateInviteRequestSchema` rejects role `"admin"`, a negative `history_from`, and a missing `ends_at` (it must be present, `null` for no end).

Tests (`apps/api/test/groups.test.ts`). Fixture: users `u1`, `u2`, `u3`, each with one approved device (`dev_u1`, `dev_u2`, `dev_u3`); a token `"T".repeat(43)` and its hash `toHex(await sha256(utf8(token)))` (from `@waypoint/crypto`). One bullet one test:
- `POST /v1/groups` → 201; the body passes `GroupViewSchema` with `key_version` 1, `role` `"owner"`, one member (`u1`, `starts_at` NOW, `ends_at` null, `history_from` 0); the `groups` row has `created_by` `u1`.
- `kind: "personal"` → 201.
- The same id again (another Idempotency-Key) → 409 "group id taken"; still one `groups` row.
- The same request with the same Idempotency-Key → the first reply again, `Idempotent-Replayed: true`, one `groups` row.
- A bad body (15-character id, or an extra key) → 400; nothing written.
- With 100 current memberships already (insert them by SQL) → 409 "too many groups".
- Without a signature → 401.
- `GET /v1/groups` with no groups → `{ "groups": [] }`.
- `GET /v1/groups` lists the caller's groups in id order with their active members; passes `GroupListSchema`; a group the caller left (`left_at` set) and one whose `ends_at` is NOW are not listed; a member who left, or whose `ends_at` is NOW, is not in `members`.
- Invite by the owner → 201 `{ group_id, role: "viewer", history_from, ends_at: null, expires_at: NOW + 604800000 }`; the row has the hash, `created_by` `u1` and `accepted_by` null.
- Invite with `history_from` NOW + 5000 → stored and returned as NOW; with 0 → 0.
- Invite by an editor → 403; by a non-member → 404; on a personal group → 409 "personal groups have no invites".
- Invite with `ends_at` at or before NOW → 400; with `role: "owner"` and an `ends_at` → 400; with `role: "editor"` and `ends_at` NOW + 1000 → 201.
- With 20 open invites (insert by SQL; expired and accepted ones do not count) → 409 "too many open invites".
- The same `token_hash` twice (different Idempotency-Keys) → 409 "invite token taken".
- Invite without a signature → 401.
- Accept by `u2` → 200, passes `GroupViewSchema` with two members; `u2`'s row has the invite's role, `history_from` and `ends_at`, `starts_at` NOW, `left_at` null; the invite's `accepted_by` is `u2`.
- Accept again by `u3` → 404 "no such invite"; `u3` has no membership.
- An invite whose `expires_at` is NOW → 404; an unknown token → 404; a 42-character token → 404; an invite of a personal group (inserted by SQL) → 404; an invite whose `ends_at` is NOW → 404.
- `u2` already an active member → 409 "already a member", and the invite stays unused.
- A group with 50 current members → 409 "group is full".
- A former member (`left_at` set, role editor) accepts a viewer invite → 200; the same row now has role viewer, `left_at` null, the invite's `history_from`.
- A member whose `ends_at` has passed but whose `left_at` is still null (the cron has not run) accepts a new invite → 200 and the row has the new terms.
- Accept without a signature → 401.
- No column of `invites` holds the token itself (check every column of every row).
- `activeMembership`: a membership with `ends_at` = now gives null; with `ends_at` = now + 1 gives the row; a left one gives null.

Not in this PR: ending memberships (Part B), key envelopes (S2), changing a member's role, deleting a group, listing a group's open invites, invite links and push notices for invites (app, M29).

### Part B: ending memberships

Files: `apps/api/src/groups/members.ts`, `apps/api/src/groups/expiry.ts`, `apps/api/src/index.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/members.test.ts`, `apps/api/test/scheduled.test.ts` (one new test). No other files.

`apps/api/src/groups/members.ts`, exactly:

```ts
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import type { BatchDb, DbStatement } from "../storage.ts";
import { activeMembership } from "./membership.ts";

// docs/cards/security.md: PR 27 bumps a group's key version with exactly this, in the same batch that ends a membership.
export const BUMP_GROUP_SQL = "UPDATE groups SET key_version = key_version + 1 WHERE id = ?";

// The statements that end userId's membership at `at`: the row gets left_at, the group a new key version, and open
// invites the user made are withdrawn. Run them in one db.batch.
export function endMembershipStatements(db: BatchDb, groupId: string, userId: string, at: number): DbStatement[] {
  return [
    db.prepare("UPDATE memberships SET left_at = ? WHERE group_id = ? AND user_id = ? AND left_at IS NULL").bind(at, groupId, userId),
    db.prepare(BUMP_GROUP_SQL).bind(groupId),
    db.prepare("DELETE FROM invites WHERE group_id = ? AND created_by = ? AND accepted_by IS NULL").bind(groupId, userId),
  ];
}

export function memberRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>().delete("/v1/groups/:id/members/:user", requireDeviceSignature(deps), idempotent(deps), async (c) => {
    const db: BatchDb = c.env.DB;
    const now = deps.now();
    const caller = c.get("user");
    const groupId = c.req.param("id");
    const targetId = c.req.param("user");
    const mine = await activeMembership(db, groupId, caller.id, now);
    if (mine === null) throw new ApiFailure("not_found", "no such group");
    if (targetId !== caller.id && mine.role !== "owner") throw new ApiFailure("forbidden", "only an owner can remove members");
    const target = targetId === caller.id ? mine : await activeMembership(db, groupId, targetId, now);
    if (target === null) throw new ApiFailure("not_found", "no such member");
    if (target.role === "owner") {
      const owners = await db
        .prepare("SELECT count(*) AS n FROM memberships WHERE group_id = ? AND role = 'owner' AND left_at IS NULL AND (ends_at IS NULL OR ends_at > ?)")
        .bind(groupId, now)
        .first<{ n: number }>();
      if ((owners?.n ?? 0) <= 1) throw new ApiFailure("conflict", "a group needs an owner");
    }
    await db.batch(endMembershipStatements(db, groupId, targetId, now));
    const group = await db.prepare("SELECT key_version FROM groups WHERE id = ?").bind(groupId).first<{ key_version: number }>();
    if (group === null) throw new ApiFailure("not_found", "no such group");
    return c.json({ group_id: groupId, user_id: targetId, key_version: group.key_version });
  });
}
```

`apps/api/src/groups/expiry.ts`, exactly:

```ts
import type { BatchDb } from "../storage.ts";
import { endMembershipStatements } from "./members.ts";

// At most this many memberships are ended per hourly run; the rest wait for the next run.
export const MAX_EXPIRED_PER_RUN = 500;

// Ends memberships whose end date has passed (an invite "until a date"): left_at = ends_at and a new key version,
// one batch per membership, as a removal does. Returns how many were ended.
export async function endExpiredMemberships(db: BatchDb, now: number): Promise<number> {
  const { results } = await db
    .prepare("SELECT group_id, user_id, ends_at FROM memberships WHERE left_at IS NULL AND ends_at IS NOT NULL AND ends_at <= ? ORDER BY ends_at LIMIT ?")
    .bind(now, MAX_EXPIRED_PER_RUN)
    .all<{ group_id: string; user_id: string; ends_at: number }>();
  for (const row of results) {
    await db.batch(endMembershipStatements(db, row.group_id, row.user_id, row.ends_at));
  }
  return results.length;
}
```

`apps/api/src/index.ts`: add `import { endExpiredMemberships } from "./groups/expiry.ts";` and `import type { BatchDb } from "./storage.ts";`, and change `runScheduled` to exactly:

```ts
// Every job runs even if another fails; a failure is rethrown afterwards so it still shows in the logs.
export async function runScheduled(env: CleanupEnv & { DB: BatchDb }, walletFor: (billingAccountId: string) => WalletCommands, now: number): Promise<void> {
  const results = await Promise.allSettled([cleanup(env, now), topUpYearlyPlus(env.DB, walletFor, now), endExpiredMemberships(env.DB, now)]);
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
}
```

`apps/api/src/app.ts`: `import { memberRoutes } from "./groups/members.ts";` and `app.route("/", memberRoutes({ now: deps.now }));`.

Tests (`apps/api/test/members.test.ts`). Fixture: group `g1` (`key_version` 1) with `u1` owner, `u2` editor, `u3` viewer; group `g2` with `u2` owner (to check nothing else changes); an approved device per user. One bullet one test:
- `u1` removes `u2` → 200 `{ group_id: "g1", user_id: "u2", key_version: 2 }`, passes `MembershipEndedSchema`; `u2`'s row has `left_at` NOW; `g1.key_version` is 2; `g2.key_version` is still 1.
- `u2` leaves (`DELETE /v1/groups/g1/members/u2` signed by `u2`) → 200 and the bump.
- `u2` (editor) removes `u3` → 403 "only an owner can remove members"; nothing changes.
- A non-member caller → 404 "no such group"; an unknown target → 404 "no such member"; a target who already left → 404.
- `u1`, the only owner, leaves → 409 "a group needs an owner"; key version unchanged.
- `u1` removes another owner when two owners exist → 200; then the last owner leaving → 409.
- A group with only `u1` (owner): leaving → 409.
- Ending `u1`'s membership as the second owner withdraws the open invites `u1` made in that group, and keeps accepted ones, other members' ones and `u1`'s invites in another group.
- After removal, `u2`'s `GET /v1/groups` (Part A's route, mounted in the same test app) no longer lists `g1`.
- The same request with the same Idempotency-Key → the stored reply; the key version was bumped once.
- Without a signature → 401.
- `endExpiredMemberships`: a membership with `ends_at` NOW − 1 → ended with `left_at` = its `ends_at`, group bumped, returns 1; `ends_at` NOW → ended; `ends_at` NOW + 1, `ends_at` null, and an already-left row → untouched, returns 0.
- `endExpiredMemberships` with `MAX_EXPIRED_PER_RUN + 1` expired memberships → ends exactly `MAX_EXPIRED_PER_RUN`, the earliest `ends_at` first.

`apps/api/test/scheduled.test.ts` (add one test, change nothing else): with an expired membership in the test D1 and a bucket whose `list` throws, `runScheduled` rejects with the bucket's error and the membership has been ended.

Not in this PR: closing the removed member's sockets (PR 28 Part B adds it to `members.ts`), making the new key (the remaining devices, S2), revoking the removed member's shared links (open question), Clerk session changes.

---
## PR 28 · Sync: changes, the group socket and sync pushes

Branch `pr/28-sync`. No new dependencies. Two sittings on the same branch: Part A (the room: store, sockets, Durable Object), commit and push, then Part B (the HTTP endpoints). Part A builds only on PR 10 (merged) and can start any time; Part B needs PR 27 merged (it uses `activeMembership` and edits `members.ts`), and should merge after S2 so devices can get group keys.

How it works (decisions 7 and 8): a device sends a locked change with `POST /v1/groups/:id/changes`; the Worker checks membership, role, device and key version, then calls the group's room (`env.GROUP_ROOM`, one Durable Object per group id) to append it. The room gives it the next `seq`, tells every open socket except the writer device's `{ "type": "changed", "last_seq": n }`, and returns the devices that have no socket and were not pushed in the last minute; the Worker queues a silent `sync` push for each. A device reads with `GET /v1/groups/:id/changes?after=<seq>`. The room never reads inside `locked_bytes`.

### Part A: the room

Files: `apps/api/src/room/store.ts` (replace the whole file), `apps/api/src/room/sockets.ts` (new), `apps/api/src/room/object.ts` (replace the whole file), `apps/api/test/helpers/room.ts` (new), `apps/api/test/room-store.test.ts` (new tests only), `apps/api/test/room-sockets.test.ts` (new). No other files.

`apps/api/src/room/store.ts`, exactly. Compared with PR 10 it adds `after`'s options, `lastSeq`, the `pushes` table and `duePushes`; everything else is unchanged, so the existing tests still pass:

```ts
import type { SqlStore } from "../storage.ts";

export type NewChange = {
  device_id: string;
  key_version: number;
  kind: string;
  locked_bytes: ArrayBuffer;
  blob_key: string | null;
};

export type Change = NewChange & { seq: number; at: number };

const DEVICE_ID = /^[A-Za-z0-9_:-]{1,128}$/;
const KIND = /^[a-z_]{1,32}$/;
const MAX_LOCKED_BYTES = 1_048_576;
const MAX_BLOB_KEY = 512;
const MAX_LIMIT = 500;
// A device is pushed at most once a minute per room; a burst of changes needs only one push.
export const PUSH_GAP_MS = 60_000;

export type AfterOptions = {
  // Only changes written at or after this time (the reader's membership history_from). Default 0.
  fromAt?: number;
  // Stop before the locked bytes of the page pass this many; the first change is always returned. Default no limit.
  maxBytes?: number;
};

export function createRoomStore(store: SqlStore): {
  append(change: NewChange, now: number): { seq: number };
  after(seq: number, limit: number, options?: AfterOptions): { changes: Change[]; last_seq: number };
  ack(deviceId: string, seq: number, now: number): void;
  lastSeq(): number;
  duePushes(deviceIds: string[], now: number): string[];
} {
  store.sql.exec(
    `CREATE TABLE IF NOT EXISTS changes (
       seq INTEGER PRIMARY KEY,
       device_id TEXT NOT NULL,
       key_version INTEGER NOT NULL,
       kind TEXT NOT NULL,
       locked_bytes BLOB NOT NULL,
       blob_key TEXT,
       at INTEGER NOT NULL
     )`,
  );
  store.sql.exec(
    `CREATE TABLE IF NOT EXISTS cursors (
       device_id TEXT PRIMARY KEY,
       last_seq INTEGER NOT NULL,
       seen_at INTEGER NOT NULL
     )`,
  );

  store.sql.exec(
    `CREATE TABLE IF NOT EXISTS pushes (
       device_id TEXT PRIMARY KEY,
       pushed_at INTEGER NOT NULL
     )`,
  );

  function lastSeq(): number {
    const [row] = store.sql.exec("SELECT COALESCE(MAX(seq), 0) AS last_seq FROM changes").toArray();
    const value = row?.last_seq;
    if (typeof value !== "number") throw new TypeError("corrupt changes table");
    return value;
  }

  return {
    append(change, now) {
      if (typeof change.device_id !== "string" || !DEVICE_ID.test(change.device_id)) {
        throw new RangeError("device_id is not valid");
      }
      if (!Number.isSafeInteger(change.key_version) || change.key_version < 1) {
        throw new RangeError("key_version must be a safe integer of at least 1");
      }
      if (typeof change.kind !== "string" || !KIND.test(change.kind)) throw new RangeError("kind is not valid");
      if (!(change.locked_bytes instanceof ArrayBuffer)) throw new RangeError("locked_bytes must be an ArrayBuffer");
      if (change.locked_bytes.byteLength < 1 || change.locked_bytes.byteLength > MAX_LOCKED_BYTES) {
        throw new RangeError("locked_bytes must be 1 to 1,048,576 bytes");
      }
      if (change.blob_key !== null && typeof change.blob_key !== "string") {
        throw new RangeError("blob_key must be null or a string");
      }
      if (change.blob_key !== null && (change.blob_key.length < 1 || change.blob_key.length > MAX_BLOB_KEY)) {
        throw new RangeError("blob_key must be null or 1 to 512 characters");
      }

      return store.transactionSync(() => {
        const seq = lastSeq() + 1;
        store.sql.exec(
          "INSERT INTO changes (seq, device_id, key_version, kind, locked_bytes, blob_key, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          seq,
          change.device_id,
          change.key_version,
          change.kind,
          change.locked_bytes,
          change.blob_key,
          now,
        );
        return { seq };
      });
    },

    after(seq, limit, options = {}) {
      if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError("seq must be a safe integer of at least 0");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new RangeError("limit must be 1 to 500");
      }
      const fromAt = options.fromAt ?? 0;
      const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
      if (!Number.isSafeInteger(fromAt) || fromAt < 0) throw new RangeError("fromAt must be a safe integer of at least 0");
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("maxBytes must be a safe integer of at least 1");

      // Sizes first, so a page never loads more locked bytes than maxBytes into memory.
      const sizes = store.sql
        .exec("SELECT seq, length(locked_bytes) AS n FROM changes WHERE seq > ? AND at >= ? ORDER BY seq LIMIT ?", seq, fromAt, limit)
        .toArray();
      let through = seq;
      let total = 0;
      for (const size of sizes) {
        if (typeof size.seq !== "number" || typeof size.n !== "number") throw new TypeError("corrupt changes row");
        if (through !== seq && total + size.n > maxBytes) break;
        total += size.n;
        through = size.seq;
      }
      const rows =
        through === seq
          ? []
          : store.sql
              .exec(
                "SELECT seq, device_id, key_version, kind, locked_bytes, blob_key, at FROM changes WHERE seq > ? AND seq <= ? AND at >= ? ORDER BY seq",
                seq,
                through,
                fromAt,
              )
              .toArray();
      const changes = rows.map((row): Change => {
        const { seq: rowSeq, device_id, key_version, kind, locked_bytes, blob_key, at } = row;
        if (
          typeof rowSeq !== "number" ||
          typeof device_id !== "string" ||
          typeof key_version !== "number" ||
          typeof kind !== "string" ||
          !(locked_bytes instanceof ArrayBuffer) ||
          (blob_key !== null && typeof blob_key !== "string") ||
          typeof at !== "number"
        ) {
          throw new TypeError("corrupt changes row");
        }
        return { seq: rowSeq, device_id, key_version, kind, locked_bytes, blob_key, at };
      });
      return { changes, last_seq: lastSeq() };
    },

    ack(deviceId, seq, now) {
      if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) throw new RangeError("device_id is not valid");
      if (!Number.isSafeInteger(seq) || seq < 0 || seq > lastSeq()) {
        throw new RangeError("seq must be a safe integer from 0 to the room's last seq");
      }
      store.sql.exec(
        `INSERT INTO cursors (device_id, last_seq, seen_at) VALUES (?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           last_seq = max(cursors.last_seq, excluded.last_seq),
           seen_at = excluded.seen_at`,
        deviceId,
        seq,
        now,
      );
    },

    lastSeq,

    // Of deviceIds, the ones not pushed in the last PUSH_GAP_MS; records now as their push time.
    duePushes(deviceIds, now) {
      for (const id of deviceIds) {
        if (typeof id !== "string" || !DEVICE_ID.test(id)) throw new RangeError("device_id is not valid");
      }
      return store.transactionSync(() => {
        const due: string[] = [];
        for (const id of deviceIds) {
          const [row] = store.sql.exec("SELECT pushed_at FROM pushes WHERE device_id = ?", id).toArray();
          if (row !== undefined && typeof row.pushed_at === "number" && row.pushed_at > now - PUSH_GAP_MS) continue;
          store.sql.exec(
            "INSERT INTO pushes (device_id, pushed_at) VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET pushed_at = excluded.pushed_at",
            id,
            now,
          );
          due.push(id);
        }
        return due;
      });
    },
  };
}
```

`apps/api/src/room/sockets.ts`, exactly:

```ts
import type { createRoomStore, NewChange } from "./store.ts";

// The live side of a group room: hibernating WebSockets that are only told "something changed" (never content),
// and pushes for devices that are not connected. Plain code, tested in Node with fake sockets; object.ts wires it
// to the Durable Object's state.

export type RoomStore = ReturnType<typeof createRoomStore>;

// The parts of a WebSocket and of DurableObjectState this module uses. WebSocket and DurableObjectState satisfy them.
export type RoomSocket = { send(message: string): void; close(code?: number, reason?: string): void };
export type SocketHost = { getWebSockets(tag?: string): RoomSocket[]; getTags(ws: RoomSocket): string[] };

// A device that should hear about a new change: an approved device of an active member (not the writer).
export type PushTarget = { id: string; user_id: string };

// Set by the API Worker on the request it forwards to the room; the room is reachable only through its binding.
export const ROOM_USER_HEADER = "Waypoint-Room-User";
export const ROOM_DEVICE_HEADER = "Waypoint-Room-Device";
// The membership's end (Unix ms), or "never".
export const ROOM_UNTIL_HEADER = "Waypoint-Room-Until";

export const CLOSE_REPLACED = 4000;
export const CLOSE_MEMBERSHIP_ENDED = 4003;
export const CLOSE_UNSUPPORTED = 1003;

export const deviceTag = (deviceId: string): string => `device:${deviceId}`;
export const userTag = (userId: string): string => `user:${userId}`;
export const untilTag = (until: number | null): string => `until:${until === null ? "never" : String(until)}`;

export function changedMessage(lastSeq: number): string {
  return JSON.stringify({ type: "changed", last_seq: lastSeq });
}

function closeQuietly(ws: RoomSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closing
  }
}

export function closeTagged(host: SocketHost, tag: string, code: number, reason: string): void {
  for (const ws of host.getWebSockets(tag)) closeQuietly(ws, code, reason);
}

function endedAt(host: SocketHost, ws: RoomSocket): number | null {
  const tag = host.getTags(ws).find((t) => t.startsWith("until:"));
  if (tag === undefined || tag === "until:never") return null;
  const value = Number(tag.slice("until:".length));
  return Number.isSafeInteger(value) ? value : 0;
}

// Tells every socket except the writer device's that the room's last seq moved. A socket whose membership end has
// passed is closed instead.
export function broadcastChanged(host: SocketHost, lastSeq: number, writerDeviceId: string, now: number): void {
  const writer = new Set(host.getWebSockets(deviceTag(writerDeviceId)));
  const message = changedMessage(lastSeq);
  for (const ws of host.getWebSockets()) {
    if (writer.has(ws)) continue;
    const until = endedAt(host, ws);
    if (until !== null && until <= now) {
      closeQuietly(ws, CLOSE_MEMBERSHIP_ENDED, "membership ended");
      continue;
    }
    try {
      ws.send(message);
    } catch {
      // a socket that is closing misses this notice; the app catches up when it reconnects
    }
  }
}

// Appends the change, tells connected devices, and returns the devices to push: targets with no open socket that
// were not pushed in the last minute.
export function appendAndNotify(
  room: RoomStore,
  host: SocketHost,
  change: NewChange,
  targets: PushTarget[],
  now: number,
): { seq: number; push: PushTarget[] } {
  const { seq } = room.append(change, now);
  broadcastChanged(host, seq, change.device_id, now);
  const offline = targets.filter((t) => host.getWebSockets(deviceTag(t.id)).length === 0);
  const due = new Set(room.duePushes(offline.map((t) => t.id), now));
  return { seq, push: offline.filter((t) => due.has(t.id)) };
}

// The only message a client sends: { "type": "ack", "seq": n }. Anything else gives null.
export function parseAck(message: string | ArrayBuffer): number | null {
  if (typeof message !== "string" || message.length > 200) return null;
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Object.keys(value).length !== 2) return null;
  const { type, seq } = value as { type?: unknown; seq?: unknown };
  if (type !== "ack" || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) return null;
  return seq;
}

// Records an ack from the socket's device; a seq above the room's last is lowered to it. A socket without a device
// tag, or a message that is not an ack, closes the socket.
export function handleSocketMessage(room: RoomStore, host: SocketHost, ws: RoomSocket, message: string | ArrayBuffer, now: number): void {
  const seq = parseAck(message);
  const tag = host.getTags(ws).find((t) => t.startsWith("device:"));
  if (seq === null || tag === undefined) {
    closeQuietly(ws, CLOSE_UNSUPPORTED, "unsupported message");
    return;
  }
  room.ack(tag.slice("device:".length), Math.min(seq, room.lastSeq()), now);
}
```

`apps/api/src/room/object.ts`, exactly. The RPC `append` now takes the push targets and returns the devices to push; `after` takes the options; `disconnect` and the socket handlers are new:

```ts
import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.ts";
import {
  appendAndNotify,
  changedMessage,
  CLOSE_MEMBERSHIP_ENDED,
  CLOSE_REPLACED,
  closeTagged,
  deviceTag,
  handleSocketMessage,
  ROOM_DEVICE_HEADER,
  ROOM_UNTIL_HEADER,
  ROOM_USER_HEADER,
  untilTag,
  userTag,
  type PushTarget,
  type RoomStore,
} from "./sockets.ts";
import { createRoomStore, type AfterOptions, type Change, type NewChange } from "./store.ts";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const UNTIL = /^(never|\d{1,16})$/;

export class GroupRoom extends DurableObject<Env> {
  private room!: RoomStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = createRoomStore(ctx.storage);
    });
    // Answered by the runtime without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  append(change: NewChange, targets: PushTarget[]): { seq: number; push: PushTarget[] } {
    return appendAndNotify(this.room, this.ctx, change, targets, Date.now());
  }

  after(seq: number, limit: number, options: AfterOptions): { changes: Change[]; last_seq: number } {
    return this.room.after(seq, limit, options);
  }

  ack(deviceId: string, seq: number): void {
    this.room.ack(deviceId, seq, Date.now());
  }

  // Closes every socket of a user whose membership just ended.
  disconnect(userId: string): void {
    closeTagged(this.ctx, userTag(userId), CLOSE_MEMBERSHIP_ENDED, "membership ended");
  }

  // Only the API Worker calls this, after it has checked the session, the membership and the device.
  override async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get(ROOM_USER_HEADER) ?? "";
    const deviceId = request.headers.get(ROOM_DEVICE_HEADER) ?? "";
    const until = request.headers.get(ROOM_UNTIL_HEADER) ?? "";
    if (request.headers.get("Upgrade") !== "websocket" || !ID.test(userId) || !ID.test(deviceId) || !UNTIL.test(until)) {
      return new Response(null, { status: 400 });
    }
    closeTagged(this.ctx, deviceTag(deviceId), CLOSE_REPLACED, "replaced by a newer connection");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [deviceTag(deviceId), userTag(userId), untilTag(until === "never" ? null : Number(until))]);
    server.send(changedMessage(this.room.lastSeq()));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    handleSocketMessage(this.room, this.ctx, ws, message, Date.now());
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    // Answer the client's close frame. 1005 and 1006 cannot be sent back.
    try {
      if (code === 1005 || code === 1006) ws.close();
      else ws.close(code, reason);
    } catch {
      // already closed
    }
  }
}
```

`apps/api/test/helpers/room.ts`, exactly (Part B's tests and later cards reuse it and must not write their own):

```ts
import { appendAndNotify, closeTagged, CLOSE_MEMBERSHIP_ENDED, userTag, type PushTarget, type RoomSocket, type SocketHost } from "../../src/room/sockets.ts";
import { createRoomStore, type AfterOptions, type NewChange } from "../../src/room/store.ts";
import { createTestStore } from "./sql.ts";

// A socket stand-in: records what it was sent and how it was closed.
export type FakeSocket = RoomSocket & { tags: string[]; sent: string[]; closed: { code: number | undefined; reason: string | undefined } | null };

export type FakeHost = SocketHost & { sockets: FakeSocket[]; connect(tags: string[]): FakeSocket };

export function fakeHost(): FakeHost {
  const sockets: FakeSocket[] = [];
  const isFake = (ws: RoomSocket): ws is FakeSocket => sockets.some((s) => s === ws);
  return {
    sockets,
    connect(tags) {
      const socket: FakeSocket = {
        tags,
        sent: [],
        closed: null,
        send(message) {
          if (socket.closed !== null) throw new Error("socket closed");
          socket.sent.push(message);
        },
        close(code, reason) {
          socket.closed = { code, reason };
        },
      };
      sockets.push(socket);
      return socket;
    },
    getWebSockets(tag) {
      return sockets.filter((s) => s.closed === null && (tag === undefined || s.tags.includes(tag)));
    },
    getTags(ws) {
      return isFake(ws) ? ws.tags : [];
    },
  };
}

// Stands in for env.GROUP_ROOM: one room per name, each a real room store on createTestStore() with a fake host,
// running the same plain code as the Durable Object. fetch only records what the Worker forwarded.
export function fakeRoomNamespace(now: () => number) {
  const rooms = new Map<string, { store: ReturnType<typeof createRoomStore>; host: FakeHost; fetches: { url: string; headers: Headers }[] }>();
  const roomFor = (name: string) => {
    let room = rooms.get(name);
    if (room === undefined) {
      room = { store: createRoomStore(createTestStore()), host: fakeHost(), fetches: [] };
      rooms.set(name, room);
    }
    return room;
  };
  return {
    rooms,
    roomFor,
    idFromName: (name: string) => name,
    get: (name: string) => {
      const room = roomFor(name);
      return {
        append: async (change: NewChange, targets: PushTarget[]) => appendAndNotify(room.store, room.host, change, targets, now()),
        after: async (seq: number, limit: number, options: AfterOptions) => room.store.after(seq, limit, options),
        disconnect: async (userId: string) => closeTagged(room.host, userTag(userId), CLOSE_MEMBERSHIP_ENDED, "membership ended"),
        fetch: async (url: string, init: RequestInit) => {
          room.fetches.push({ url, headers: new Headers(init.headers) });
          return new Response("forwarded to the room");
        },
      };
    },
  };
}
```

Tests (`apps/api/test/room-store.test.ts`, add; change nothing else). One bullet one test:
- `after(0, 10, { fromAt: T })` returns only changes appended with `now` ≥ T, in seq order; `last_seq` is still the room's largest seq.
- `after` with `maxBytes`: three changes of 100 bytes and `maxBytes: 250` → seq 1 and 2; `maxBytes: 1` → only seq 1 (the first change always comes); no option → all three.
- `after` with `fromAt: -1`, `fromAt: 1.5`, `maxBytes: 0` → `RangeError`.
- `lastSeq()` is 0 for an empty room and the largest seq after appends.
- `duePushes(["a", "b"], T)` → both; again at T + 59,999 → none; at T + 60,000 → both; a mix (only `a` pushed before) → only `b` within the minute.
- `duePushes` with an invalid device id → `RangeError`, and nothing is recorded for the valid ids in the same call.

Tests (`apps/api/test/room-sockets.test.ts`, with `createRoomStore(createTestStore())` and `fakeHost()`; never import `object.ts`). One bullet one test:
- Compile-time checks: `export const hostFits: (state: DurableObjectState) => SocketHost = (state) => state;` and `export const socketFits: (ws: WebSocket) => RoomSocket = (ws) => ws;`.
- `broadcastChanged`: sockets of two other devices each get exactly `{"type":"changed","last_seq":5}`; the writer device's two sockets get nothing.
- `broadcastChanged`: a socket tagged `until:<now>` is closed with 4003 "membership ended" and sent nothing; one tagged `until:<now + 1>` and one `until:never` get the notice.
- `broadcastChanged`: a socket whose `send` throws does not stop the others.
- `appendAndNotify`: stores the change (seq 1), broadcasts, and returns as `push` only the targets with no open socket.
- `appendAndNotify`: a second append within a minute returns no `push`; after 60,000 ms the offline target is returned again.
- `appendAndNotify`: a target with an open socket is not pushed, also when the next append comes more than a minute later.
- `parseAck`: `{"type":"ack","seq":3}` → 3; `seq` −1, 1.5, `"3"`, an extra key, another `type`, invalid JSON, an `ArrayBuffer` and a 201-character string → null.
- `handleSocketMessage`: an ack from a socket tagged `device:d1` sets `d1`'s cursor; an ack above the room's last seq sets the cursor to the last seq; a bad message closes the socket with 1003 and changes no cursor.
- `closeTagged` closes only the sockets with that tag.

Not in this PR: the HTTP endpoints (Part B), presence ("who is viewing"), snapshots and compaction, an alarm or anything else that would keep the room awake.

### Part B: the endpoints

Files: `packages/contracts/src/sync.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/sync.test.ts`, `apps/api/src/sync/routes.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/src/groups/members.ts` (one block), `apps/api/test/sync.test.ts`, `apps/api/test/members.test.ts` (new tests only). No other files.

`packages/contracts/src/sync.ts`, exactly, and `export * from "./sync.ts";` at the end of `packages/contracts/src/index.ts`:

```ts
import { z } from "zod";
import { KeyIdSchema } from "./keys.ts";

// PR 28: sync. Locked bytes are base64url; 44 to 1,398,102 characters is 33 bytes (the smallest locked content:
// 17-byte header and 16-byte tag) to 1,048,576 bytes (the room's limit; bigger content goes to a blob).
export const LockedBytesSchema = z.string().regex(/^[A-Za-z0-9_-]{44,1398102}$/);
export const ChangeKindSchema = z.string().regex(/^[a-z_]{1,32}$/);
export const BlobKeySchema = z.string().regex(/^groups\/[A-Za-z0-9_-]{16,48}\/media\/[A-Za-z0-9_-]{16,64}$/);

export const PostChangeRequestSchema = z.strictObject({
  device_id: KeyIdSchema,
  key_version: z.number().int().min(1),
  kind: ChangeKindSchema,
  locked_bytes: LockedBytesSchema,
  blob_key: BlobKeySchema.nullable(),
});
export const PostChangeResponseSchema = z.strictObject({ seq: z.number().int().min(1) });

export const ChangeViewSchema = z.strictObject({
  seq: z.number().int().min(1),
  device_id: z.string(),
  key_version: z.number().int().min(1),
  kind: z.string(),
  locked_bytes: z.string(),
  blob_key: z.string().nullable(),
  at: z.number().int(),
});
export type ChangeView = z.infer<typeof ChangeViewSchema>;

export const ChangesPageSchema = z.strictObject({
  key_version: z.number().int().min(1),
  last_seq: z.number().int().min(0),
  changes: z.array(ChangeViewSchema),
});

// The socket only says that something changed; the app then calls GET /v1/groups/:id/changes?after=.
export const SyncServerMessageSchema = z.strictObject({ type: z.literal("changed"), last_seq: z.number().int().min(0) });
export const SyncAckMessageSchema = z.strictObject({ type: z.literal("ack"), seq: z.number().int().min(0) });
```

`apps/api/src/sync/routes.ts`, exactly:

```ts
import { PostChangeRequestSchema, type ChangeView } from "@waypoint/contracts";
import { contentKeyVersion, fromBase64Url, toBase64Url } from "@waypoint/crypto";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { activeMembership } from "../groups/membership.ts";
import { idempotent } from "../idempotency.ts";
import type { PushMessage } from "../push/messages.ts";
import { ROOM_DEVICE_HEADER, ROOM_UNTIL_HEADER, ROOM_USER_HEADER, type PushTarget } from "../room/sockets.ts";
import type { Change } from "../room/store.ts";
import type { Db } from "../storage.ts";

export const DEFAULT_PAGE = 100;
export const MAX_PAGE = 500;
// Locked bytes per page of GET /changes; one bigger change still comes alone.
export const MAX_PAGE_BYTES = 4 * 1024 * 1024;
// Queues accept at most 100 messages per sendBatch.
const PUSH_BATCH = 100;

// Approved, not removed phones and iPads of the group's active members, except the writer's device.
const TARGETS_SQL = `
  SELECT d.id, d.user_id FROM memberships m JOIN devices d ON d.user_id = m.user_id
  WHERE m.group_id = ? AND m.left_at IS NULL AND (m.ends_at IS NULL OR m.ends_at > ?)
    AND d.kind = 'device' AND d.removed_at IS NULL AND d.approved_at IS NOT NULL AND d.id != ?
  ORDER BY d.id`;

function viewOf(change: Change): ChangeView {
  return { ...change, locked_bytes: toBase64Url(new Uint8Array(change.locked_bytes)) };
}

function intQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d{1,16}$/.test(value)) throw new ApiFailure("bad_request", "invalid request");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ApiFailure("bad_request", "invalid request");
  return n;
}

async function approvedDevice(db: Db, deviceId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM devices WHERE id = ? AND user_id = ? AND kind = 'device' AND removed_at IS NULL AND approved_at IS NOT NULL")
    .bind(deviceId, userId)
    .first<{ id: string }>();
  return row !== null;
}

export function syncRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .get("/v1/groups/:id/changes", async (c) => {
      const groupId = c.req.param("id");
      const membership = await activeMembership(c.env.DB, groupId, c.get("user").id, deps.now());
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      const after = intQuery(c.req.query("after"), 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = intQuery(c.req.query("limit"), DEFAULT_PAGE, 1, MAX_PAGE);
      const room = c.env.GROUP_ROOM.get(c.env.GROUP_ROOM.idFromName(groupId));
      const page = await room.after(after, limit, { fromAt: membership.history_from, maxBytes: MAX_PAGE_BYTES });
      return c.json({ key_version: membership.key_version, last_seq: page.last_seq, changes: page.changes.map(viewOf) });
    })
    .post("/v1/groups/:id/changes", idempotent(deps), async (c) => {
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = PostChangeRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const groupId = c.req.param("id");
      const membership = await activeMembership(db, groupId, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      if (membership.role === "viewer") throw new ApiFailure("forbidden", "viewers cannot write");
      if (!(await approvedDevice(db, req.device_id, user.id))) throw new ApiFailure("forbidden", "not an approved device of this user");
      // docs/security.md, section 15: nothing is written with a key a removed member knows.
      if (req.key_version !== membership.key_version) throw new ApiFailure("conflict", "key version is not current");
      let bytes: Uint8Array;
      try {
        bytes = fromBase64Url(req.locked_bytes);
        if (contentKeyVersion(bytes) !== req.key_version || bytes.length > 1_048_576) throw new RangeError("bad locked bytes");
      } catch {
        throw new ApiFailure("bad_request", "invalid request");
      }
      if (req.blob_key !== null && !req.blob_key.startsWith(`groups/${groupId}/media/`)) throw new ApiFailure("bad_request", "invalid request");

      const targets = (await db.prepare(TARGETS_SQL).bind(groupId, now, req.device_id).all<PushTarget>()).results;
      const room = c.env.GROUP_ROOM.get(c.env.GROUP_ROOM.idFromName(groupId));
      const result = await room.append(
        { device_id: req.device_id, key_version: req.key_version, kind: req.kind, locked_bytes: new Uint8Array(bytes).buffer, blob_key: req.blob_key },
        targets,
      );
      // A lost push is not an error: the change is stored, and the device catches up when it next opens the group.
      try {
        for (let i = 0; i < result.push.length; i += PUSH_BATCH) {
          const messages = result.push.slice(i, i + PUSH_BATCH).map((t): { body: PushMessage } => ({
            body: { user_id: t.user_id, kind: "sync", ref: groupId, device_id: t.id },
          }));
          await c.env.PUSH_QUEUE.sendBatch(messages);
        }
      } catch {
        // see above
      }
      return c.json({ seq: result.seq }, 201);
    })
    .get("/v1/groups/:id/sync", async (c) => {
      if ((c.req.header("Upgrade") ?? "").toLowerCase() !== "websocket") throw new ApiFailure("bad_request", "websocket upgrade required");
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const groupId = c.req.param("id");
      const membership = await activeMembership(db, groupId, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      const deviceId = c.req.query("device") ?? "";
      if (!(await approvedDevice(db, deviceId, user.id))) throw new ApiFailure("not_found", "no such device");
      const room = c.env.GROUP_ROOM.get(c.env.GROUP_ROOM.idFromName(groupId));
      return room.fetch("https://group-room/sync", {
        headers: {
          Upgrade: "websocket",
          [ROOM_USER_HEADER]: user.id,
          [ROOM_DEVICE_HEADER]: deviceId,
          [ROOM_UNTIL_HEADER]: membership.ends_at === null ? "never" : String(membership.ends_at),
        },
      });
    });
}
```

What the routes do:
- `GET /v1/groups/:id/changes?after=&limit=` (session only): an active member gets `{ key_version, last_seq, changes }`, changes after `after` (default 0) written at or after their `history_from`, at most `limit` (1 to 500, default 100) and about 4 MiB of locked bytes per page. The app reads pages until a page is empty or its last seq is `last_seq`.
- `POST /v1/groups/:id/changes` (session and `idempotent`; not signed, decision 9): 201 `{ seq }`. 404 if not an active member; 403 "viewers cannot write"; 403 "not an approved device of this user"; 409 "key version is not current" when `key_version` is not the group's (`docs/security.md` section 15); 400 when the locked bytes' own header carries another key version, or `blob_key` is not under `groups/<this group>/media/`.
- `GET /v1/groups/:id/sync?device=<device id>` (session only; the app's WebSocket sends `Authorization: Bearer <token>`, which React Native's `WebSocket` allows through its third `options.headers` argument): needs `Upgrade: websocket`, an active membership and an approved device of the caller; forwards to the room with the user, device and membership end in headers. The room closes an older socket of the same device, accepts the new one with the tags `device:<id>`, `user:<id>`, `until:<ends_at or never>`, and sends the current `last_seq` at once. The app should send the text `ping` every 30 to 60 seconds; the runtime answers `pong` without waking the room.

`apps/api/src/app.ts`: `import { syncRoutes } from "./sync/routes.ts";` and `app.route("/", syncRoutes({ now: deps.now }));`.

`apps/api/src/groups/members.ts` (PR 27 Part B): directly after the line `await db.batch(endMembershipStatements(db, groupId, targetId, now));`, add exactly:

```ts
    // Close the member's open sockets. The membership has already ended, so a failure here changes nothing.
    try {
      await c.env.GROUP_ROOM.get(c.env.GROUP_ROOM.idFromName(groupId)).disconnect(targetId);
    } catch {
      // ignored
    }
```

(PR 27's member tests have no `GROUP_ROOM` in their `env`, so the call throws inside the `try` and they still pass. The hourly expiry does not call the room: each socket carries its `until` tag and the room closes it at the next change.)

Tests (`packages/contracts/test/sync.test.ts`). One bullet one test:
- `PostChangeRequestSchema` accepts a 44-character `locked_bytes` and rejects 43; rejects `kind: "Note"`, `key_version: 0` and an extra key.
- `BlobKeySchema` accepts `groups/group_aaaaaaaaaaaa/media/blob_bbbbbbbbbbbbbb` and rejects `results/x`, a 15-character group id and `../`.
- `SyncServerMessageSchema` parses `{ "type": "changed", "last_seq": 3 }` and rejects an extra key; `SyncAckMessageSchema` rejects `seq: -1`.

Tests (`apps/api/test/sync.test.ts`), with `env = { DB, GROUP_ROOM: fakeRoomNamespace(() => NOW), PUSH_QUEUE }` where `PUSH_QUEUE` is `{ sendBatch: async (messages) => { sent.push(...messages); } }`. Fixture: group `g` (`key_version` 2) with `u1` owner (`history_from` 0, devices `dev_u1a` and `dev_u1b`), `u2` editor (`dev_u2`), `u3` viewer whose `history_from` is NOW + 1 (`dev_u3`); `u2` also has a waiting device and a removed device. Locked bytes are made with `lockContent(key, 2, context("change", g, device, kind), plaintext, nonce)` from `@waypoint/crypto`. One bullet one test:
- `u1` posts from `dev_u1a` → 201 `{ seq: 1 }`; the body passes `PostChangeResponseSchema`; the room holds the bytes byte for byte with `device_id`, `kind`, `key_version` 2 and `blob_key` null.
- That post queues exactly one `sync` message for each of `dev_u1b`, `dev_u2`, `dev_u3` (`{ user_id, kind: "sync", ref: g, device_id }`), none for `dev_u1a`, the waiting or the removed device, and every message passes `PushMessageSchema`.
- A second post within the same minute queues nothing.
- With a fake socket connected for `dev_u2` (`ns.roomFor(g).host.connect(["device:dev_u2", "user:u2", "until:never"])`), a post sends that socket `{"type":"changed","last_seq":n}` and queues no message for `dev_u2`.
- A `PUSH_QUEUE` whose `sendBatch` throws → still 201 and the change is stored.
- The same request with the same Idempotency-Key → the stored `{ seq: 1 }`, and the room still has one change.
- `u3` (viewer) posts → 403 "viewers cannot write".
- `device_id` of another user's device, of `u2`'s waiting device and of a removed device → 403.
- `key_version` 1 and 3 → 409 "key version is not current"; nothing appended.
- Locked bytes whose header says key version 1 while `key_version` is 2 → 400; `blob_key` of another group → 400; bad JSON → 400.
- A non-member, and a member whose `ends_at` is NOW → 404 on each of the three routes.
- `GET .../changes` → 200, passes `ChangesPageSchema`, `locked_bytes` is the base64url of what was posted, `key_version` 2.
- `GET .../changes?after=1` after three posts → seq 2 and 3; `limit=1` → only seq 1; `after=-1`, `after=x`, `limit=0` and `limit=501` → 400.
- `u3`'s `GET .../changes` does not include changes written before NOW + 1 (append one with the fake clock at NOW + 1 to see it included).
- `GET .../sync?device=dev_u1a` with `Upgrade: websocket` → the fake room's response; the room got `Upgrade: websocket`, `Waypoint-Room-User: u1`, `Waypoint-Room-Device: dev_u1a`, `Waypoint-Room-Until: never`.
- `GET .../sync` for a member with `ends_at` NOW + 5000 → `Waypoint-Room-Until` is that number.
- `GET .../sync` without `Upgrade` → 400; with another user's device or a waiting device → 404; nothing forwarded.

`apps/api/test/members.test.ts` (add): with `GROUP_ROOM: fakeRoomNamespace(...)` in `env` and two fake sockets in `g1`'s room (`user:u2` and `user:u3`), removing `u2` closes `u2`'s socket with 4003 and leaves `u3`'s open; with a `GROUP_ROOM` whose `get` throws, the removal still returns 200 and bumps the key version.

Not in this PR: presence, snapshots (`groups/{group}/snap/{seq}`) and compaction, refusing a change in the room itself during the moment between the key-version check and a removal (open question), media (PR 29), the app's sync engine (M28).

---

## PR 29 · Blobs: locked media through the Worker

Branch `pr/29-blobs`. Builds on PR 27 Part A (`activeMembership`, `GroupIdSchema`) and PR 33 (the `BUCKET` binding). No new dependencies. One sitting.

Read decisions 10 to 12. `POST /v1/blobs?group=<group id>&id=<blob id>` takes the locked file as the raw request body (`Content-Type: application/octet-stream`, `Content-Length` required) and streams it to R2 `groups/{group}/media/{id}`. `GET /v1/blobs/:id` streams it back. Not signed; the global Idempotency-Key header check still applies to the `POST`, but the route does not use `idempotent()` (decision 11).

Files: `db/d1/migrations/0008_blobs.sql`, `db/d1/test/schema.test.mjs`, `packages/contracts/src/blobs.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/blobs.test.ts`, `apps/api/src/blobs/routes.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/blobs.test.ts`. No other files.

`db/d1/migrations/0008_blobs.sql`, exactly:

```sql
-- Locked media files in R2 at groups/{group_id}/media/{id} (PR 29). Sizes only, never content. user_id is who
-- uploaded the file and whose 3 GB it counts against; stored_at is NULL while the upload is still running.
CREATE TABLE blobs (
  id TEXT NOT NULL PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  stored_at INTEGER
);
CREATE INDEX blobs_user_id ON blobs (user_id);
CREATE INDEX blobs_group_id ON blobs (group_id);
```

`db/d1/test/schema.test.mjs`: add `blobs: ["id", "group_id", "user_id", "bytes", "created_at", "stored_at"]` to `EXPECTED` and `blobs: { id: "TEXT", group_id: "TEXT", user_id: "TEXT?", bytes: "INTEGER", created_at: "INTEGER", stored_at: "INTEGER?" }` to `EXPECTED_TYPES`; add `["blobs", ["user_id"]]` and `["blobs", ["group_id"]]` to `REQUIRED_INDEXES`. New tests: deleting the group deletes its blob rows; deleting the user sets `blobs.user_id` to NULL and keeps the row; a blob for a missing group is rejected.

`packages/contracts/src/blobs.ts`, exactly, and `export * from "./blobs.ts";` at the end of `packages/contracts/src/index.ts`:

```ts
import { z } from "zod";
import { GroupIdSchema } from "./groups.ts";

// PR 29: locked media. The device picks the blob id (it is part of the file's AAD, docs/security.md section 11).
export const BlobIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const BlobStoredSchema = z.strictObject({ id: BlobIdSchema, group_id: GroupIdSchema, bytes: z.number().int().min(1) });
```

`apps/api/src/blobs/routes.ts`, exactly:

```ts
import { BlobIdSchema, GroupIdSchema } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { activeMembership } from "../groups/membership.ts";

// Under the 100 MB request body limit of a Free or Pro zone, with room to spare.
export const MAX_BLOB_BYTES = 95_000_000;
// The smallest locked content: 17-byte header and 16-byte tag.
export const MIN_BLOB_BYTES = 33;
export const BYTES_PER_GB = 1024 * 1024 * 1024;
export const DEFAULT_MEDIA_CAP_GB = 3;

export function blobKey(groupId: string, blobId: string): string {
  return `groups/${groupId}/media/${blobId}`;
}

// The parts of R2 these routes use. R2Bucket satisfies this type.
export type BlobBucket = {
  put(key: string, value: ReadableStream, options: { httpMetadata: { contentType: string } }): Promise<{ size: number }>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
};

type BlobRow = { group_id: string; user_id: string | null; bytes: number; created_at: number; stored_at: number | null };

export function blobRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .post("/v1/blobs", async (c) => {
      const groupParsed = GroupIdSchema.safeParse(c.req.query("group"));
      const idParsed = BlobIdSchema.safeParse(c.req.query("id"));
      const lengthText = c.req.header("Content-Length") ?? "";
      const body = c.req.raw.body;
      if (!groupParsed.success || !idParsed.success || !/^\d{1,10}$/.test(lengthText) || body === null) {
        throw new ApiFailure("bad_request", "invalid request");
      }
      const groupId = groupParsed.data;
      const blobId = idParsed.data;
      const bytes = Number(lengthText);
      if (bytes < MIN_BLOB_BYTES || bytes > MAX_BLOB_BYTES) throw new ApiFailure("bad_request", "file too large or too small");
      const user = c.get("user");
      if (user.plan === "free") throw new ApiFailure("plan_required", "media sync needs a paid plan");
      const db = c.env.DB;
      const now = deps.now();
      const membership = await activeMembership(db, groupId, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      if (membership.role === "viewer") throw new ApiFailure("forbidden", "viewers cannot write");

      const existing = await db.prepare("SELECT group_id, user_id, bytes, created_at, stored_at FROM blobs WHERE id = ?").bind(blobId).first<BlobRow>();
      if (existing !== null) {
        // The same upload again (a retry): same group, uploader and size. Anything else is another file.
        if (existing.group_id !== groupId || existing.user_id !== user.id || existing.bytes !== bytes) throw new ApiFailure("conflict", "blob id taken");
        if (existing.stored_at !== null) return c.json({ id: blobId, group_id: groupId, bytes });
      } else {
        const cap = await db
          .prepare("SELECT COALESCE(MAX(media_cap_gb), ?) AS gb FROM entitlements WHERE user_id = ? AND ended_at IS NULL")
          .bind(DEFAULT_MEDIA_CAP_GB, user.id)
          .first<{ gb: number }>();
        const capBytes = (cap?.gb ?? DEFAULT_MEDIA_CAP_GB) * BYTES_PER_GB;
        // Reserve the size first, in one statement, so two uploads at once cannot both pass the cap.
        const reserved = await db
          .prepare(
            `INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at)
             SELECT ?, ?, ?, ?, ?, NULL
             WHERE (SELECT COALESCE(SUM(bytes), 0) FROM blobs WHERE user_id = ?) + ? <= ?
             ON CONFLICT (id) DO NOTHING`,
          )
          .bind(blobId, groupId, user.id, bytes, now, user.id, bytes, capBytes)
          .run();
        if (reserved.meta.changes !== 1) {
          const taken = await db.prepare("SELECT id FROM blobs WHERE id = ?").bind(blobId).first<{ id: string }>();
          if (taken !== null) throw new ApiFailure("conflict", "blob id taken");
          throw new ApiFailure("conflict", "media storage is full");
        }
      }

      const bucket: BlobBucket = c.env.BUCKET;
      const key = blobKey(groupId, blobId);
      let stored: { size: number };
      try {
        stored = await bucket.put(key, body, { httpMetadata: { contentType: "application/octet-stream" } });
      } catch (error) {
        await db.prepare("DELETE FROM blobs WHERE id = ? AND stored_at IS NULL").bind(blobId).run();
        throw error;
      }
      if (stored.size !== bytes) {
        await bucket.delete(key);
        await db.prepare("DELETE FROM blobs WHERE id = ? AND stored_at IS NULL").bind(blobId).run();
        throw new ApiFailure("bad_request", "upload incomplete");
      }
      await db.prepare("UPDATE blobs SET stored_at = ? WHERE id = ?").bind(now, blobId).run();
      return c.json({ id: blobId, group_id: groupId, bytes }, 201);
    })
    .get("/v1/blobs/:id", async (c) => {
      const blobId = c.req.param("id");
      const db = c.env.DB;
      const row = await db
        .prepare("SELECT group_id, user_id, bytes, created_at, stored_at FROM blobs WHERE id = ? AND stored_at IS NOT NULL")
        .bind(blobId)
        .first<BlobRow>();
      if (row === null) throw new ApiFailure("not_found", "no such file");
      const membership = await activeMembership(db, row.group_id, c.get("user").id, deps.now());
      if (membership === null || row.created_at < membership.history_from) throw new ApiFailure("not_found", "no such file");
      const bucket: BlobBucket = c.env.BUCKET;
      const object = await bucket.get(blobKey(row.group_id, blobId));
      if (object === null) throw new ApiFailure("not_found", "no such file");
      return new Response(object.body, {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(object.size), "Cache-Control": "private, no-store" },
      });
    });
}
```

`apps/api/src/app.ts`: `import { blobRoutes } from "./blobs/routes.ts";` and `app.route("/", blobRoutes({ now: deps.now }));`.

Tests (`packages/contracts/test/blobs.test.ts`): `BlobIdSchema` accepts 16 and 64 characters and rejects 15, 65 and `a/b`; `BlobStoredSchema` rejects `bytes: 0`.

Tests (`apps/api/test/blobs.test.ts`). The bucket is a stand-in that reads the stream into bytes on `put` (`new Uint8Array(await new Response(value).arrayBuffer())`), keeps them in a `Map`, and returns `{ size }`; `get` returns `{ body: new Response(bytes).body, size }` or null. Requests set `Content-Length` themselves. Fixture: `u1` on `plus` (owner), `u2` on `plus` (viewer), `u3` on `free` (editor) in group `g`; `u4` on `plus` in no group. One bullet one test:
- Compile-time check: `export const bucketFits: (bucket: R2Bucket) => BlobBucket = (bucket) => bucket;`.
- `u1` uploads 100 bytes → 201 `{ id, group_id, bytes: 100 }` (passes `BlobStoredSchema`); the bucket holds the bytes at `groups/g/media/<id>`; the row has `user_id` `u1`, `bytes` 100, `stored_at` NOW.
- The same upload again → 200 with the same body; the bucket was written once.
- A row for the same id still uploading (`stored_at` null, same group, user and size) → the upload runs again → 201 and `stored_at` is set.
- The same id with another size, another group or by another user → 409 "blob id taken".
- `u3` (free) → 403 `plan_required` "media sync needs a paid plan"; nothing stored.
- `u2` (viewer) → 403; `u4` (not a member) → 404.
- No `Content-Length`, a size of 32 bytes, a size of 95,000,001 bytes, a bad group id or a bad blob id → 400; nothing stored.
- With `3 * BYTES_PER_GB - 150` bytes already counted for `u1` (insert a stored row), 151 bytes → 409 "media storage is full" and no row is added; 150 bytes → 201 (exactly at the cap).
- An open entitlement with `media_cap_gb` 5 raises the cap: the same 151 bytes → 201; an ended one does not.
- Pending rows count: a `stored_at` null row of `u1` counts toward the cap.
- A bucket whose `put` throws → 500 `internal`, and the reserved row is gone.
- A bucket whose `put` returns another size → 400 "upload incomplete"; the object and the row are gone.
- `GET /v1/blobs/:id` by `u2` (viewer) → 200, `application/octet-stream`, `Content-Length` 100, `Cache-Control: private, no-store`, the same bytes.
- `GET` by `u4` → 404; for a row still uploading → 404; for a row whose object is missing → 404; for an unknown id → 404.
- `GET` by a member whose `history_from` is after the file's `created_at` → 404.

Not in this PR: deleting media (no endpoint yet; open question), snapshots, ranged downloads, a cleanup for rows left uploading (they are retried by id), the app's upload code (M28).

---
## PR 30 · Shared links: create, revoke, and the public data endpoint

Branch `pr/30-links`. Builds on PR 27 Part A (`activeMembership`, `GroupIdSchema`) and PR 33 (`BUCKET`); merge after PR 29 so the migrations stay in order. No new dependencies. One sitting.

Read decisions 13 and 14 and `docs/security.md` sections 11 and 15. The app locks the item with a fresh random link key (`lockContent(linkKey, 0, context("link", link id), ...)`), sends the locked bytes, and shares `https://<host>/l/<link id>#k=<base64url key>`. The key never reaches the server. The viewer (V1) fetches `GET /v1/links/:id/data` without a session.

Files: `db/d1/migrations/0009_links.sql`, `db/d1/test/schema.test.mjs`, `packages/contracts/src/links.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/links.test.ts`, `apps/api/src/links/turnstile.ts`, `apps/api/src/links/routes.ts`, `apps/api/src/auth/session.ts`, `apps/api/src/env.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/wrangler.jsonc`, `apps/api/test/links.test.ts`, `apps/api/test/session.test.ts` (new tests only). No other files.

`db/d1/migrations/0009_links.sql`, exactly:

```sql
-- Shared links (PR 30): who made a link and when. The link's key is only in the URL fragment; the server keeps the
-- locked data in R2 (links/{id}/data) and a peppered passcode hash.
ALTER TABLE links ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE links ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
```

`db/d1/test/schema.test.mjs`: `EXPECTED.links` becomes `["id", "group_id", "blob_key", "passcode_hash", "expires_at", "revoked_at", "views", "created_by", "created_at"]`; `EXPECTED_TYPES.links` gains `created_by: "TEXT?"`, `created_at: "INTEGER"`. New tests: deleting the user in `links.created_by` deletes the link row; a link without `created_at` reads back 0.

`packages/contracts/src/links.ts`, exactly, and `export * from "./links.ts";` at the end of `packages/contracts/src/index.ts`:

```ts
import { z } from "zod";
import { GroupIdSchema } from "./groups.ts";

// PR 30: shared links. The device picks the link id (it is part of the data's AAD, docs/security.md section 11);
// 22 characters is 16 random bytes.
export const LinkIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
// Locked link data, base64url: 33 bytes to 4 MiB.
export const LinkDataSchema = z.string().regex(/^[A-Za-z0-9_-]{44,5592406}$/);
// Printable ASCII without spaces, so it travels in a header unchanged.
export const LinkPasscodeSchema = z.string().regex(/^[!-~]{4,64}$/);

export const LINK_PASSCODE_HEADER = "Waypoint-Link-Passcode";
export const LINK_TURNSTILE_HEADER = "Waypoint-Turnstile";

export const CreateLinkRequestSchema = z.strictObject({
  id: LinkIdSchema,
  group_id: GroupIdSchema,
  data: LinkDataSchema,
  passcode: LinkPasscodeSchema.nullable(),
  expires_at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
});

export const LinkViewSchema = z.strictObject({
  id: LinkIdSchema,
  group_id: GroupIdSchema,
  has_passcode: z.boolean(),
  expires_at: z.number().int().nullable(),
  created_at: z.number().int(),
});

export const LinkRevokedSchema = z.strictObject({ id: LinkIdSchema, revoked_at: z.number().int() });
```

`apps/api/src/links/turnstile.ts`, exactly:

```ts
import { z } from "zod";
import type { FetchLike } from "../push/apns.ts";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const SiteverifySchema = z.object({ success: z.boolean() });

// Asks Turnstile whether a widget token is good. Any failure (network, bad reply, used or old token) is false.
export async function verifyTurnstile(fetchFn: FetchLike, secret: string, token: string, remoteIp: string | null): Promise<boolean> {
  if (token.length < 1 || token.length > 2048) return false;
  try {
    const reply = await fetchFn(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(remoteIp === null ? { secret, response: token } : { secret, response: token, remoteip: remoteIp }),
    });
    if (!reply.ok) return false;
    const parsed = SiteverifySchema.safeParse(await reply.json());
    return parsed.success && parsed.data.success;
  } catch {
    return false;
  }
}
```

`apps/api/src/links/routes.ts`, exactly:

```ts
import { CreateLinkRequestSchema, LINK_PASSCODE_HEADER, LINK_TURNSTILE_HEADER, LinkIdSchema, LinkPasscodeSchema } from "@waypoint/contracts";
import { bytesEqual, contentKeyVersion, fromBase64Url, linkPasscodeHash } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv, Env } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { activeMembership } from "../groups/membership.ts";
import { idempotent } from "../idempotency.ts";
import { isUniqueViolation } from "../keys/envelopes.ts";
import type { FetchLike } from "../push/apns.ts";
import { verifyTurnstile } from "./turnstile.ts";

export const RATE_LIMIT_RETRY_AFTER = 60;

export function linkKey(linkId: string): string {
  return `links/${linkId}/data`;
}

// The parts of R2 these routes use. R2Bucket satisfies this type.
export type LinkBucket = {
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
};

type LinkRow = { id: string; group_id: string; passcode_hash: string | null; expires_at: number | null; revoked_at: number | null; created_by: string | null };

function pepper(env: Env): Uint8Array {
  try {
    const bytes = fromBase64Url(env.LINK_PASSCODE_PEPPER);
    if (bytes.length === 32) return bytes;
  } catch {
    // fall through
  }
  throw new ApiFailure("internal", "link passcodes unavailable");
}

export function linkRoutes(deps: { now: () => number; fetch: FetchLike }) {
  return new Hono<AppEnv>()
    .post("/v1/links", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = CreateLinkRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const membership = await activeMembership(db, req.group_id, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      if (membership.role === "viewer") throw new ApiFailure("forbidden", "viewers cannot share");
      if (req.expires_at !== null && req.expires_at <= now) throw new ApiFailure("bad_request", "invalid request");
      let data: Uint8Array;
      try {
        data = fromBase64Url(req.data);
        if (contentKeyVersion(data) !== 0) throw new RangeError("link data has key version 0");
      } catch {
        throw new ApiFailure("bad_request", "invalid request");
      }
      const passcodeHash = req.passcode === null ? null : await linkPasscodeHash(pepper(c.env), req.id, req.passcode);
      try {
        await db
          .prepare(
            "INSERT INTO links (id, group_id, blob_key, passcode_hash, expires_at, revoked_at, views, created_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)",
          )
          .bind(req.id, req.group_id, linkKey(req.id), passcodeHash, req.expires_at, user.id, now)
          .run();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "link id taken");
        throw error;
      }
      const bucket: LinkBucket = c.env.BUCKET;
      try {
        await bucket.put(linkKey(req.id), data, { httpMetadata: { contentType: "application/octet-stream" } });
      } catch (error) {
        await db.prepare("DELETE FROM links WHERE id = ?").bind(req.id).run();
        throw error;
      }
      return c.json({ id: req.id, group_id: req.group_id, has_passcode: passcodeHash !== null, expires_at: req.expires_at, created_at: now }, 201);
    })
    .delete("/v1/links/:id", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const link = await db
        .prepare("SELECT id, group_id, passcode_hash, expires_at, revoked_at, created_by FROM links WHERE id = ?")
        .bind(c.req.param("id"))
        .first<LinkRow>();
      if (link === null) throw new ApiFailure("not_found", "no such link");
      const membership = await activeMembership(db, link.group_id, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such link");
      if (link.created_by !== user.id && membership.role !== "owner") throw new ApiFailure("forbidden", "only its maker or an owner can revoke a link");
      const revokedAt = link.revoked_at ?? now;
      await db.prepare("UPDATE links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(revokedAt, link.id).run();
      const bucket: LinkBucket = c.env.BUCKET;
      await bucket.delete(linkKey(link.id));
      return c.json({ id: link.id, revoked_at: revokedAt });
    })
    // Public: the web viewer has no session (requireSession lets this path through).
    .get("/v1/links/:id/data", async (c) => {
      const id = LinkIdSchema.safeParse(c.req.param("id"));
      if (!id.success) throw new ApiFailure("not_found", "no such link");
      const linkId = id.data;
      const views = await c.env.LINK_VIEWS.limit({ key: linkId });
      if (!views.success) throw new ApiFailure("rate_limited", "too many requests", RATE_LIMIT_RETRY_AFTER);
      const db = c.env.DB;
      const now = deps.now();
      const link = await db
        .prepare("SELECT id, group_id, passcode_hash, expires_at, revoked_at, created_by FROM links WHERE id = ?")
        .bind(linkId)
        .first<LinkRow>();
      if (link === null) throw new ApiFailure("not_found", "no such link");
      if (link.revoked_at !== null) throw new ApiFailure("not_found", "link revoked");
      if (link.expires_at !== null && link.expires_at <= now) throw new ApiFailure("not_found", "link expired");
      if (link.passcode_hash !== null) {
        const passcode = c.req.header(LINK_PASSCODE_HEADER) ?? "";
        const token = c.req.header(LINK_TURNSTILE_HEADER) ?? "";
        if (passcode === "" || token === "") throw new ApiFailure("unauthorized", "passcode required");
        const ip = c.req.header("CF-Connecting-IP") ?? null;
        const attempts = await c.env.LINK_PASSCODES.limit({ key: `${linkId}:${ip ?? "unknown"}` });
        if (!attempts.success) throw new ApiFailure("rate_limited", "too many attempts", RATE_LIMIT_RETRY_AFTER);
        if (!(await verifyTurnstile(deps.fetch, c.env.TURNSTILE_SECRET_KEY, token, ip))) throw new ApiFailure("forbidden", "challenge failed");
        const wellFormed = LinkPasscodeSchema.safeParse(passcode);
        const given = wellFormed.success ? await linkPasscodeHash(pepper(c.env), linkId, passcode) : "";
        let same = false;
        try {
          same = bytesEqual(fromBase64Url(given), fromBase64Url(link.passcode_hash));
        } catch {
          same = false;
        }
        if (!same) throw new ApiFailure("unauthorized", "wrong passcode");
      }
      const bucket: LinkBucket = c.env.BUCKET;
      const object = await bucket.get(linkKey(linkId));
      if (object === null) throw new ApiFailure("not_found", "no such link");
      await db.prepare("UPDATE links SET views = views + 1 WHERE id = ?").bind(linkId).run();
      return new Response(object.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(object.size),
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    });
}
```

What the routes do:
- `POST /v1/links` (signed, `idempotent`): an owner or editor of an active membership stores the link row (`blob_key` = `links/<id>/data`, `passcode_hash` or null, `expires_at` or null, `created_by`, `created_at`), then the locked data in R2. 201 `{ id, group_id, has_passcode, expires_at, created_at }`. The data must be locked content with key version 0 (`contentKeyVersion`), 33 bytes to 4 MiB.
- `DELETE /v1/links/:id` (signed, `idempotent`): the link's maker or an owner of its group sets `revoked_at` (once) and deletes the R2 object. 200 `{ id, revoked_at }`; again → the same `revoked_at`.
- `GET /v1/links/:id/data` (public): in this order: rate limit `LINK_VIEWS` by link id (429, `retry_after` 60); unknown → 404 "no such link", revoked → 404 "link revoked", expired → 404 "link expired"; for a passcode link: no passcode or no Turnstile token → 401 "passcode required", then `LINK_PASSCODES` by `<link id>:<CF-Connecting-IP>` (429, `retry_after` 60), then Turnstile (403 "challenge failed"), then the peppered hash compared in constant time (401 "wrong passcode"); then the bytes as `application/octet-stream` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and `views` + 1.

`apps/api/src/auth/session.ts`: the link data path is public. Under `const PUBLIC_PATHS = ...` add exactly:

```ts
// The shared-link web viewer reads a link's locked data without signing in (PR 30).
const PUBLIC_PATTERNS = [/^GET \/v1\/links\/[A-Za-z0-9_-]{22,64}\/data$/];
```

and replace the line `if (PUBLIC_PATHS.has(`${c.req.method} ${c.req.path}`)) return next();` with exactly:

```ts
    const route = `${c.req.method} ${c.req.path}`;
    if (PUBLIC_PATHS.has(route) || PUBLIC_PATTERNS.some((pattern) => pattern.test(route))) return next();
```

`apps/api/src/env.ts`: add to `Env`:

```ts
  LINK_PASSCODE_PEPPER: string; // secret: wrangler secret put LINK_PASSCODE_PEPPER (32 random bytes, base64url)
  TURNSTILE_SECRET_KEY: string; // secret: wrangler secret put TURNSTILE_SECRET_KEY
  LINK_VIEWS: RateLimit;
  LINK_PASSCODES: RateLimit;
```

`apps/api/wrangler.jsonc`: add a top-level `ratelimits` block (after `triggers`), exactly:

```jsonc
  "ratelimits": [
    { "name": "LINK_VIEWS", "namespace_id": "1001", "simple": { "limit": 120, "period": 60 } },
    { "name": "LINK_PASSCODES", "namespace_id": "1002", "simple": { "limit": 10, "period": 60 } }
  ],
```

The two secrets are never in `vars` or the repo (owner setup below).

`apps/api/src/app.ts`: `import { linkRoutes } from "./links/routes.ts";` and `app.route("/", linkRoutes({ now: deps.now, fetch: (input, init) => fetch(input, init) }));`.

Tests (`packages/contracts/test/links.test.ts`): `LinkIdSchema` accepts 22 and 64 characters and rejects 21; `LinkDataSchema` rejects 43 characters and `=` padding; `LinkPasscodeSchema` accepts `"1234"` and `"a!b~"`, rejects `"123"`, a 65-character string, `"12 34"` and `"päss"`; `CreateLinkRequestSchema` rejects an extra key and a missing `passcode` (it must be present, `null` for none).

Tests (`apps/api/test/links.test.ts`). The bucket is a `Map` stand-in (`put` stores the bytes, `get` returns `{ body: new Response(bytes).body, size }` or null, `delete` removes); the limiters are `{ limit: async ({ key }) => { keys.push(key); return { success: allow }; } }`; `fetch` is a stub that records its calls and answers `Response.json({ success: <token === "good"> })`; `LINK_PASSCODE_PEPPER` is `toBase64Url(new Uint8Array(32).fill(9))`. Fixture: group `g` with `u1` owner, `u2` editor, `u3` viewer, approved devices. Data is `lockContent(key, 0, context("link", id), plaintext, nonce)`. The public route is called on a fresh app with no user middleware. One bullet one test:
- Compile-time checks: `export const bucketFits: (bucket: R2Bucket) => LinkBucket = (bucket) => bucket;` and `export const limiterFits: (limiter: RateLimit) => { limit(options: { key: string }): Promise<{ success: boolean }> } = (limiter) => limiter;`.
- `u2` creates a link without a passcode → 201, passes `LinkViewSchema` with `has_passcode: false`; the bucket holds the bytes at `links/<id>/data`; the row has `blob_key`, `created_by` `u2`, `created_at` NOW, `views` 0, `passcode_hash` null.
- With passcode `"1234"` → `has_passcode: true` and `passcode_hash` equals `await linkPasscodeHash(pepper bytes, id, "1234")`; no column of the row holds `"1234"`.
- `u3` (viewer) → 403; a non-member → 404; the same id twice (different Idempotency-Keys) → 409 "link id taken".
- Data locked with key version 1 → 400; data of 32 bytes → 400; `expires_at` NOW → 400.
- A pepper that is not 32 bytes and a passcode → 500 `internal` "link passcodes unavailable", no row.
- A bucket whose `put` throws → 500 and no row is left.
- The same request with the same Idempotency-Key → the stored reply; the bucket was written once.
- Create and delete without a signature → 401.
- `u2` deletes their own link → 200 `{ id, revoked_at: NOW }` (passes `LinkRevokedSchema`), the object is gone; again → 200 with the same `revoked_at`.
- `u1` (owner) deletes `u2`'s link → 200; `u2` (editor) deletes `u1`'s link → 403; a non-member → 404; an unknown id → 404.
- Data of a link without a passcode → 200, the exact bytes, `application/octet-stream`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; `views` is 1; `LINK_VIEWS` was called with the link id; no Turnstile call.
- A revoked link → 404 "link revoked"; an expired one (`expires_at` NOW) → 404 "link expired"; an unknown id → 404 "no such link"; a 21-character id → 404; `views` unchanged.
- `LINK_VIEWS` saying no → 429 `rate_limited` with `retry_after` 60 and `Retry-After: 60`; D1 not read for the link.
- A passcode link without the passcode header, or without the Turnstile header → 401 "passcode required"; no Turnstile call; `views` unchanged.
- Right passcode, token `"good"` → 200 and the bytes; the Turnstile call went to `SITEVERIFY_URL` with JSON `{ secret, response: "good", remoteip }` when `CF-Connecting-IP` is set; `LINK_PASSCODES` was called with `<id>:<ip>`.
- Right passcode, token `"bad"` → 403 "challenge failed"; a stub that throws, or answers 500, or answers `{}` → 403.
- Wrong passcode `"9999"`, token `"good"` → 401 "wrong passcode"; a passcode with a space → 401 "wrong passcode".
- `LINK_PASSCODES` saying no → 429 with `retry_after` 60; no Turnstile call.
- An object missing from the bucket → 404 "no such link".
- `verifyTurnstile` with an empty token or a 2,049-character token → false without calling `fetch`.

`apps/api/test/session.test.ts` (add, with the test setup that file already uses): `GET /v1/links/<22-character id>/data` without `Authorization` is not refused with "sign in required" (it reaches the route: mount a throwaway `GET /v1/links/:id/data` that returns 200); `GET /v1/links/<id>/data/x`, `POST /v1/links/<id>/data` and `GET /v1/links/<21-character id>/data` without `Authorization` → 401.

Not in this PR: the viewer page (V1), revoking a removed member's links (open question), listing a group's links, a view count endpoint, CORS (the viewer is same-origin).

---

## V1 · `apps/viewer`: the shared-link web viewer (outline; written in full after PR 30)

A static page served by the API Worker itself through Workers static assets (`assets: { directory: "../viewer/dist", not_found_handling: "single-page-application", run_worker_first: ["/v1/*", "/webhooks/*"] }`), so `/l/<id>` gets the viewer's `index.html` and `GET /v1/links/:id/data` is same-origin (no CORS). Plain TypeScript and HTML, no framework, bundled for browsers (the bundler and its pinned version are chosen when the card is written; wrangler already ships esbuild), reusing `@waypoint/crypto`'s `fromBase64Url`, `context` and `unlockContent` on WebCrypto. On load it reads `#k=<43 characters>` from the fragment, removes the fragment from the address bar with `history.replaceState`, keeps the key only in memory, fetches the data, and unlocks it with `context("link", id)`; a key or tag that fails shows "This link is incomplete". It draws board M1 and M2 ("Private link · Only people with this link can read this page."), and the states for 404 "link revoked", "link expired" and "no such link", 429 (wait and retry), and 401 "passcode required" / "wrong passcode": a passcode field plus the Turnstile widget (site key baked in at build time), sending `Waypoint-Link-Passcode` and `Waypoint-Turnstile`, with a fresh widget token for each attempt. A `_headers` file sets a strict CSP (`default-src 'self'`; scripts and frames only from `'self'` and `https://challenges.cloudflare.com`; `connect-src 'self'`), `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`. No other third-party script, font or analytics. Needs decided first: the plaintext format of link data (shared with the app's share bundle, M29) and the Turnstile question below.

---

## Open questions for the product owner

Also in "Open questions" in `docs/build-plan.md` (37 to 45, and 34 for the socket check), merged with the jobs and mobile questions.

1. **Deleting media.** There is no `DELETE /v1/blobs/:id` in the architecture, so the 3 GB a person has uploaded only grows. Add the endpoint (uploader or owner; frees the size) before media sync ships? The same goes for snapshots and compaction of the change log (`groups/{group}/snap/{seq}`), which no card builds yet.
2. **Turnstile next to the link key** [R10]. `docs/security.md` says the viewer loads no third-party scripts, but Turnstile's widget script must run in the page, which holds the link key in memory. V1 loads it only for passcode links. Cloudflare already serves the page, so it is arguably not a new party; the stricter option is a Turnstile page on a separate origin in an iframe that posts the token back. For the security reviewer.
3. **Media in shared groups for free members.** A free member can download what a paid member uploaded (only uploading needs a paid plan). Keep that?
4. **A removed member's shared links** keep working (board I7 has "Remove his shared links"). Revoke them on removal, or leave it to the toggle (a later card)?
5. **Group deletion, role changes and the last member.** Not built: an owner cannot delete a group or change a member's role, and the last member cannot leave.
6. **Member names.** The server knows members only by user id. Show names by having each member post a locked "profile" change in the group, or another way?
7. **Invite tokens in the URL path.** `POST /v1/invites/:token/accept` puts the token in the path, which Workers observability may log. Tokens are single use and last 7 days. Move the token into the body?
8. **Old key version race.** A change checked against the key version in D1 just before a removal's batch commits can still be stored with the old version (a window of milliseconds). Acceptable, or should the room also remember the newest key version?
9. **Rate limits are per Cloudflare location and approximate,** and passcode attempts are counted per link and IP address, so a class behind one school address shares 10 attempts a minute per link.
10. **Server-closed sockets** stayed `CLOSING` on the client in `wrangler dev` (see "What was checked"); confirm on staging.
11. **Migration numbers** (settled): PR 20 takes `0006_jobs.sql`; these cards take `0007` to `0009`.

## What the owner sets up

All of it is in "Owner setup" in `docs/build-plan.md`.

- **Link passcode pepper:** `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put LINK_PASSCODE_PEPPER`. Rotating it makes every existing passcode stop working.
- **Turnstile:** a widget in the Cloudflare dashboard for the API host (the viewer is served from it). Its secret key with `npx wrangler secret put TURNSTILE_SECRET_KEY`; its site key goes into the V1 build. Tests use Cloudflare's dummy keys and never call Cloudflare.
- **Rate limit namespaces** `1001` and `1002` must be unused by other Workers in the account; change the numbers in `wrangler.jsonc` if they are taken.
- **No R2 API token:** media goes through the Worker (PR 29), and so does PR 23's second-transcript upload.
- **Zone plan:** files are capped at 95,000,000 bytes because a Free or Pro zone accepts request bodies up to 100 MB; a Business zone (200 MB) would allow larger files later.

## Placement in the build order

In "Build order" in `docs/build-plan.md`: PR 27 Part A and B (after S1A, merged) in batch 6; PR 28 Part A (any time) in batch 6; PR 28 Part B (after 27 and 28 Part A; merge after S2), PR 29 (after 27 Part A) and PR 30 (after 27 Part A; merge after PR 29) in batch 7; V1 after PR 30. Migrations `0007_groups.sql`, `0008_blobs.sql`, `0009_links.sql`.
