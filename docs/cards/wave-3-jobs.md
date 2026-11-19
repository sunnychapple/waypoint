# Wave 3 cards: jobs and device pushes (S1F, PR 20, PR 21)

These cards follow `AGENTS.md`, the wave 2 rules (top of "Wave 2" in `docs/build-plan.md`), the wave 3 notes ("Notes the wave 3 cards must carry") and "Conventions for the cards still to write". In short: files only where the card says, no `node:` imports in `apps/api/src`, tests through `app.request` with hand-made `env` objects, no network, no Miniflare, and run `npm install`, `npm run typecheck`, `npm test` and `npm run bundle -w @waypoint/api` from the repo root before opening the pull request and paste the last lines of each. No card here adds a dependency.

| Card | Branch | Branch from `main` after | Sittings |
|---|---|---|---|
| PR 20 | `pr/20-jobs` | S1A, S4, PR 31, PR 33 (all merged) | Part A, commit and push; then Part B |
| PR 21 | `pr/21-job-events` | PR 20 | one |
| S1F | `pr/s1f-device-pushes` | S1D and PR 20 (PR 20 Part A adds `sendPush`) | one |

Where they go in "Build order" (`docs/build-plan.md`): PR 20 in batch 6 now; S1F in batch 6 once S1D is merged; PR 21 in batch 7. Migration number: PR 20 adds `0006_jobs.sql`, the next free number on `main` when this was written. If another card has merged a `0006` first, rename to the next free number and change nothing else.

Every code block marked "exactly" was built and run against `main` at `57d1577` (typecheck, every test, `npm run bundle -w @waypoint/api`). Copy those blocks as they are. Code not marked "exactly" may differ in style, not in behaviour.

## What was checked during planning

- **Workflows types** (`@cloudflare/workers-types` 5.20261118.1, already in `apps/api`): `WorkflowStep` (from `cloudflare:workers`) is assignable to the small `JobStep` type below, `Workflow<JobParams>` to `JobWorkflow`, `R2Bucket` to `JobBucket`, `Queue<PushMessage>` to `PushQueue` (compile-time checks in the tests). `create()` takes `{ id, params, retention: { successRetention, errorRetention } }`; the instance has `terminate()`, `status()` and `delete()`.
- **A Workflow ran for real.** A throwaway Workflow class using `runJob` below, with a `workflows` block in `wrangler.jsonc`, ran under `wrangler dev` (wrangler 4.164.0) against local D1, R2 and the Wallet Durable Object: the job went queued, running, succeeded; the result was sealed in R2 (97 bytes for an 18-byte text) and opened with the device key; the locked input was deleted; the hold was settled. The step results Workflows stored were the job row (ids and numbers), `{ ok, actual, tokens_in, tokens_out }` and `"succeeded"`: no text. `npm run bundle` passes with a Workflow class exported.
- **A Workflow class exported from `src/index.ts` breaks `test/scheduled.test.ts`**, which mocks `cloudflare:workers` with only `DurableObject`. The first workflow card adds `WorkflowEntrypoint: class {}` to that mock (step 6 of "How PR 22 to 25 plug in").
- **Server-sent events in Hono** (`streamSSE` from `hono/streaming`, as in PR 14): `stream.write(": keep-alive\n\n")` writes a comment line; `streamSSE` sets `Content-Type: text/event-stream` and `Cache-Control: no-cache` itself; the stream closes when the callback returns.
- **S1F:** its three edits were applied to the merged S1B and S1C files and to S1D's `remove.ts` built from its card (`docs/cards/security.md`); the existing device and pairing tests still passed unchanged, and the register, approve and waiting-device removal tests below passed.
- **R2 get for the result:** `R2ObjectBody` gives `body` (a stream) and `size`; the route streams `body` straight back.
- Cloudflare docs read on 19 Nov 2026 ([Workers API for Workflows](https://developers.cloudflare.com/workflows/build/workers-api/)): an instance id is at most 100 characters, `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`, and `create` with an id still inside its retention throws; `retention` takes a duration such as `"1 day"`; default retention on Workers Paid is 7 days; `terminate()` throws on a finished instance; Workflows keep `params` and every step's return value until retention ends, and show them in the dashboard (a step marked `sensitive: "output"` is only redacted when read through the API, not left unstored).

## Decisions these cards make

Recorded in `docs/architecture.md` sections 4 and 5 by this planning pull request.

1. **The job id comes from the request.** `job_` + base64url of the first 16 bytes of SHA-256(`context("job-id", user id, Idempotency-Key)`): 26 characters, a valid Workflow instance id and push `ref`. A request whose stored reply was lost (the PR 11 row died while pending) finds its own job on the next try instead of holding twice.
2. **Job text is never stored readable, and never in Workflows.** `POST /v1/jobs` locks the text (and research question) with a new random 32-byte key, `lockContent(key, 0, context("job-input", job id), …)` from `@waypoint/crypto`, and stores it at R2 `tmp/input/{job}`. Only the key goes into the Workflow's `params`. The generate step reads it back, writes the result and seals it in the same step; the object is deleted when the job ends (or is cancelled), and the hourly cleanup deletes any left after 24 hours. Neither store alone can read the text; after the job, nothing can. Instances are created with `retention` 1 day.
3. **Route before money.** Each job type has a fixed tier (`routes.fixed`), so the route is picked before anything is held. A zero-retention user with no zero-retention route for the type gets 403 `forbidden` "no zero-retention route for this task" with nothing held and no model called. `retranscribe` always uses Whisper (`@cf/openai/whisper-large-v3-turbo`), which is not confirmed zero-retention, so a zero-retention user gets 403 for it too (open question 2 below).
4. **Money.** Hold the quoted price (`quoteCredits`) with command id `job:<user id>:<Idempotency-Key>`, `expires_at` = deadline + `HOLD_MARGIN_MS`, deadline = now + `JOB_TIME_LIMIT_MS[type]`. When the result is sealed, settle at min(actual, quoted) (`job_settle:…`); on any failure release (`job_release:…`). A hold can be settled or released, never both, so the wallet decides a race between a cancel and a finishing job. **Cancelling** a queued or running job releases its hold: nothing is charged. Deleting a finished job keeps its charge. A job whose device was removed mid-job cannot be sealed, so it fails and nothing is charged (answers open question 13 in `docs/build-plan.md` for now).
5. **States.** `queued` (row written, Workflow created) → `running` (the Workflow's first step) → `succeeded` | `failed` | `cancelled`. A queued or running job past its deadline + `HOLD_MARGIN_MS` is shown as `failed`, whatever the row says (its hold has expired). `succeeded` sets `expires_at` = finish + 7 days, when the hourly cleanup deletes the result.
6. **Usage events.** One per job, `id` = the hold id, `router: "skipped"`, `tier`/`model` from the job's route, `bytes_sent` from `jobs.bytes_sent`. `UsageEvent.outcome` gains `"cancelled"` (credits 0); the consumer's schema follows. A late duplicate is harmless: the consumer keeps the first event per id.
7. **The result goes to one device.** `GET /v1/jobs/:id/result` is signed (S1A) and answers only when the signing device is `jobs.device_id`; anything else is 404, the same as no result. This is stricter than "only the job's user" in `docs/security.md` section 15 and changes nothing there: only that device can open the sealed bytes anyway.
8. **Pushes.** A finished job sends `job_ready` to `jobs.device_id` (none if that is null). A failed or cancelled job sends no push (there is no push kind for it); the app learns from the events stream or `GET /v1/jobs/:id`. `sendPush` never sends a message the push consumer would drop (an id outside `PushMessageSchema`), and never fails the request.
9. **The events stream** polls the jobs row every 2 s, sends a `state` event (the `JobView`) only when the state, `spent` or `result_ready` changes, writes a keep-alive comment after 20 s without one, and ends after a finished state or 10 minutes. The app opens a new stream if the job is still going.
10. **A job type whose Workflow card is not merged yet** gets 400 `bad_request` "job type not available" before anything is held. After PR 20 alone, every type answers that.

## How PR 22 to 25 plug in

PR 20 starts and stops Workflows only through `JobWorkflow` and the registry `jobWorkflow` in `src/jobs/workflows.ts`, and runs a job only through `runJob` in `src/jobs/run.ts`. A workflow card adds exactly these, and touches no other PR 20 file:

1. **The generator**, in a plain module tested in Node, for example `src/jobs/overview.ts`:
   ```ts
   export async function writeOverview(env: Env, job: JobRow, input: JobInput | null): Promise<Generated>
   ```
   It calls the models with `job.model` (the route PR 20 picked; the generator may read `env.CONFIG` for extra routes, as research's light reads) through AI Gateway with `gatewayOptions`, stops calling models once `Date.now() > job.deadline_at`, and returns `{ plaintext, actual, tokens_in, tokens_out }`: the UTF-8 bytes of the result, the credits to settle (the quote, or less, for example the real minutes of a second transcript), and token counts summed over every model call. It never logs, stores or returns text any other way: `runJob` seals `plaintext` inside the same step and zeroes it.
2. **The Workflow class**, thin, in its own file that tests never import, for example `src/jobs/overview-workflow.ts`:
   ```ts
   import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
   import type { Env } from "../env.ts";
   import { jobDeps } from "./job.ts";
   import { writeOverview } from "./overview.ts";
   import { runJob } from "./run.ts";
   import type { JobParams } from "./workflows.ts";

   export class OverviewWorkflow extends WorkflowEntrypoint<Env, JobParams> {
     override async run(event: Readonly<WorkflowEvent<JobParams>>, step: WorkflowStep): Promise<void> {
       await runJob(jobDeps(this.env, Date.now), event.payload, step, (job, input) => writeOverview(this.env, job, input));
     }
   }
   ```
3. **`src/env.ts`:** one line, `OVERVIEW_WORKFLOW: Workflow<JobParams>;` with `import type { JobParams } from "./jobs/workflows.ts";` (the first card adds the import).
4. **`apps/api/wrangler.jsonc`:** the first workflow card adds one block, later ones add one entry each:
   ```jsonc
   "workflows": [{ "name": "waypoint-overview", "binding": "OVERVIEW_WORKFLOW", "class_name": "OverviewWorkflow" }],
   ```
5. **`src/index.ts`:** `export { OverviewWorkflow } from "./jobs/overview-workflow.ts";` under the Durable Object exports.
6. **`test/scheduled.test.ts`:** the first workflow card changes its mock to `vi.mock("cloudflare:workers", () => ({ DurableObject: class {}, WorkflowEntrypoint: class {} }));`.
7. **`src/jobs/workflows.ts`:** one `case` line in `jobWorkflow`, `case "overview_script": return env.OVERVIEW_WORKFLOW;`.
8. A card may change its own type's value in `JOB_TIME_LIMIT_MS` (`src/jobs/job.ts`), one line, if its card says why.
9. **Tests** call the generator with stand-ins (`makeTaskEnv`-style AI stubs) and run it through `runJob` with `fakeStep()` and `makeJobsWorld()` from `test/helpers/jobs.ts`; they check that no step result (`fakeStep().results`) contains the source text or the result text.

`retranscribe` (PR 23) also: adds an `upload` object (its signed URL to `tmp/audio/{job}`) to the `POST /v1/jobs` reply for that type and extends `JobResponseSchema` to allow it; waits for the upload inside its Workflow; sets `jobs.bytes_sent` to the audio size before `finishJob` runs. `finishJob` and `cancelJob` already delete `tmp/audio/{job}`. A generator that needs more than one durable step (research, PR 24) may call `startJob` and `finishJob` itself instead of `runJob`, as long as no step returns text.

---

## PR 20 · Jobs API

Branch `pr/20-jobs`. Builds on S1A, S4, PR 31 and PR 33 (all merged). No new dependencies. Two sittings on the same branch: Part A (the jobs core, no routes), commit and push; then Part B (the routes).

What the four endpoints do, in short:

- `POST /v1/jobs` (signed, idempotent): check the body; load config; find the type's Workflow (400 if none yet); pick the route (403 for zero retention without one); price it; if this request already made its job, reply with it; hold the price; lock the text into R2; write the jobs row (`queued`, with `device_id` from the signature); create the Workflow instance; reply 201 `{ job }`.
- `GET /v1/jobs/:id` (session): 200 `{ job }` for the user's own job, else 404.
- `GET /v1/jobs/:id/result` (signed, never stored): the sealed bytes from R2 `results/{job}` as `application/octet-stream`, only to the job's device and only when the job succeeded.
- `DELETE /v1/jobs/:id` (signed, idempotent): stop and release a queued or running job (`cancelled`, nothing charged), keep a finished job's charge, delete the result, the locked input and any uploaded audio; reply 200 `{ job }`.

### Part A

Files: `packages/contracts/src/jobs.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/jobs.test.ts`, `db/d1/migrations/0006_jobs.sql`, `db/d1/test/schema.test.mjs`, `apps/api/src/usage.ts`, `apps/api/src/usage-consumer.ts`, `apps/api/src/push/messages.ts`, `apps/api/src/cleanup.ts`, `apps/api/src/jobs/job.ts`, `apps/api/src/jobs/workflows.ts`, `apps/api/src/jobs/run.ts`, `apps/api/test/helpers/jobs.ts`, `apps/api/test/jobs-core.test.ts`, `apps/api/test/usage.test.ts` (one test), `apps/api/test/push.test.ts` (new tests), `apps/api/test/cleanup.test.ts` (two lines and one test). No other files.

`packages/contracts/src/jobs.ts`, exactly:

```ts
import { z } from "zod";
import { JOB_TYPES, RESEARCH_DEPTHS } from "./tasks.ts";

// Limits on the text a job may send. Three hours of speech is about 160,000 characters.
export const JOB_TEXT_MAX_CHARS = 200_000;
export const JOB_QUESTION_MAX_CHARS = 1_000;

const text = z.string().trim().min(1).max(JOB_TEXT_MAX_CHARS);

// POST /v1/jobs. The text is the part of a note the person chose to send; the server never stores it readable
// (it is locked in R2 tmp/input/{job} until the job ends). retranscribe sends no text: its audio is uploaded
// after the job is made (PR 23).
export const CreateJobRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("research"),
    depth: z.enum(RESEARCH_DEPTHS),
    question: z.string().trim().min(1).max(JOB_QUESTION_MAX_CHARS),
    text: text.optional(),
  }),
  z.strictObject({ type: z.literal("overview_script"), text, fallback_voice: z.boolean().optional() }),
  z.strictObject({ type: z.literal("video_slides"), text, fallback_voice: z.boolean().optional() }),
  z.strictObject({ type: z.literal("diagram"), text }),
  z.strictObject({ type: z.literal("mini_app"), text }),
  z.strictObject({ type: z.literal("practice"), text }),
  z.strictObject({ type: z.literal("retranscribe"), minutes: z.number().gt(0).max(600) }),
]);

export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

export const JOB_STATES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobState = (typeof JOB_STATES)[number];

const time = z.number().int().min(0);

// A job as the app sees it. No content: the result is fetched sealed from GET /v1/jobs/:id/result.
export const JobViewSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  type: z.enum(JOB_TYPES),
  state: z.enum(JOB_STATES),
  quoted: z.number().int().min(1),
  spent: z.number().int().min(0).nullable(),
  tier: z.enum(["light", "standard", "strong"]),
  retention: z.enum(["standard", "zero"]),
  result_ready: z.boolean(),
  created_at: time,
  finished_at: time.nullable(),
  expires_at: time.nullable(),
});

export type JobView = z.infer<typeof JobViewSchema>;

// The reply to POST, GET and DELETE /v1/jobs/:id, and the data of each "state" event of GET /v1/jobs/:id/events.
export const JobResponseSchema = z.strictObject({ job: JobViewSchema });
export type JobResponse = z.infer<typeof JobResponseSchema>;
```

`packages/contracts/src/index.ts`: add `export * from "./jobs.ts";` (no name clashes; checked).

`db/d1/migrations/0006_jobs.sql`, exactly:

```sql
-- What a running job needs after POST /v1/jobs has replied (PR 20). Ids, sizes, route and times only; never the
-- text sent or the result.
-- The request's Idempotency-Key. The wallet ids are job:<user id>:<key>, job_settle:<user id>:<key>, job_release:<user id>:<key>.
ALTER TABLE jobs ADD COLUMN command_key TEXT;
-- The model that writes the result (jobs.route is its tier) and the retention of that route.
ALTER TABLE jobs ADD COLUMN model TEXT;
ALTER TABLE jobs ADD COLUMN retention TEXT CHECK (retention IN ('standard', 'zero'));
-- UTF-8 bytes of the text sent (for retranscribe, the audio bytes, set by its workflow).
ALTER TABLE jobs ADD COLUMN bytes_sent INTEGER NOT NULL DEFAULT 0;
-- Work stops at this time; the wallet hold expires HOLD_MARGIN_MS later.
ALTER TABLE jobs ADD COLUMN deadline_at INTEGER;
ALTER TABLE jobs ADD COLUMN finished_at INTEGER;
```

`db/d1/test/schema.test.mjs`: in `EXPECTED.jobs` append `"command_key", "model", "retention", "bytes_sent", "deadline_at", "finished_at"` after `"device_id"`; in `EXPECTED_TYPES.jobs` append `command_key: "TEXT?", model: "TEXT?", retention: "TEXT?", bytes_sent: "INTEGER", deadline_at: "INTEGER?", finished_at: "INTEGER?"`; add at the end, exactly:

```js
test("rejects a bad jobs.retention; jobs.bytes_sent defaults to 0", () => {
  const db = freshDb();
  seedUser(db);
  assert.throws(
    () =>
      db.prepare(
        "INSERT INTO jobs (id, user_id, type, state, quoted, created_at, retention) VALUES ('j1', 'u1', 'research', 'queued', 5, 1, 'forever')",
      ).run(),
    /CHECK constraint failed/,
  );
  db.prepare("INSERT INTO jobs (id, user_id, type, state, quoted, created_at) VALUES ('j2', 'u1', 'research', 'queued', 5, 1)").run();
  assert.equal(db.prepare("SELECT bytes_sent FROM jobs WHERE id = 'j2'").get().bytes_sent, 0);
});
```

`apps/api/src/usage.ts`: replace the `outcome` line of `UsageEvent` with exactly:

```ts
  // cancelled: the person cancelled a job (DELETE /v1/jobs/:id) before it finished; nothing is charged.
  outcome: "ok" | "model_failed" | "cancelled";
```

`apps/api/src/usage-consumer.ts`: in `UsageEventSchema`, `outcome: z.enum(["ok", "model_failed", "cancelled"]),`. Nothing else.

`apps/api/src/push/messages.ts`: add after the `PushMessage` type, exactly:

```ts
// The part of the push queue binding producers use. Queue<PushMessage> satisfies this type.
export type PushQueue = { send(message: PushMessage): Promise<unknown> };

// A push only nudges the app, so losing one never fails the request that caused it. A message the consumer would
// drop (an id outside the schema's limits) is not sent.
export async function sendPush(queue: PushQueue, message: PushMessage): Promise<void> {
  if (!PushMessageSchema.safeParse(message).success) return;
  try {
    await queue.send(message);
  } catch {
    // Dropped; the app still sees the change the next time it asks.
  }
}
```

`apps/api/src/cleanup.ts`: add `TMP_INPUT_KEEP_MS` and the `tmp/input/` pass, exactly as this diff (the return value gains `tmp_input`):

```diff
@@ -4,2 +4,4 @@ export const RESULTS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
 export const TMP_AUDIO_KEEP_MS = 24 * 60 * 60 * 1000;
+// Locked job input (PR 20). A job deletes its own when it ends; this catches the ones whose job never ended.
+export const TMP_INPUT_KEEP_MS = 24 * 60 * 60 * 1000;
 export const IDEMPOTENCY_ROWS_KEEP_MS = 24 * 60 * 60 * 1000;
@@ -46,5 +48,6 @@ export async function cleanup(
   now: number,
-): Promise<{ results: number; tmp_audio: number; idempotency: number; request_nonces: number }> {
+): Promise<{ results: number; tmp_audio: number; tmp_input: number; idempotency: number; request_nonces: number }> {
   const results = await deleteOlderThan(env.BUCKET, "results/", now - RESULTS_KEEP_MS);
   const tmpAudio = await deleteOlderThan(env.BUCKET, "tmp/audio/", now - TMP_AUDIO_KEEP_MS);
+  const tmpInput = await deleteOlderThan(env.BUCKET, "tmp/input/", now - TMP_INPUT_KEEP_MS);
   const idempotency = await env.DB.prepare("DELETE FROM idempotency WHERE created_at < ?").bind(now - IDEMPOTENCY_ROWS_KEEP_MS).run();
@@ -52,3 +55,3 @@ export async function cleanup(
   const nonces = await env.DB.prepare("DELETE FROM request_nonces WHERE expires_at < ?").bind(now).run();
-  return { results, tmp_audio: tmpAudio, idempotency: idempotency.meta.changes, request_nonces: nonces.meta.changes };
+  return { results, tmp_audio: tmpAudio, tmp_input: tmpInput, idempotency: idempotency.meta.changes, request_nonces: nonces.meta.changes };
 }
```

`apps/api/src/jobs/job.ts`, exactly. The jobs core: limits, ids, the row and its view, the locked input, and the two functions that end a job (`finishJob` from a Workflow, `cancelJob` from `DELETE`).

```ts
import type { JobState, JobType, JobView } from "@waypoint/contracts";
import { context, fromBase64Url, importContentKey, lockContent, sha256, toBase64Url, unlockContent, utf8 } from "@waypoint/crypto";
import type { Tier } from "@waypoint/router";
import type { WalletCommands } from "../apple/purchases.ts";
import { RESULTS_KEEP_MS } from "../cleanup.ts";
import type { Env } from "../env.ts";
import { sendPush, type PushQueue } from "../push/messages.ts";
import type { Db } from "../storage.ts";
import { HOLD_MARGIN_MS } from "../tasks/instant.ts";
import { sendUsage, type UsageQueue } from "../usage.ts";

const MINUTE = 60_000;

// How long each job may run. The hold lives this long plus HOLD_MARGIN_MS (decision D3); work stops at the deadline.
export const JOB_TIME_LIMIT_MS: Record<JobType, number> = {
  research: 20 * MINUTE,
  overview_script: 10 * MINUTE,
  video_slides: 10 * MINUTE,
  diagram: 5 * MINUTE,
  mini_app: 10 * MINUTE,
  practice: 5 * MINUTE,
  retranscribe: 60 * MINUTE,
};

// The second transcript is not routed by tier (architecture section 2). Its usage events say tier "light".
export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

// The parts of R2 the jobs code uses. R2Bucket satisfies this type, and so does sealJobResult's ResultBucket.
export type JobBucket = {
  get(key: string): Promise<{ body: ReadableStream; size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: Uint8Array, options?: { customMetadata: Record<string, string> }): Promise<unknown>;
  delete(keys: string[]): Promise<void>;
};

// Everything that ends a job needs. Built from the Worker's env by jobDeps; tests build it by hand.
export type JobDeps = {
  db: Db;
  bucket: JobBucket;
  wallet: (billingAccountId: string) => WalletCommands;
  usage: UsageQueue;
  push: PushQueue;
  now: () => number;
};

export function jobDeps(env: Env, now: () => number): JobDeps {
  return {
    db: env.DB,
    bucket: env.BUCKET,
    wallet: (billingAccountId) => env.WALLET.get(env.WALLET.idFromName(billingAccountId)),
    usage: env.USAGE_QUEUE,
    push: env.PUSH_QUEUE,
    now,
  };
}

export type JobRow = {
  id: string;
  user_id: string;
  billing_account_id: string;
  type: JobType;
  state: JobState;
  quoted: number;
  spent: number | null;
  route: Tier;
  model: string;
  retention: "standard" | "zero";
  bytes_sent: number;
  result_key: string | null;
  device_id: string | null;
  command_key: string;
  created_at: number;
  deadline_at: number;
  finished_at: number | null;
  expires_at: number | null;
};

const JOB_COLUMNS =
  "j.id, j.user_id, u.billing_account_id, j.type, j.state, j.quoted, j.spent, j.route, j.model, j.retention, j.bytes_sent, j.result_key, j.device_id, j.command_key, j.created_at, j.deadline_at, j.finished_at, j.expires_at";

// One job, or null. With userId, only that user's job.
export async function loadJob(db: Db, jobId: string, userId?: string): Promise<JobRow | null> {
  const where = userId === undefined ? "j.id = ?" : "j.id = ? AND j.user_id = ?";
  const values = userId === undefined ? [jobId] : [jobId, userId];
  return db
    .prepare(`SELECT ${JOB_COLUMNS} FROM jobs j JOIN users u ON u.id = j.user_id WHERE ${where}`)
    .bind(...values)
    .first<JobRow>();
}

// The job id is made from the user and the Idempotency-Key, so a request that is run again finds its own job.
export async function jobIdFor(userId: string, key: string): Promise<string> {
  const digest = await sha256(context("job-id", userId, key));
  return `job_${toBase64Url(digest.slice(0, 16))}`;
}

// The wallet command ids of a job (op at most 24 characters, docs/build-plan.md "Conventions").
export function jobWalletIds(userId: string, key: string): { hold: string; settle: string; release: string } {
  return { hold: `job:${userId}:${key}`, settle: `job_settle:${userId}:${key}`, release: `job_release:${userId}:${key}` };
}

export const resultObjectKey = (jobId: string): string => `results/${jobId}`;
export const inputObjectKey = (jobId: string): string => `tmp/input/${jobId}`;
export const audioObjectKey = (jobId: string): string => `tmp/audio/${jobId}`;

// A queued or running job whose hold has expired has stopped, whatever its row says.
export function isOverdue(job: Pick<JobRow, "state" | "deadline_at">, now: number): boolean {
  return (job.state === "queued" || job.state === "running") && now > job.deadline_at + HOLD_MARGIN_MS;
}

export function jobView(job: JobRow, now: number): JobView {
  return {
    id: job.id,
    type: job.type,
    state: isOverdue(job, now) ? "failed" : job.state,
    quoted: job.quoted,
    spent: job.spent,
    tier: job.route,
    retention: job.retention,
    result_ready: job.state === "succeeded" && job.result_key !== null && (job.expires_at === null || now < job.expires_at),
    created_at: job.created_at,
    finished_at: job.finished_at,
    expires_at: job.expires_at,
  };
}

// What the person sent with the job. Only ever held in memory or locked.
export type JobInput = { text: string | null; question: string | null };

// Locks the input with a new random key and stores it at tmp/input/{job}. Returns the key (base64url), which goes
// only into the Workflow's params. The R2 object alone and the params alone are unreadable; the object is deleted
// when the job ends (and by the hourly cleanup after 24 hours).
export async function lockJobInput(bucket: JobBucket, jobId: string, input: JobInput): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = utf8(JSON.stringify(input));
  try {
    const key = await importContentKey(raw);
    const locked = await lockContent(key, 0, context("job-input", jobId), plaintext, crypto.getRandomValues(new Uint8Array(12)));
    await bucket.put(inputObjectKey(jobId), locked);
    return toBase64Url(raw);
  } finally {
    raw.fill(0);
    plaintext.fill(0);
  }
}

// Reads the locked input back. Call it only inside the Workflow step that writes and seals the result.
export async function readJobInput(bucket: JobBucket, jobId: string, keyText: string): Promise<JobInput> {
  const object = await bucket.get(inputObjectKey(jobId));
  if (object === null) throw new Error("job input missing");
  const key = await importContentKey(fromBase64Url(keyText));
  const plaintext = await unlockContent(key, context("job-input", jobId), new Uint8Array(await object.arrayBuffer()));
  const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  plaintext.fill(0);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("text" in parsed) ||
    !("question" in parsed) ||
    (parsed.text !== null && typeof parsed.text !== "string") ||
    (parsed.question !== null && typeof parsed.question !== "string")
  ) {
    throw new Error("job input unreadable");
  }
  return { text: parsed.text, question: parsed.question };
}

export type JobOutcome =
  | { ok: true; actual: number; tokens_in: number | null; tokens_out: number | null }
  | { ok: false; tokens_in: number | null; tokens_out: number | null };

async function sendJobUsage(deps: JobDeps, job: JobRow, outcome: "ok" | "model_failed" | "cancelled", credits: number, tokens: { tokens_in: number | null; tokens_out: number | null }): Promise<void> {
  await sendUsage(deps.usage, {
    v: 1,
    id: jobWalletIds(job.user_id, job.command_key).hold,
    at: deps.now(),
    user_id: job.user_id,
    task: job.type,
    outcome,
    credits,
    tier: job.route,
    model: job.model,
    retention: job.retention,
    router: "skipped",
    bytes_sent: job.bytes_sent,
    tokens_in: tokens.tokens_in,
    tokens_out: tokens.tokens_out,
  });
}

// Ends a job: settles the hold at min(actual, quoted) when there is a result, else releases it; records the state;
// sends the usage event, and for a result the job_ready push; deletes the locked input. The wallet decides the race
// with a cancel: a hold can be settled or released, never both. Safe to run again (a Workflows step retry).
// Wallet errors are thrown, so the step is retried.
export async function finishJob(deps: JobDeps, jobId: string, outcome: JobOutcome): Promise<JobState> {
  const job = await loadJob(deps.db, jobId);
  if (job === null) {
    await deps.bucket.delete([resultObjectKey(jobId), inputObjectKey(jobId), audioObjectKey(jobId)]);
    return "failed";
  }
  const ids = jobWalletIds(job.user_id, job.command_key);
  const wallet = deps.wallet(job.billing_account_id);
  const now = deps.now();
  if (outcome.ok) {
    const settled = await wallet.apply({ type: "settle", id: ids.settle, hold_id: ids.hold, actual: Math.min(outcome.actual, job.quoted) });
    if (settled.ok && "charged" in settled) {
      await deps.db
        .prepare("UPDATE jobs SET state = 'succeeded', spent = ?, finished_at = ?, expires_at = ? WHERE id = ? AND state IN ('queued', 'running')")
        .bind(settled.charged, now, now + RESULTS_KEEP_MS, job.id)
        .run();
      await deps.bucket.delete([inputObjectKey(job.id), audioObjectKey(job.id)]);
      await sendJobUsage(deps, job, "ok", settled.charged, outcome);
      if (job.device_id !== null) await sendPush(deps.push, { user_id: job.user_id, kind: "job_ready", ref: job.id, device_id: job.device_id });
      return "succeeded";
    }
    // The hold is gone (the job was cancelled, or the hold expired): nothing is charged and the result is not served.
  } else {
    await wallet.apply({ type: "release", id: ids.release, hold_id: ids.hold });
  }
  const { meta } = await deps.db
    .prepare("UPDATE jobs SET state = 'failed', spent = 0, finished_at = ?, result_key = NULL WHERE id = ? AND state IN ('queued', 'running')")
    .bind(now, job.id)
    .run();
  await deps.bucket.delete([resultObjectKey(job.id), inputObjectKey(job.id), audioObjectKey(job.id)]);
  if (meta.changes === 1) await sendJobUsage(deps, job, "model_failed", 0, outcome);
  return meta.changes === 1 ? "failed" : (await loadJob(deps.db, job.id))?.state ?? "failed";
}

// DELETE /v1/jobs/:id. A queued or running job is stopped (stop terminates its Workflow instance; errors ignored)
// and its hold released: nothing is charged. A finished job keeps what it was charged. Either way the result, the
// locked input and any uploaded audio are deleted.
export async function cancelJob(deps: JobDeps, job: JobRow, stop: () => Promise<void>): Promise<void> {
  const now = deps.now();
  if (job.state === "queued" || job.state === "running") {
    await stop().catch(() => undefined);
    const ids = jobWalletIds(job.user_id, job.command_key);
    const released = await deps.wallet(job.billing_account_id).apply({ type: "release", id: ids.release, hold_id: ids.hold });
    if (released.ok) {
      const { meta } = await deps.db
        .prepare("UPDATE jobs SET state = 'cancelled', spent = 0, finished_at = ? WHERE id = ? AND state IN ('queued', 'running')")
        .bind(now, job.id)
        .run();
      if (meta.changes === 1) await sendJobUsage(deps, job, "cancelled", 0, { tokens_in: null, tokens_out: null });
    } else if (isOverdue(job, now)) {
      // The hold expired with the job unfinished.
      await deps.db
        .prepare("UPDATE jobs SET state = 'failed', spent = 0, finished_at = ? WHERE id = ? AND state IN ('queued', 'running')")
        .bind(now, job.id)
        .run();
    }
    // Otherwise the job settled a moment ago; its Workflow marks it succeeded and the credits stay charged.
  }
  await deps.bucket.delete([resultObjectKey(job.id), inputObjectKey(job.id), audioObjectKey(job.id)]);
  await deps.db.prepare("UPDATE jobs SET result_key = NULL WHERE id = ?").bind(job.id).run();
}
```

`apps/api/src/jobs/workflows.ts`, exactly. The one place PR 22 to 25 plug in (see "How PR 22 to 25 plug in"):

```ts
import type { JobType } from "@waypoint/contracts";
import type { Env } from "../env.ts";

// What a job's Workflow instance is started with: the job id and the key of its locked input (null when the job
// sends no text). Everything else is read from the jobs row. Workflows keep params, so never put text here.
export type JobParams = { job_id: string; input_key: string | null };

// Workflows keep an instance's params and step results until its retention ends. A day is enough to look into a
// failed job; the params hold only a key whose locked input is deleted when the job ends.
export const JOB_RETENTION = { successRetention: "1 day", errorRetention: "1 day" } as const;

// The part of a Workflow binding the jobs routes use. Workflow<JobParams> satisfies this type.
export type JobWorkflow = {
  create(options: { id: string; params: JobParams; retention: typeof JOB_RETENTION }): Promise<unknown>;
  get(id: string): Promise<{ terminate(): Promise<void> }>;
};

export type JobWorkflows = (env: Env, type: JobType) => JobWorkflow | null;

// The Workflow that runs each job type, or null while its card (PR 22 to 25) is not merged. Each of those cards adds
// one case here, for example `case "overview_script": return env.OVERVIEW_WORKFLOW;`, and nothing else in this file.
export const jobWorkflow: JobWorkflows = (env, type) => {
  switch (type) {
    default:
      return null;
  }
};
```

`apps/api/src/jobs/run.ts`, exactly. What every job Workflow runs:

```ts
import type { JobState } from "@waypoint/contracts";
import { finishJob, JOB_TIME_LIMIT_MS, loadJob, readJobInput, type JobDeps, type JobInput, type JobOutcome, type JobRow } from "./job.ts";
import { sealJobResult } from "./seal.ts";
import type { JobParams } from "./workflows.ts";

// The part of a Workflow's step object runJob uses. WorkflowStep satisfies this type.
export type JobStep = {
  do<T extends JobStepResult>(name: string, config: JobStepConfig, callback: () => Promise<T>): Promise<T>;
};
export type JobStepResult = JobRow | null | JobOutcome | JobState;
export type JobStepConfig = {
  retries: { limit: number; delay: `${number} seconds`; backoff: "constant" | "linear" | "exponential" };
  timeout: number;
};

// What a job type's generator returns. plaintext is sealed to the device at once and then zeroed; actual is the
// credits to settle (at most the quote); tokens are summed over every model call (null if none reported).
export type Generated = { plaintext: Uint8Array; actual: number; tokens_in: number | null; tokens_out: number | null };
export type JobGenerator = (job: JobRow, input: JobInput | null) => Promise<Generated>;

const FAILED: JobOutcome = { ok: false, tokens_in: null, tokens_out: null };
const QUICK_STEP: JobStepConfig = { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" }, timeout: 60_000 };

// Thrown inside the generate step when the job was cancelled or its deadline passed.
export class JobStopped extends Error {
  constructor() {
    super("job stopped");
    this.name = "JobStopped";
  }
}

// Marks a queued job running. Returns the job if it may run, else null (cancelled, finished, overdue or gone).
export async function startJob(deps: JobDeps, jobId: string): Promise<JobRow | null> {
  await deps.db.prepare("UPDATE jobs SET state = 'running' WHERE id = ? AND state = 'queued'").bind(jobId).run();
  const job = await loadJob(deps.db, jobId);
  if (job === null || job.state !== "running" || deps.now() > job.deadline_at) return null;
  return job;
}

// Runs one job inside a Workflow: start, then ONE step that reads the locked input, generates, seals and returns only
// numbers, then finish. Workflows persist what a step returns, so plaintext never leaves the generate step.
export async function runJob(deps: JobDeps, params: JobParams, step: JobStep, generate: JobGenerator): Promise<JobState> {
  const job = await step.do("start", QUICK_STEP, () => startJob(deps, params.job_id));
  let outcome: JobOutcome = FAILED;
  if (job !== null) {
    try {
      outcome = await step.do(
        "generate",
        { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: JOB_TIME_LIMIT_MS[job.type] },
        async (): Promise<JobOutcome> => {
          const current = await loadJob(deps.db, job.id);
          if (current === null || current.state !== "running" || deps.now() > current.deadline_at) throw new JobStopped();
          const input = params.input_key === null ? null : await readJobInput(deps.bucket, job.id, params.input_key);
          const made = await generate(current, input);
          await sealJobResult({ db: deps.db, bucket: deps.bucket }, { jobId: job.id, plaintext: made.plaintext });
          return { ok: true, actual: made.actual, tokens_in: made.tokens_in, tokens_out: made.tokens_out };
        },
      );
    } catch {
      outcome = FAILED;
    }
  }
  // Also when the job may not run (cancelled, or its deadline passed while queued): finishJob releases what is held.
  return step.do("finish", QUICK_STEP, () => finishJob(deps, params.job_id, outcome));
}
```

`apps/api/test/helpers/jobs.ts`, exactly. Reused by Part B, PR 21 and PR 22 to 25; never redefined.

```ts
// Stand-ins for the jobs code (PR 20): an R2 bucket in memory, Workflow bindings that record what they were asked,
// a real wallet store on node:sqlite, and queues that record messages. Reused by PR 21 and PR 22 to 25.
import type { Command } from "@waypoint/ledger";
import type { JobBucket, JobDeps } from "../../src/jobs/job.ts";
import type { JobStep } from "../../src/jobs/run.ts";
import type { JobParams, JobWorkflow } from "../../src/jobs/workflows.ts";
import type { PushMessage } from "../../src/push/messages.ts";
import type { BatchDb } from "../../src/storage.ts";
import type { UsageEvent } from "../../src/usage.ts";
import { createWalletStore } from "../../src/wallet/store.ts";
import { createTestDb } from "./d1.ts";
import { configEntries } from "./tasks.ts";
import { insertDevice, makeTestDevice, type TestDevice } from "./signing.ts";
import { createTestStore } from "./sql.ts";

export const JOB_NOW = 1_763_560_000_000;

export type MemoryBucket = JobBucket & { objects: Map<string, Uint8Array>; failPut: boolean };

export function memoryBucket(): MemoryBucket {
  const objects = new Map<string, Uint8Array>();
  const bucket: MemoryBucket = {
    objects,
    failPut: false,
    async get(key) {
      const bytes = objects.get(key);
      if (bytes === undefined) return null;
      return {
        body: new Response(bytes.slice()).body ?? new ReadableStream(),
        size: bytes.length,
        arrayBuffer: async () => bytes.slice().buffer,
      };
    },
    async put(key, value) {
      if (bucket.failPut) throw new Error("r2 down");
      objects.set(key, value.slice());
      return {};
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
  return bucket;
}

export type FakeWorkflow = JobWorkflow & {
  created: { id: string; params: JobParams }[];
  terminated: string[];
  failCreate: boolean;
};

export function fakeWorkflow(): FakeWorkflow {
  const workflow: FakeWorkflow = {
    created: [],
    terminated: [],
    failCreate: false,
    async create(options) {
      if (workflow.failCreate) throw new Error("workflows down");
      workflow.created.push({ id: options.id, params: options.params });
      return {};
    },
    async get(id) {
      return {
        terminate: async () => {
          workflow.terminated.push(id);
        },
      };
    },
  };
  return workflow;
}

// A step object like Workflows' own: runs the callback, tries again up to config.retries.limit more times, and
// records each step's name and what it returned (Workflows keep those, so tests check they hold no text).
export function fakeStep(): JobStep & { names: string[]; results: unknown[]; calls: number } {
  const step = {
    names: [] as string[],
    results: [] as unknown[],
    calls: 0,
    async do<T>(name: string, config: { retries: { limit: number } }, callback: () => Promise<T>): Promise<T> {
      step.names.push(name);
      let last: unknown = new Error("no attempt");
      for (let attempt = 0; attempt <= config.retries.limit; attempt++) {
        step.calls += 1;
        try {
          const result = await callback();
          step.results.push(result);
          return result;
        } catch (error) {
          last = error;
        }
      }
      throw last;
    },
  };
  return step;
}

// A user u1 (billing account ba_u1) with an approved phone, and a second user u2 with an approved device.
export async function makeJobsWorld(options: { monthly?: number; zeroRetention?: boolean } = {}) {
  const db: BatchDb = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id, zero_retention) VALUES (?, ?, ?, ?, ?)")
      .bind(id, `clerk_${id}`, JOB_NOW, `ba_${id}`, id === "u1" && options.zeroRetention === true ? 1 : 0)
      .run();
  }
  const phone: TestDevice = await makeTestDevice("dev_phone");
  const ipad: TestDevice = await makeTestDevice("dev_ipad1");
  const other: TestDevice = await makeTestDevice("dev_other");
  await insertDevice(db, phone, { userId: "u1" });
  await insertDevice(db, ipad, { userId: "u1" });
  await insertDevice(db, other, { userId: "u2" });

  const store = createWalletStore(createTestStore());
  const monthly = options.monthly ?? 100;
  if (monthly > 0) store.apply({ type: "grant", id: "seed", bucket: "monthly", credits: monthly, ref: "test" }, JOB_NOW);
  const commands: Command[] = [];
  const clock = { now: JOB_NOW };
  const walletFor = (name: string) => ({
    apply: async (command: Command) => {
      if (name !== "ba_u1") throw new Error(`unexpected wallet ${name}`);
      commands.push(command);
      return store.apply(command, clock.now);
    },
  });
  const usage: UsageEvent[] = [];
  const pushes: PushMessage[] = [];
  const bucket = memoryBucket();
  const workflow = fakeWorkflow();
  const config = new Map(Object.entries(configEntries()));

  const env = {
    DB: db,
    BUCKET: bucket,
    CONFIG: { get: async (key: string) => config.get(key) ?? null },
    WALLET: { idFromName: (name: string) => name, get: (name: string) => walletFor(name) },
    USAGE_QUEUE: { send: async (event: UsageEvent) => void usage.push(event) },
    PUSH_QUEUE: { send: async (message: PushMessage) => void pushes.push(message) },
  };
  const deps: JobDeps = {
    db,
    bucket,
    wallet: walletFor,
    usage: env.USAGE_QUEUE,
    push: env.PUSH_QUEUE,
    now: () => clock.now,
  };
  return { db, env, deps, store, commands, usage, pushes, bucket, workflow, clock, phone, ipad, other };
}

// Inserts a job row for u1 as POST /v1/jobs would, holding its credits in the wallet.
export async function insertJob(
  world: Awaited<ReturnType<typeof makeJobsWorld>>,
  job: { id: string; key?: string; type?: string; state?: string; quoted?: number; deviceId?: string | null; deadlineAt?: number },
): Promise<void> {
  const key = job.key ?? `key-${job.id}-0123456789`;
  const quoted = job.quoted ?? 40;
  const deadline = job.deadlineAt ?? JOB_NOW + 600_000;
  world.store.apply(
    { type: "hold", id: `job:u1:${key}`, hold_id: `job:u1:${key}`, user_id: "u1", task: job.type ?? "overview_script", credits: quoted, expires_at: deadline + 60_000 },
    JOB_NOW,
  );
  await world.db
    .prepare(
      "INSERT INTO jobs (id, user_id, type, state, quoted, route, model, retention, bytes_sent, command_key, device_id, created_at, deadline_at) VALUES (?, 'u1', ?, ?, ?, 'strong', 'workers-ai/kimi-k2.6', 'standard', 12, ?, ?, ?, ?)",
    )
    .bind(job.id, job.type ?? "overview_script", job.state ?? "queued", quoted, key, job.deviceId === undefined ? "dev_phone" : job.deviceId, JOB_NOW, deadline)
    .run();
}
```

Part A tests. Each bullet is one test.

`packages/contracts/test/jobs.test.ts`:
- One valid body for each of the seven types parses (research with and without `text`); `"  the cell  "` comes back as `"the cell"`.
- Rejected: an unknown `type`; `overview_script` without `text`; `text` `""` and `"   "`; `text` of 200,001 characters (200,000 accepted); `research` without `depth`, without `question`, or with a 1,001-character question; `fallback_voice` on `diagram`; `minutes` on `overview_script`; `retranscribe` with `text`; `retranscribe` with `minutes` 0 or 601 (600 accepted); an extra key.
- `JobViewSchema` accepts a full view and rejects an extra key, `tier: "huge"`, `quoted: 0` and `state: "paused"`; `JobResponseSchema` accepts `{ job: <view> }`.

`db/d1/test/schema.test.mjs`: the new test above; the existing column and type tests now cover the six columns.

`apps/api/test/usage.test.ts` (add): an event with `outcome: "cancelled"` and credits 0 is written and acked; `outcome: "other"` is acked and writes nothing.

`apps/api/test/push.test.ts` (add):
- `sendPush` sends a valid message once, unchanged.
- `sendPush` sends nothing for a `ref` of 49 characters or a `device_id` of 7 characters.
- `sendPush` with a queue whose `send` throws resolves.
- Compile-time check: `export const pushQueueFits: (queue: Queue<PushMessage>) => PushQueue = (queue) => queue;`.

`apps/api/test/cleanup.test.ts`: in "objects under groups/ are never listed or deleted", the allowed prefixes become `"results/"`, `"tmp/audio/"` and `"tmp/input/"`; in the request-nonces test the expected counts gain `tmp_input: 0`. Add: `tmp/input/` objects older than 24 hours are deleted and younger ones kept (`counts.tmp_input` 1).

`apps/api/test/jobs-core.test.ts`, with `makeJobsWorld()`, `insertJob()`, `fakeStep()` and `memoryBucket()` from the helper (`w.store.read().monthly` is the free monthly balance; the world starts with 100):
- Compile-time checks: `(bucket: R2Bucket) => JobBucket`, `(bucket: JobBucket) => ResultBucket` (from `src/jobs/seal.ts`), `(step: WorkflowStep) => JobStep` (`import type { WorkflowStep } from "cloudflare:workers"`), `(workflow: Workflow<JobParams>) => JobWorkflow`.
- `jobWorkflow` returns null for each of the seven types (pass `{} as Env`).
- `jobIdFor("u1", key)` matches `^job_[A-Za-z0-9_-]{22}$`, is the same twice, and differs for user `u2` and for another key.
- `jobWalletIds` gives exactly `job:u1:K`, `job_settle:u1:K`, `job_release:u1:K`; with a 36-character user id and a 64-character key each is at most 128 characters.
- `lockJobInput` then `readJobInput` gives the input back; the key is 43 characters; the stored bytes do not contain the text (use a marker string).
- `readJobInput` with another job id, another key, one changed stored byte, or no object rejects (the last with "job input missing").
- `loadJob` returns the row with `billing_account_id` `ba_u1`; with user `u2` it returns null; an unknown id gives null.
- `jobView` maps the row (tier from `route`); `result_ready` is true for a succeeded job with a `result_key` before `expires_at`, false at `expires_at`, false with `result_key` null.
- `isOverdue`: a running job at exactly deadline + 60,000 ms is not overdue, 1 ms later it is, and its view says `failed`; a succeeded job is never overdue.
- `startJob`: a queued job becomes running and is returned; a cancelled job gives null and stays cancelled; a queued job past its deadline gives null; an unknown id gives null.
- `finishJob` ok: returns `succeeded`; the row has `spent` 40, `finished_at` now and `expires_at` now + 7 days; the monthly balance is 60 with no open holds; `tmp/input/{job}` is deleted and `results/{job}` kept; one push `{ user_id: "u1", kind: "job_ready", ref: <job>, device_id: "dev_phone" }`; one usage event with `id` `job:u1:<key>`, `outcome` `ok`, `credits` 40, `task` `overview_script`, `tier` `strong`, `router` `skipped`, `bytes_sent` 12 and the given token counts.
- `finishJob` ok with `actual` 50 on a quote of 40 charges 40; with `actual` 3 on a `retranscribe` quote of 5 charges 3 and the monthly balance is 97.
- `finishJob` ok run twice: the second returns `succeeded`, the wallet ledger has one settle, the balance is unchanged.
- `finishJob` ok for a job with `device_id` null sends no push.
- `finishJob` failed: returns `failed`; hold released (balance 100); `spent` 0; `result_key` null; `results/`, `tmp/input/` and `tmp/audio/` objects of the job deleted; one usage event `model_failed` with credits 0; no push.
- `finishJob` ok after the hold was released (as a cancel does; set the row `cancelled`): returns `cancelled`, nothing charged, `results/{job}` deleted, no usage event.
- `finishJob` ok after the hold expired (`w.store.apply({ type: "release_expired", id: "x" }, later)`): returns `failed`, nothing charged, one `model_failed` event.
- `finishJob` for an unknown job id returns `failed` and deletes that id's objects.
- `finishJob` with a wallet whose `apply` throws rejects, and the row is unchanged (so the Workflow step is retried).
- `cancelJob` on a running job: `stop` called once; balance 100; state `cancelled`, `spent` 0, `finished_at` now; one usage event `cancelled` with credits 0; the job's three objects deleted; `result_key` null.
- `cancelJob` whose `stop` rejects still cancels.
- `cancelJob` on a succeeded job: `stop` not called; no wallet command; `spent` kept; `results/{job}` deleted and `result_key` null.
- `cancelJob` on a running job whose hold was already settled (settle it in the store first): the state stays `running`, the charge stays, the objects are deleted.
- `cancelJob` on an overdue running job whose hold expired: state `failed`, nothing charged.
- `cancelJob` twice: one usage event, one release in the ledger.
- `runJob`, happy path: step names `["start", "generate", "finish"]`; the generator gets the locked input back; returns `succeeded`; `openResult(results/{job}, job, "dev_phone", phone.boxPrivate)` gives the generator's text; `JSON.stringify(step.results)` contains neither the input text nor the result text.
- `runJob` with `input_key` null calls the generator with `null`.
- `runJob` whose generator throws: the generate step is tried 3 times (`step.calls` 5 in all), the job fails, nothing is charged.
- `runJob` for a job whose device was removed before sealing: `failed`, nothing charged, no `results/` object.
- `runJob` for a job cancelled before it started: the generator is never called; returns `cancelled`.
- `runJob` for a queued job whose deadline passed: the generator is never called; `failed`; balance 100.
- `runJob` where the generator cancels the job (calls `cancelJob`) before returning: returns `cancelled`, nothing charged, no `results/` object.

### Part B

Files: `apps/api/src/jobs/routes.ts`, `apps/api/src/app.ts` (two imports, one line), `apps/api/test/jobs.test.ts`, `apps/api/test/app.test.ts` (new tests only). No other files.

`apps/api/src/jobs/routes.ts`, exactly:

```ts
import { CreateJobRequestSchema, IDEMPOTENCY_KEY_HEADER, type CreateJobRequest, type JobResponse } from "@waypoint/contracts";
import { quoteCredits } from "@waypoint/pricing";
import { decideRoute, type Tier } from "@waypoint/router";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import { ConfigError, loadConfig, type LoadedConfig } from "../config/load.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure, InsufficientCredits } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { HOLD_MARGIN_MS, readTaskBody, utf8Bytes } from "../tasks/instant.ts";
import {
  cancelJob,
  finishJob,
  JOB_TIME_LIMIT_MS,
  jobDeps,
  jobIdFor,
  jobView,
  jobWalletIds,
  loadJob,
  lockJobInput,
  WHISPER_MODEL,
  type JobInput,
} from "./job.ts";
import { JOB_RETENTION, type JobWorkflows } from "./workflows.ts";

type JobRoute = { tier: Tier; model: string; retention: "standard" | "zero" };

// The route is picked before anything is held or run. Jobs have a fixed tier per type (routes.fixed); retranscribe
// always uses Whisper, which is not confirmed zero-retention. null: the user has zero retention on and no route fits.
export function jobRoute(config: LoadedConfig, type: CreateJobRequest["type"], zeroRetention: boolean): JobRoute | null {
  if (type === "retranscribe") return zeroRetention ? null : { tier: "light", model: WHISPER_MODEL, retention: "standard" };
  const decision = decideRoute({ task: type, zeroRetention, routes: config.routes, minConfidence: config.router.min_confidence });
  return decision.ok ? { tier: decision.tier, model: decision.model, retention: decision.retention } : null;
}

function jobInput(request: CreateJobRequest): JobInput | null {
  if (request.type === "retranscribe") return null;
  if (request.type === "research") return { text: request.text ?? null, question: request.question };
  return { text: request.text, question: null };
}

export function jobsRoutes(deps: { now: () => number; workflows: JobWorkflows }) {
  return new Hono<AppEnv>()
    .post("/v1/jobs", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const user = c.get("user");
      const device = c.get("device");
      const key = c.req.header(IDEMPOTENCY_KEY_HEADER) ?? "";
      const request = await readTaskBody(c, CreateJobRequestSchema);
      const config = await loadConfig(c.env.CONFIG).catch((err: unknown) => {
        if (err instanceof ConfigError) throw new ApiFailure("internal", "config unavailable");
        throw err;
      });
      const workflow = deps.workflows(c.env, request.type);
      if (workflow === null) throw new ApiFailure("bad_request", "job type not available");
      const route = jobRoute(config, request.type, user.zero_retention);
      if (route === null) throw new ApiFailure("forbidden", "no zero-retention route for this task");
      const credits = quoteCredits(config.prices, {
        task: request.type,
        depth: request.type === "research" ? request.depth : undefined,
        minutes: request.type === "retranscribe" ? request.minutes : undefined,
        fallback_voice: request.type === "overview_script" || request.type === "video_slides" ? request.fallback_voice : undefined,
      });

      const db = c.env.DB;
      const now = deps.now();
      const id = await jobIdFor(user.id, key);
      // The same request run again (its stored reply was lost) finds the job it made.
      const existing = await loadJob(db, id, user.id);
      if (existing !== null) return c.json({ job: jobView(existing, now) } satisfies JobResponse, 201);

      const ids = jobWalletIds(user.id, key);
      const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(user.billing_account_id));
      const deadline = now + JOB_TIME_LIMIT_MS[request.type];
      const held = await wallet.apply({
        type: "hold",
        id: ids.hold,
        hold_id: ids.hold,
        user_id: user.id,
        task: request.type,
        credits,
        expires_at: deadline + HOLD_MARGIN_MS,
      });
      if (!held.ok) {
        if ("shortfall" in held) throw new InsufficientCredits(held.shortfall);
        if (held.reason === "hold_closed") throw new ApiFailure("conflict", "request already finished");
        if (held.reason === "hold_in_progress") throw new ApiFailure("conflict", "request in progress", 1);
        throw new ApiFailure("internal", "something went wrong");
      }

      const input = jobInput(request);
      const bytesSent = input === null ? 0 : utf8Bytes(input.text ?? "", input.question ?? "");
      let inputKey: string | null = null;
      try {
        if (input !== null) inputKey = await lockJobInput(c.env.BUCKET, id, input);
        await db
          .prepare(
            "INSERT INTO jobs (id, user_id, type, state, quoted, route, model, retention, bytes_sent, command_key, device_id, created_at, deadline_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(id, user.id, request.type, credits, route.tier, route.model, route.retention, bytesSent, key, device.id, now, deadline)
          .run();
      } catch {
        await wallet.apply({ type: "release", id: ids.release, hold_id: ids.hold }).catch(() => undefined);
        await c.env.BUCKET.delete([`tmp/input/${id}`]).catch(() => undefined);
        throw new ApiFailure("internal", "job could not start");
      }
      try {
        await workflow.create({ id, params: { job_id: id, input_key: inputKey }, retention: JOB_RETENTION });
      } catch {
        await finishJob(jobDeps(c.env, deps.now), id, { ok: false, tokens_in: null, tokens_out: null }).catch(() => undefined);
        throw new ApiFailure("internal", "job could not start");
      }
      const job = await loadJob(db, id, user.id);
      if (job === null) throw new ApiFailure("internal", "something went wrong");
      return c.json({ job: jobView(job, now) } satisfies JobResponse, 201);
    })
    .get("/v1/jobs/:id", async (c) => {
      const job = await loadJob(c.env.DB, c.req.param("id"), c.get("user").id);
      if (job === null) throw new ApiFailure("not_found", "no such job");
      return c.json({ job: jobView(job, deps.now()) } satisfies JobResponse);
    })
    .get("/v1/jobs/:id/result", requireDeviceSignature(deps), async (c) => {
      const job = await loadJob(c.env.DB, c.req.param("id"), c.get("user").id);
      // Only the device the result is sealed to may fetch it; anyone else learns nothing.
      if (job === null || job.state !== "succeeded" || job.result_key === null || job.device_id !== c.get("device").id) {
        throw new ApiFailure("not_found", "no such result");
      }
      const object = await c.env.BUCKET.get(job.result_key);
      if (object === null) throw new ApiFailure("not_found", "no such result");
      return new Response(object.body, {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(object.size), "Cache-Control": "no-store" },
      });
    })
    .delete("/v1/jobs/:id", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const user = c.get("user");
      const job = await loadJob(c.env.DB, c.req.param("id"), user.id);
      if (job === null) throw new ApiFailure("not_found", "no such job");
      const workflow = deps.workflows(c.env, job.type);
      await cancelJob(jobDeps(c.env, deps.now), job, async () => {
        if (workflow !== null) await (await workflow.get(job.id)).terminate();
      });
      const after = await loadJob(c.env.DB, job.id, user.id);
      if (after === null) throw new ApiFailure("not_found", "no such job");
      return c.json({ job: jobView(after, deps.now()) } satisfies JobResponse);
    });
}
```

The route order matters inside `POST`: route and price before the hold (nothing to release on 400 or 403); the existing-job check before the hold (a request run again must not hold twice); the jobs row before `create` (the Workflow's first step reads it). `GET /v1/jobs/:id/result` is never stored: it has no `idempotent()` and replies with content.

`apps/api/src/app.ts`: `import { jobsRoutes } from "./jobs/routes.ts";`, `import { jobWorkflow } from "./jobs/workflows.ts";` and, at the end of the routes, `app.route("/", jobsRoutes({ now: deps.now, workflows: jobWorkflow }));`.

Tests (`apps/api/test/jobs.test.ts`): a fresh app as in `docs/cards/security.md` ("Rules for every security card"), with the session user u1 (`billing_account_id` `ba_u1`), `jobsRoutes({ now: () => w.clock.now, workflows: () => w.workflow })` (or `() => null` where a test says so), and `w.env` from `makeJobsWorld()` as the env. Signed requests use `signedInit(w.phone, { method, path, body, now: w.clock.now, idempotencyKey })`. Each bullet is one test.

`POST /v1/jobs`:
- `overview_script` → 201; the body passes `JobResponseSchema`; `state` `queued`, `quoted` 40, `tier` `strong`, `result_ready` false; the job id is `jobIdFor("u1", key)`; one Workflow `create` with that id and `params` `{ job_id, input_key }` (43 characters) and `retention` `JOB_RETENTION`; one hold with id `job:u1:<key>`, credits 40 and `expires_at` now + 600,000 + 60,000; balance 60; the row has `device_id` `dev_phone`, `command_key` the key, `model` `workers-ai/kimi-k2.6`, `retention` `standard`, `bytes_sent` the UTF-8 bytes of the text, `deadline_at` now + 600,000; `tmp/input/{job}` exists, does not contain the text, and `readJobInput` with the params key gives `{ text, question: null }`.
- Prices: `research` `deep` with a question only → 125 and `readJobInput` gives `{ text: null, question }`; `research` `quick` with text → 15; `video_slides` with `fallback_voice: true` → 52; `diagram` 18; `mini_app` 40; `practice` 8.
- `retranscribe` with `minutes` 4.2 → `quoted` 5, `tier` `light`, the row's `model` `WHISPER_MODEL`, no `tmp/input/` object, `input_key` null.
- Signed by the iPad → the row's `device_id` is `dev_ipad1`.
- The same key and body again → the stored 201 with `Idempotent-Replayed: true`; still one `create` and one hold.
- The same key after its idempotency row is deleted → 201 with the same job; still one `create` and one hold.
- Monthly 10 → 402 with `shortfall` 30 passing `InsufficientCreditsErrorSchema`; no row, no `create`, no R2 object. After granting 100 credits, the same key → 201.
- A zero-retention user: `diagram` → 403 "no zero-retention route for this task" with no wallet command; `retranscribe` → 403.
- `workflows` returning null → 400 "job type not available" and no wallet command.
- Bad JSON, `{ "type": "nope" }`, `overview_script` without text, an extra key → 400 "invalid request"; no body contains the text sent.
- `config:current` missing → 500 "config unavailable".
- `create` fails (`w.workflow.failCreate = true`) → 500 "job could not start"; balance 100; the row is `failed`; no `tmp/input/` object; one usage event `model_failed`.
- R2 `put` fails (`w.bucket.failPut = true`) → 500 "job could not start"; balance 100; no row.
- A hold already used and released for this key, with no row (apply hold and release to `w.store` by hand) → 409 "request already finished".
- Without `Waypoint-*` headers → 401 "device signature required".

`GET /v1/jobs/:id`:
- The user's job → 200 passing `JobResponseSchema`; another user's job or an unknown id → 404 "no such job".
- A running job past deadline + 60 s → 200 with `state` `failed`.

`GET /v1/jobs/:id/result` (insert a succeeded job with `result_key` `results/<job>` and put three bytes there):
- Signed by the phone → 200, `Content-Type` `application/octet-stream`, `Content-Length` 3, `Cache-Control` `no-store`, the same three bytes.
- Signed by the iPad (same user, another device) → 404 "no such result".
- A running job → 404; a succeeded job whose object is gone → 404; another user's job → 404.
- Without a signature → 401.

`DELETE /v1/jobs/:id`:
- A running job → 200 with `state` `cancelled`; the fake Workflow's `terminated` is `[job id]`; balance 100; one usage event `cancelled`; no objects left for the job.
- A succeeded job → 200 with `state` `succeeded`, `spent` kept, `result_ready` false; then `GET .../result` → 404.
- The same key again → the stored reply; `terminated` still has one entry.
- With `workflows` returning null for the type, a running job is still cancelled.
- Another user's job or an unknown id → 404; without a signature → 401.

`apps/api/test/app.test.ts` (add; change nothing else), through `createApp` with the file's `setup()` and `authed()`:
- `POST /v1/jobs` signed in, with a valid key and no `Waypoint-*` headers → 401 "device signature required".
- `GET /v1/jobs/x` without `Authorization` → 401.

Not in this PR: any Workflow class, binding or generator (PR 22 to 25); the signed upload URL for `retranscribe` (PR 23); `GET /v1/jobs/:id/events` (PR 21); a list of jobs; a push for a failed job; refunds after a job succeeded.

---

## PR 21 · `GET /v1/jobs/:id/events`

Branch `pr/21-job-events`. Builds on PR 20. No new dependencies. Files: `apps/api/src/jobs/events.ts`, `apps/api/src/app.ts` (one import, one line), `apps/api/test/job-events.test.ts`, `apps/api/test/app.test.ts` (new test only). No other files.

The stream (`Content-Type: text/event-stream`) is a `state` event for the job now, then one more for each change, then it ends:

```
event: state
data: {"id":"job_…","type":"overview_script","state":"running","quoted":40,"spent":null,"tier":"strong","retention":"standard","result_ready":false,"created_at":…,"finished_at":null,"expires_at":null}
id: 2

: keep-alive
```

`data` is always a `JobView` (passes `JobViewSchema`): ids, state, credits and times, never content. Session only (a `GET`), no signature. 404 JSON before the stream for another user's job or an unknown id.

`apps/api/src/jobs/events.ts`, exactly:

```ts
import type { JobView } from "@waypoint/contracts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { jobView, loadJob } from "./job.ts";

// How often the stream looks at the job, how long it may stay quiet before a keep-alive comment, and how long one
// stream lasts. The app opens a new one if the job has not finished by then.
export const JOB_EVENTS_POLL_MS = 2_000;
export const JOB_EVENTS_KEEPALIVE_MS = 20_000;
export const JOB_EVENTS_MAX_MS = 10 * 60_000;

const FINISHED: ReadonlySet<JobView["state"]> = new Set(["succeeded", "failed", "cancelled"]);

function sameView(a: JobView, b: JobView): boolean {
  return a.state === b.state && a.spent === b.spent && a.result_ready === b.result_ready;
}

// GET /v1/jobs/:id/events: server-sent "state" events, each the job's JobView (ids, state, credits, times; never
// content). The first event is the state now; another follows each change; the stream ends after a finished state,
// when the job is gone, or after JOB_EVENTS_MAX_MS.
export function jobEventsRoute(deps: { now: () => number; sleep: (ms: number) => Promise<void> }) {
  return new Hono<AppEnv>().get("/v1/jobs/:id/events", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const first = await loadJob(db, c.req.param("id"), user.id);
    if (first === null) throw new ApiFailure("not_found", "no such job");
    return streamSSE(c, async (stream) => {
      const started = deps.now();
      let sent: JobView | null = null;
      let quietSince = started;
      let seq = 0;
      let job: typeof first | null = first;
      while (!stream.aborted && job !== null) {
        const now = deps.now();
        const view = jobView(job, now);
        if (sent === null || !sameView(sent, view)) {
          seq += 1;
          await stream.writeSSE({ event: "state", id: String(seq), data: JSON.stringify(view) });
          sent = view;
          quietSince = now;
        } else if (now - quietSince >= JOB_EVENTS_KEEPALIVE_MS) {
          await stream.write(": keep-alive\n\n");
          quietSince = now;
        }
        if (FINISHED.has(view.state) || now - started >= JOB_EVENTS_MAX_MS) break;
        await deps.sleep(JOB_EVENTS_POLL_MS);
        job = await loadJob(db, first.id, user.id);
      }
    });
  });
}
```

`apps/api/src/app.ts`: `import { jobEventsRoute } from "./jobs/events.ts";` and, at the end of the routes, exactly:

```ts
  app.route("/", jobEventsRoute({ now: deps.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }));
```

Tests (`apps/api/test/job-events.test.ts`): the fresh app with user u1 and `jobEventsRoute({ now: () => w.clock.now, sleep })`, where the test's `sleep(ms)` adds `ms` to `w.clock.now`, counts its calls, and may change the jobs row on a given call. Read the reply with `res.text()`; split events on blank lines; keep-alive blocks start with `:`. Each bullet is one test.
- Queued, changed to running on the 1st sleep and to succeeded (with `spent` 40 and a `result_key`) on the 30th: three `state` events with `id` 1, 2, 3 and states `queued`, `running`, `succeeded`; each `data` passes `JobViewSchema`; the last has `result_ready` true; then the stream ends; `Content-Type` starts with `text/event-stream`.
- A job that is already `cancelled`: one event, and `sleep` is never called.
- No change for 20 s: one `: keep-alive` block after the first event; none before 20 s (stop the job at the 9th sleep and check).
- A job that never changes: the stream ends once `JOB_EVENTS_MAX_MS` has passed, after one `state` event (`sleep` called 300 times).
- A running job that becomes overdue (move the clock past deadline + 60 s in `sleep`): the last event says `failed` and the stream ends.
- The user row deleted on the 2nd sleep (the job goes with it): the stream ends after one event.
- Another user's job and an unknown id → 404 JSON `no such job`, not a stream.
- No event's `data` has any key other than the `JobView` keys.

`apps/api/test/app.test.ts` (add): `GET /v1/jobs/x/events` without `Authorization` → 401.

Not in this PR: Workflows' own `instance.subscribe()` (newer, and the D1 row is what the app's state means), `Last-Event-ID`, progress inside a job.

---

## S1F · Device pushes and push-token cleanup

Branch `pr/s1f-device-pushes`. Builds on S1D, PR 31 and PR 20 (Part A adds `sendPush` to `src/push/messages.ts`; if S1F is built before PR 20, it adds that block exactly as PR 20 Part A gives it, and PR 20 then skips it). No new dependencies. Files: `apps/api/src/devices/register.ts`, `apps/api/src/devices/pairing.ts`, `apps/api/src/devices/remove.ts`, `apps/api/test/device-push.test.ts`. No other files; the existing device tests stay as they are (they pass no `PUSH_QUEUE`, and `sendPush` drops the send).

What it adds, and nothing else (no note text in any push; the payload is the fixed text in `notificationFor`):

- `POST /v1/devices` for a new, waiting device sends `{ user_id, kind: "device_request", ref: <new device id>, device_id: <approved device id> }` once for each of the user's approved, not removed devices (never the account row, the waiting device itself or a removed one), in id order, after the D1 batch succeeded. The first device (with `account`) sends nothing. A replay served from the idempotency store sends nothing again.
- `POST /v1/devices/:id/approve` sends `{ user_id, kind: "device_approved", ref: <device id>, device_id: <device id> }` after the batch succeeded.
- `DELETE /v1/devices/:id` deletes that device's `push_tokens` rows (`WHERE user_id = ? AND device_id = ?`) in the same D1 batch that marks it removed, in all three branches.
- A failed queue send never fails the request (`sendPush`). A device id outside the push schema (shorter than 8 or, for `ref`, longer than 48 characters) gets no push; the app's ids are UUIDs (36).

`apps/api/src/devices/register.ts`: add `import { sendPush } from "../push/messages.ts";` and, between the `try { await db.batch(statements) } catch …` block and the final `SELECT`, exactly:

```ts
      if (req.account === undefined) {
        // Flow 7: tell the user's approved devices that a new device is waiting for the 6-digit code (S1F).
        const approvers = await db
          .prepare("SELECT id FROM devices WHERE user_id = ? AND kind = 'device' AND approved_at IS NOT NULL AND removed_at IS NULL ORDER BY id")
          .bind(user.id)
          .all<{ id: string }>();
        for (const approver of approvers.results) {
          await sendPush(c.env.PUSH_QUEUE, { user_id: user.id, kind: "device_request", ref: req.id, device_id: approver.id });
        }
      }
```

`apps/api/src/devices/pairing.ts`: add `import { sendPush } from "../push/messages.ts";` and, in the approve handler, between the `try { await db.batch(statements) } catch …` block and the final `SELECT`, exactly:

```ts
      // Tell the new device it was approved, so it fetches its keys (S1F).
      await sendPush(c.env.PUSH_QUEUE, { user_id: user.id, kind: "device_approved", ref: target.id, device_id: target.id });
```

`apps/api/src/devices/remove.ts` (S1D's file): after the `dropPairing` line add, exactly:

```ts
    // A removed device gets no more pushes (S1F).
    const dropPushToken = db.prepare("DELETE FROM push_tokens WHERE user_id = ? AND device_id = ?").bind(user.id, target.id);
```

and add `dropPushToken` as the last statement of each of the three batches: `[markRemoved, dropPairing, dropPushToken]`, `[markRemoved, bump, dropPushToken]`, and the rotation batch after the `DELETE FROM recovery` statement. Change nothing else.

Tests (`apps/api/test/device-push.test.ts`). Use ids of at least 8 characters (the push schema's limit), so the existing test files' short ids are not reused. The setup, exactly:

```ts
import { accountKeyInfo, deviceCertificateInput, fromBase64Url, makeEnvelope, pairingCommitment, PURPOSE_ACCOUNT_KEY, toBase64Url } from "@waypoint/crypto";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import { pairingRoutes } from "../src/devices/pairing.ts";
import { devicesRoute } from "../src/devices/register.ts";
import { removeDeviceRoute } from "../src/devices/remove.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { PushMessage, PushQueue } from "../src/push/messages.ts";
import type { BatchDb } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";

const NOW = 1_763_560_000_000;
const U1: SessionUser = { id: "u1", clerk_id: "clerk_u1", plan: "free", billing_account_id: "ba_u1", zero_retention: false };

type World = { db: BatchDb; account: TestDevice; phone: TestDevice; tablet: TestDevice; ipad: TestDevice; pushes: PushMessage[]; queue: PushQueue };

// u1 has an account row and two approved devices (phone_0001, tablet_0001), plus a removed device and a pending one;
// u2 has an approved device. ipad_0001 is not registered yet.
async function world(options: { queueFails?: boolean } = {}): Promise<World> {
  const db = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)").bind(id, `clerk_${id}`, NOW, `ba_${id}`).run();
  }
  const account = await makeTestDevice("acct_0001");
  const phone = await makeTestDevice("phone_0001");
  const tablet = await makeTestDevice("tablet_0001");
  const ipad = await makeTestDevice("ipad_0001");
  await insertDevice(db, account, { userId: "u1", kind: "account" });
  await insertDevice(db, phone, { userId: "u1" });
  await insertDevice(db, tablet, { userId: "u1" });
  await insertDevice(db, await makeTestDevice("old_00001"), { userId: "u1", removedAt: NOW - 1 });
  await insertDevice(db, await makeTestDevice("wait_0001"), { userId: "u1", approvedAt: null });
  await insertDevice(db, await makeTestDevice("other_0001"), { userId: "u2" });
  const pushes: PushMessage[] = [];
  const queue: PushQueue = {
    send: async (message) => {
      if (options.queueFails === true) throw new Error("queue down");
      pushes.push(message);
    },
  };
  return { db, account, phone, tablet, ipad, pushes, queue };
}

function app() {
  const a = new Hono<AppEnv>();
  a.onError(handleError);
  a.use(async (c, next) => {
    c.set("user", U1);
    await next();
  });
  a.route("/", devicesRoute({ now: () => NOW }));
  a.route("/", pairingRoutes({ now: () => NOW }));
  a.route("/", removeDeviceRoute({ now: () => NOW }));
  return a;
}

async function registerIpad(w: World, key = crypto.randomUUID()) {
  const path = "/v1/devices";
  const body = { id: "ipad_0001", name: "iPad", platform: "ios", sign_pub: w.ipad.signPub, box_pub: w.ipad.boxPub, commitment: await pairingCommitment(w.ipad.signPub, w.ipad.boxPub, "A".repeat(43)) };
  return app().request(path, await signedInit(w.ipad, { method: "POST", path, body, now: NOW, as: "new", idempotencyKey: key }), { DB: w.db, PUSH_QUEUE: w.queue });
}
```

Each bullet is one test:
- Registering the iPad → 201 and exactly two messages: `device_request`, `ref` `ipad_0001`, to `phone_0001` then `tablet_0001` (not the removed, waiting, account or other user's devices).
- The same registration again with the same key → the stored 201, still two messages.
- Registering with a queue that throws → 201 and the row exists.
- Registering with an id that is already taken (409) sends nothing.
- A first device (no account row yet: delete u1's rows first, register with `account`) sends nothing.
- Approve (set the pairing row's `approver_id` `phone_0001`, `approver_nonce` and `device_nonce` by hand; certificate from `account`, account envelope wrapped by the phone with `makeEnvelope`, `envelopes: []`) → 200 and exactly one message `{ user_id: "u1", kind: "device_approved", ref: "ipad_0001", device_id: "ipad_0001" }`.
- Approve refused (409 "pairing not finished": leave the nonces null) sends nothing.
- Approve with a queue that throws → 200 and the device is approved.
- Removing the waiting device (signed by the phone, body empty) deletes its token row and keeps the phone's row and u2's row with the same device id.
- Removing the tablet with a new account key (the S1D rotation body) deletes the tablet's token row, keeps the phone's.
- The phone removing itself when it is the last approved device (remove the tablet first by hand: set `removed_at`) deletes the phone's token row.
- A refused removal (S1D's 409 "certificates must cover every remaining device") keeps the token row.

Not in this PR: a push to the other devices when a device is removed, revoking the removed device's Clerk session (R13), refusing `POST /v1/push-tokens` for a device that is not approved (open question 17).

---

## Open questions for the product owner

1. **Job inputs per type.** PR 20 takes `text` for every type except `retranscribe` (minutes only) and `research` (`depth`, `question`, optional `text`). If a type needs more (number of practice questions, diagram kind, slide count), its workflow card adds fields to its own variant in `CreateJobRequestSchema`; prices do not change.
2. **Zero retention and the second transcript.** Whisper is not in the route table, so a zero-retention user gets 403 for `retranscribe`. Mark Whisper zero-retention (Cloudflare hosts it), or keep it refused?
3. **Cancelling is free.** A cancelled job is never charged, even if the model already ran (the cost is in the usage event). Accept, or charge something once the generate step has started?
4. **Time limits** per type (`JOB_TIME_LIMIT_MS`: research 20 min, overview script and video slides and mini app 10, diagram and practice 5, second transcript 60 including the upload) are guesses until PR 22 to 25 measure them.
5. **Push ids.** `PushMessageSchema` allows `device_id` of 8 to 64 characters and `ref` up to 48 (to keep the APNs collapse id within 64 bytes), while device ids may be 1 to 64. S1B could require UUID device ids, or the push schema could hash long ids into the collapse id.
6. **No push when a job fails.** The app sees it only while it is watching (events stream) or next time it asks. Add a `job_failed` push kind?
7. **Migration number.** `0006_jobs.sql` was the next free number on `main`, but the groups cards being planned at the same time (PR 27 to 30) also want new migrations. Whichever merges second renames its file to the next free number (the content does not depend on it); the "Shared files" table in `docs/build-plan.md` should record the result.
