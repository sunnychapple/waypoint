# Wave 3 cards: jobs and device pushes (S1F, PR 20, PR 21)

These cards follow `AGENTS.md`, the wave 2 rules (top of "Wave 2" in `docs/build-plan.md`), the wave 3 notes ("Notes the wave 3 cards must carry") and "Conventions for the cards still to write". In short: files only where the card says, no `node:` imports in `apps/api/src`, tests through `app.request` with hand-made `env` objects, no network, no Miniflare, and run `npm install`, `npm run typecheck`, `npm test` and `npm run bundle -w @waypoint/api` from the repo root before opening the pull request and paste the last lines of each. No card here adds a dependency.

| Card | Branch | Branch from `main` after | Sittings |
|---|---|---|---|
| PR 20 | `pr/20-jobs` | S1A, S4, PR 31, PR 33 (all merged) | Part A, commit and push; then Part B |
| PR 21 | `pr/21-job-events` | PR 20 | one |
| S1F | `pr/s1f-device-pushes` | S1D and PR 20 Part A (which adds `sendPush`) | one |

Where they go: "Build order" in `docs/build-plan.md` (batches 6 to 8). Migration number: PR 20 adds `0006_jobs.sql`; the "Shared files" table in `docs/build-plan.md` fixes every number from 0006 on (the groups cards take 0007 to 0009).

**Ownership between this file and `docs/cards/wave-3-workflows.md`** (reconciled 19 Nov 2026). PR 20 owns the jobs core: the contracts, the migration, the locked job input (`jobs/input.ts`), the Workflow params and registry (`jobs/start.ts`: `JobRunInput`, `JobWorkflow`, `JOB_WORKFLOWS`, `jobWorkflow`, `JOB_RETENTION`, `WHISPER_MODEL`, `jobTimeLimitMs`), the job row, `JobDeps`, `deleteJobInputs` and `cancelJob` (`jobs/job.ts`), `sendPush`, the `cancelled` usage outcome, the `tmp/input/` cleanup, the four routes and the shared test helper `test/helpers/jobs.ts`. PR 22A owns everything a Workflow runs: `runJob` with its steps, `finishJob` (settle or release), `notifyJob` (push and usage event) and `callModel` (`jobs/run.ts`, `jobs/model.ts`), and appends `fakeSteps` and `makeJobFixture` to the helper. Nothing is defined in both.

Every code block marked "exactly" was built and run against `main` at `57d1577` together with every block of `docs/cards/wave-3-workflows.md` and the groups migrations renumbered 0007 to 0009: `npm run typecheck`, every workspace's tests and `npm run bundle -w @waypoint/api` passed. Copy those blocks as they are. Code not marked "exactly" may differ in style, not in behaviour.

## What was checked during planning

- **Workflows types** (`@cloudflare/workers-types` 5.20261118.1, already in `apps/api`): `Workflow<JobRunInput>` is assignable to `JobWorkflow`, `R2Bucket` to `JobBucket` (and to the bucket types of PR 22 to 24), `Queue<PushMessage>` to `PushQueue` (compile-time checks in the tests). `create()` takes `{ id, params, retention: { successRetention, errorRetention } }`; the instance has `terminate()`, `sendEvent()`, `status()` and `delete()`.
- **A Workflow ran for real.** A throwaway Workflow class with a `workflows` block in `wrangler.jsonc` ran under `wrangler dev` (wrangler 4.164.0) against local D1, R2 and the Wallet Durable Object: the job went queued, running, succeeded; the result was sealed in R2 and opened with the device key; the locked input was deleted; the hold was settled. The step results Workflows stored held ids and numbers only. `npm run bundle` passes with the Workflow classes exported.
- **A Workflow class exported from `src/index.ts` breaks `test/scheduled.test.ts`**, which mocks `cloudflare:workers` with only `DurableObject`. PR 22B (the first Workflow card) adds `WorkflowEntrypoint: class {}` to that mock.
- **Server-sent events in Hono** (`streamSSE` from `hono/streaming`, as in PR 14): `stream.write(": keep-alive\n\n")` writes a comment line; `streamSSE` sets `Content-Type: text/event-stream` and `Cache-Control: no-cache` itself; the stream closes when the callback returns.
- **S1F:** its three edits were applied to the merged S1B and S1C files and to S1D's `remove.ts` built from its card (`docs/cards/security.md`); the existing device and pairing tests still passed unchanged, and the register, approve and waiting-device removal tests below passed.
- **R2 get for the result:** `R2ObjectBody` gives `body` (a stream) and `size`; the route streams `body` straight back.
- Cloudflare docs read on 19 Nov 2026 ([Workers API for Workflows](https://developers.cloudflare.com/workflows/build/workers-api/)): an instance id is at most 100 characters, `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$`, and `create` with an id still inside its retention throws; `retention` takes a duration such as `"1 day"`; default retention on Workers Paid is 7 days; `terminate()` throws on a finished instance; Workflows keep `params` and every step's return value until retention ends, and show them in the dashboard (a step marked `sensitive: "output"` is only redacted when read through the API, not left unstored).

## Decisions these cards make

Recorded in `docs/architecture.md` sections 4 and 5.

1. **The job id comes from the request.** `job_` + base64url of the first 16 bytes of SHA-256(`context("job-id", user id, Idempotency-Key)`): 26 characters, a valid Workflow instance id and push `ref`. A request whose stored reply was lost (the PR 11 row died while pending) finds its own job on the next try instead of holding twice.
2. **Job text is never stored readable, and never in Workflows.** `POST /v1/jobs` encrypts what the person sent (`{ text, prompt }`) with a new random AES-256-GCM key (`putJobInput`, the job id as additional data) and stores it at R2 `tmp/input/{job}`. Only the key goes into the Workflow's params (`JobRunInput.input_key`); the params hold ids, the route, credits and sizes, never text. The one Workflow step that makes the result reads it back; the runner's `cleanup` step deletes it (and any audio parts) when the job ends, `DELETE` deletes it on cancel, and the hourly cleanup deletes any left after 24 hours. Instances are created with `retention` 1 day.
3. **Route before money.** Each job type has a fixed tier (`routes.fixed`), so the route is picked before anything is held. A zero-retention user with no zero-retention route for the type gets 403 `forbidden` "no zero-retention route for this task" with nothing held and no model called. `retranscribe` always uses Whisper (`WHISPER_MODEL`), which is not confirmed zero-retention, so a zero-retention user gets 403 for it too (open question in `docs/build-plan.md`).
4. **Money.** Hold the quoted price (`quoteCredits`) with command id `job:<user id>:<Idempotency-Key>`, `expires_at` = deadline + `HOLD_MARGIN_MS`, deadline = now + `jobTimeLimitMs({ type, depth, minutes })`. PR 22A's `finishJob` settles at min(made credits, quote) (`job_settle:…`) when the result is sealed and releases (`job_release:…`) on any failure. A hold can be settled or released, never both, so the wallet decides a race between a cancel and a finishing job. **Cancelling** a queued or running job releases its hold: nothing is charged. Cancelling or deleting a finished job keeps its charge and deletes its result. A job whose device was removed mid-job cannot be sealed, so it fails and nothing is charged (answers open question 13 in `docs/build-plan.md` for now). If starting the Workflow fails, `POST` releases the hold, deletes the input, marks the row `failed` and answers 500; no usage event (nothing ran).
5. **States.** `queued` (row written, Workflow created; a second transcript stays queued while its audio is uploaded) → `running` (the Workflow's `start` step) → `succeeded` | `failed` | `cancelled`. A queued or running job past its deadline + `HOLD_MARGIN_MS` is shown as `failed`, whatever the row says (its hold has expired). Every end sets `finished_at`; `succeeded` sets `expires_at` = finish + 7 days, when the hourly cleanup deletes the result.
6. **Usage events.** One per job, `id` = the hold id, `router: "skipped"`, `tier`/`model` from the job's route. The Workflow sends `ok` or `model_failed` (PR 22A's `notifyJob`); `DELETE` sends `cancelled` with credits 0 for a job it stopped. `UsageEvent.outcome` gains `"cancelled"`; the consumer's schema follows. A late duplicate (a cancelled job's Workflow finishing anyway) is harmless: the consumer keeps the first event per id.
7. **The result goes to one device.** `GET /v1/jobs/:id/result` is signed (S1A) and answers only when the signing device is `jobs.device_id`; anything else is 404, the same as no result. `docs/security.md` section 15 says so.
8. **Pushes.** A finished job sends `job_ready` to `jobs.device_id` through `sendPush` (none if that is null). A failed or cancelled job sends no push (open question: a `job_failed` kind); the app learns from the events stream or `GET /v1/jobs/:id`. `sendPush` never sends a message the push consumer would drop (an id outside `PushMessageSchema`), and never fails the request or step.
9. **The events stream** polls the jobs row every 2 s, sends a `state` event (the `JobView`) only when the state, `spent` or `result_ready` changes, writes a keep-alive comment after 20 s without one, and ends after a finished state or 10 minutes. The app opens a new stream if the job is still going.
10. **A job type whose Workflow card is not merged yet** gets 400 `bad_request` "job type not available" before anything is held. After PR 20 alone, every type answers that; PR 22B to 25 each add their line to `JOB_WORKFLOWS`.
11. **Input caps per type** (`JOB_TEXT_MAX_CHARS` in the contracts) keep a job's model cost under its price; the sizing is in `docs/cards/wave-3-workflows.md`, "Input caps". Research sends `question` (at most 500 characters) and optional notes as `text`; the written types send `text` and an optional `prompt` (an instruction, at most 500); `retranscribe` sends only `minutes`. What is stored is always `{ text, prompt }` (`text` `""` for research without notes).

## How PR 22 to 25 plug in

PR 20 starts and stops Workflows only through `JobWorkflow` and `jobWorkflow` in `src/jobs/start.ts`. A Workflow card (full wiring in `docs/cards/wave-3-workflows.md`) adds: its plain module and a thin `WorkflowEntrypoint<Env, JobRunInput>` class that calls PR 22A's `runJob`; one `Env` line (`<NAME>_WORKFLOW: Workflow<JobRunInput>;`, PR 22B adds the `JobRunInput` import); one entry in the `workflows` array of `wrangler.jsonc` (PR 22B creates the block); one `export { … }` line in `src/index.ts`; one line per job type in `JOB_WORKFLOWS`. PR 22B also changes the `test/scheduled.test.ts` mock. No Workflow card changes any other PR 20 file.

`retranscribe` (PR 23) adds its own upload routes (`PUT /v1/jobs/:id/audio/:n`, `POST /v1/jobs/:id/audio/done`) that write `tmp/audio/{job}/{n}`; `deleteJobInputs` and `cancelJob` already delete everything under `tmp/audio/{job}/`.

---

## PR 20 · Jobs API

Branch `pr/20-jobs`. Builds on S1A, S4, PR 31 and PR 33 (all merged). No new dependencies. Two sittings on the same branch: Part A (the jobs core, no routes), commit and push; then Part B (the routes).

What the four endpoints do, in short:

- `POST /v1/jobs` (signed, idempotent): check the body; load config; find the type's Workflow (400 if none yet); pick the route (403 for zero retention without one); price it; if this request already made its job, reply with it; hold the price; encrypt the text into R2 `tmp/input/{job}`; write the jobs row (`queued`, with `device_id` from the signature); create the Workflow instance with its `JobRunInput`; reply 201 `{ job }`. If any of the last three fails: release, delete the input, mark the row `failed`, 500.
- `GET /v1/jobs/:id` (session): 200 `{ job }` for the user's own job, else 404.
- `GET /v1/jobs/:id/result` (signed, never stored): the sealed bytes from R2 `results/{job}` as `application/octet-stream`, only to the job's device and only when the job succeeded.
- `DELETE /v1/jobs/:id` (signed, idempotent): stop and release a queued or running job (`cancelled`, nothing charged), keep a finished job's charge, delete the result, the locked input and any uploaded audio; reply 200 `{ job }`.

### Part A

Files: `packages/contracts/src/jobs.ts`, `packages/contracts/src/index.ts` (one line), `packages/contracts/test/jobs.test.ts`, `db/d1/migrations/0006_jobs.sql`, `db/d1/test/schema.test.mjs`, `apps/api/src/usage.ts`, `apps/api/src/usage-consumer.ts`, `apps/api/src/push/messages.ts`, `apps/api/src/cleanup.ts`, `apps/api/src/jobs/start.ts`, `apps/api/src/jobs/input.ts`, `apps/api/src/jobs/job.ts`, `apps/api/test/helpers/jobs.ts`, `apps/api/test/jobs-core.test.ts`, `apps/api/test/usage.test.ts` (one test), `apps/api/test/push.test.ts` (new tests), `apps/api/test/cleanup.test.ts` (two lines and one test). No other files.

`packages/contracts/src/jobs.ts`, exactly:

```ts
import { z } from "zod";
import { JOB_TYPES, RESEARCH_DEPTHS } from "./tasks.ts";

// The most text each job type may send, in characters. Sized so a job's model cost stays under its price at about
// 4 characters per token (docs/cards/wave-3-workflows.md, "Input caps"). Flow 8 revisits them with measured costs.
export const JOB_TEXT_MAX_CHARS = {
  overview_script: 40_000,
  video_slides: 48_000,
  diagram: 16_000,
  mini_app: 24_000,
  practice: 28_000,
  research: 8_000,
} as const;
// The student's instruction for a written job, or the research question.
export const JOB_PROMPT_MAX_CHARS = 500;

const text = (max: number) => z.string().trim().min(1).max(max);
const prompt = z.string().trim().min(1).max(JOB_PROMPT_MAX_CHARS);

// POST /v1/jobs. The text is the part of a note the person chose to send; the server never stores it readable
// (it is locked in R2 tmp/input/{job} until the job ends). retranscribe sends no text: its audio is uploaded
// after the job is made (PR 23).
export const CreateJobRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("research"),
    depth: z.enum(RESEARCH_DEPTHS),
    question: prompt,
    text: text(JOB_TEXT_MAX_CHARS.research).optional(),
  }),
  z.strictObject({
    type: z.literal("overview_script"),
    text: text(JOB_TEXT_MAX_CHARS.overview_script),
    prompt: prompt.optional(),
    fallback_voice: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("video_slides"),
    text: text(JOB_TEXT_MAX_CHARS.video_slides),
    prompt: prompt.optional(),
    fallback_voice: z.boolean().optional(),
  }),
  z.strictObject({ type: z.literal("diagram"), text: text(JOB_TEXT_MAX_CHARS.diagram), prompt: prompt.optional() }),
  z.strictObject({ type: z.literal("mini_app"), text: text(JOB_TEXT_MAX_CHARS.mini_app), prompt: prompt.optional() }),
  z.strictObject({ type: z.literal("practice"), text: text(JOB_TEXT_MAX_CHARS.practice), prompt: prompt.optional() }),
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
-- UTF-8 bytes of the text sent (0 for retranscribe; its usage event carries the audio bytes).
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

`apps/api/src/jobs/start.ts`, exactly. What a job's Workflow is started with, the registry PR 22 to 25 add their lines to, and the time limits:

```ts
import type { JobType, ResearchDepth } from "@waypoint/contracts";
import type { Tier } from "@waypoint/router";
import type { Env } from "../env.ts";

// The second transcript's model. Not in the route table: retranscribe is never routed.
export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

// Everything a job's Workflow gets as params. Workflows store params, so this holds no note text: the text the
// person sent is in R2 tmp/input/{job}, encrypted with input_key (see input.ts).
export type JobRunInput = {
  v: 1;
  job_id: string;
  type: JobType;
  user_id: string;
  billing_account_id: string;
  // The quote, held.
  credits: number;
  // Wallet command ids: job:<user id>:<Idempotency-Key>, job_settle:..., job_release:...
  hold_id: string;
  settle_id: string;
  release_id: string;
  // created_at + jobTimeLimitMs(...). The hold expires at deadline + HOLD_MARGIN_MS.
  deadline: number;
  // The route POST /v1/jobs picked (retranscribe: "light", WHISPER_MODEL, "standard").
  tier: Tier;
  model: string;
  retention: "standard" | "zero";
  // The user's zero-retention switch when the job was made.
  zero_retention: boolean;
  depth: ResearchDepth | null; // research only
  minutes: number | null; // retranscribe only: the quoted minutes
  input_key: string | null; // base64url AES-256 key for tmp/input/{job}; null for retranscribe
  bytes_sent: number; // UTF-8 bytes of text + prompt; 0 for retranscribe
};

// Workflows keep an instance's params and step results until its retention ends. A day is enough to look into a
// failed job; the params hold only a key whose locked input is deleted when the job ends.
export const JOB_RETENTION = { successRetention: "1 day", errorRetention: "1 day" } as const;

// The parts of a Workflow binding the jobs code uses. Workflow<JobRunInput> satisfies this type.
export type JobInstance = { terminate(): Promise<void>; sendEvent(event: { type: string; payload: unknown }): Promise<void> };
export type JobWorkflow = {
  create(options: { id: string; params: JobRunInput; retention: typeof JOB_RETENTION }): Promise<unknown>;
  get(id: string): Promise<JobInstance>;
};

// Which Workflow runs each job type. PR 22 to 25 add one line each and change nothing else in this file.
export const JOB_WORKFLOWS: Partial<Record<JobType, (env: Env) => JobWorkflow>> = {};

// The Workflow for a job type, or null while its card is not merged (POST /v1/jobs then answers 400 "job type not
// available" before any hold). The routes take this as a dependency, so tests pass their own.
export type JobWorkflows = (env: Env, type: JobType) => JobWorkflow | null;
export const jobWorkflow: JobWorkflows = (env, type) => JOB_WORKFLOWS[type]?.(env) ?? null;

const MINUTE = 60_000;

// How long a job may take. Its hold lives this long plus HOLD_MARGIN_MS (from tasks/instant.ts).
export function jobTimeLimitMs(input: { type: JobType; depth: ResearchDepth | null; minutes: number | null }): number {
  switch (input.type) {
    case "research":
      return input.depth === "deep" ? 60 * MINUTE : input.depth === "standard" ? 30 * MINUTE : 20 * MINUTE;
    case "retranscribe":
      // Up to an hour for the upload, then about 10 s per audio minute for Whisper.
      return 90 * MINUTE + Math.ceil(input.minutes ?? 0) * 10_000;
    case "diagram":
    case "practice":
      return 20 * MINUTE;
    default:
      return 30 * MINUTE;
  }
}
```

`apps/api/src/jobs/input.ts`, exactly. The locked job input; only `putJobInput` (the route), `readJobInput` (the step that makes the result) and `deleteJobInput` touch `tmp/input/`:

```ts
import { fromBase64Url, toBase64Url } from "@waypoint/crypto";

// What the person sent with a job. Held in R2 only while the job runs, encrypted with a key that exists only in the
// Workflow's params; never put in params, D1, KV, a queue or a log.
export type JobInput = { text: string; prompt: string | null };

export const JOB_INPUT_PREFIX = "tmp/input/";

// The parts of R2 this module uses. R2Bucket satisfies this type.
export type InputBucket = {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Encrypts the input with a fresh AES-256-GCM key (12-byte IV first, the job id as additional data), stores it at
// tmp/input/{job} and returns the key as base64url for the Workflow's params.
export async function putJobInput(bucket: InputBucket, jobId: string, input: JobInput): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(input));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(jobId) }, await importKey(raw), plain),
  );
  const stored = new Uint8Array(iv.length + sealed.length);
  stored.set(iv, 0);
  stored.set(sealed, iv.length);
  await bucket.put(`${JOB_INPUT_PREFIX}${jobId}`, stored);
  return toBase64Url(raw);
}

// The job's input, or null if the object is gone or does not open with this key.
export async function readJobInput(bucket: InputBucket, jobId: string, key: string): Promise<JobInput | null> {
  const object = await bucket.get(`${JOB_INPUT_PREFIX}${jobId}`);
  if (object === null) return null;
  const stored = new Uint8Array(await object.arrayBuffer());
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: stored.slice(0, 12), additionalData: new TextEncoder().encode(jobId) },
      await importKey(fromBase64Url(key)),
      stored.slice(12),
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (typeof parsed !== "object" || parsed === null || !("text" in parsed) || !("prompt" in parsed)) return null;
    const { text, prompt } = parsed;
    if (typeof text !== "string" || (prompt !== null && typeof prompt !== "string")) return null;
    return { text, prompt };
  } catch {
    return null;
  }
}

export async function deleteJobInput(bucket: InputBucket, jobId: string): Promise<void> {
  await bucket.delete(`${JOB_INPUT_PREFIX}${jobId}`);
}
```

`apps/api/src/jobs/job.ts`, exactly. The jobs core: the row and its view, ids, `JobDeps` (used by `cancelJob` here and by PR 22A's runner), deleting what was sent, and `cancelJob` for `DELETE`:

```ts
import type { JobState, JobType, JobView } from "@waypoint/contracts";
import { context, sha256, toBase64Url } from "@waypoint/crypto";
import type { Tier } from "@waypoint/router";
import type { WalletCommands } from "../apple/purchases.ts";
import type { Env } from "../env.ts";
import type { PushQueue } from "../push/messages.ts";
import type { Db } from "../storage.ts";
import { HOLD_MARGIN_MS } from "../tasks/instant.ts";
import { sendUsage, type UsageQueue } from "../usage.ts";
import { JOB_INPUT_PREFIX } from "./input.ts";

// The parts of R2 the jobs code uses. R2Bucket satisfies this type.
export type JobBucket = {
  get(key: string): Promise<{ body: ReadableStream; size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; limit: number }): Promise<{ objects: { key: string }[] }>;
};

// Everything that runs or ends a job needs: the routes (cancelJob) and every job Workflow (PR 22A's runJob).
export type JobDeps = {
  db: Db;
  bucket: JobBucket;
  wallet: WalletCommands;
  usage: UsageQueue;
  push: PushQueue;
  now: () => number;
};

export function jobDeps(env: Env, billingAccountId: string, now: () => number): JobDeps {
  return {
    db: env.DB,
    bucket: env.BUCKET,
    wallet: env.WALLET.get(env.WALLET.idFromName(billingAccountId)),
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
// The second transcript's audio, one object per recording part: tmp/audio/{job}/{n} (PR 23).
export const audioPrefix = (jobId: string): string => `tmp/audio/${jobId}/`;

// Deletes what the person sent with a job: its locked input and any uploaded audio parts (at most 1,000, one
// listing page; PR 23 allows 200). Every job Workflow calls it when the job ends, and so does cancelJob.
export async function deleteJobInputs(bucket: JobBucket, jobId: string): Promise<void> {
  const listed = await bucket.list({ prefix: audioPrefix(jobId), limit: 1000 });
  await bucket.delete([`${JOB_INPUT_PREFIX}${jobId}`, ...listed.objects.map((object) => object.key)]);
}

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

// DELETE /v1/jobs/:id. A queued or running job is stopped (stop terminates its Workflow instance; errors ignored)
// and its hold released: nothing is charged, and one usage event says "cancelled". A finished job keeps what it was
// charged. Either way the result, the locked input and any uploaded audio are deleted.
export async function cancelJob(deps: JobDeps, job: JobRow, stop: () => Promise<void>): Promise<void> {
  const now = deps.now();
  if (job.state === "queued" || job.state === "running") {
    await stop().catch(() => undefined);
    const ids = jobWalletIds(job.user_id, job.command_key);
    const released = await deps.wallet.apply({ type: "release", id: ids.release, hold_id: ids.hold });
    if (released.ok) {
      const { meta } = await deps.db
        .prepare("UPDATE jobs SET state = 'cancelled', spent = 0, finished_at = ? WHERE id = ? AND state IN ('queued', 'running')")
        .bind(now, job.id)
        .run();
      if (meta.changes === 1) {
        await sendUsage(deps.usage, {
          v: 1,
          id: ids.hold,
          at: now,
          user_id: job.user_id,
          task: job.type,
          outcome: "cancelled",
          credits: 0,
          tier: job.route,
          model: job.model,
          retention: job.retention,
          router: "skipped",
          bytes_sent: job.bytes_sent,
          tokens_in: null,
          tokens_out: null,
        });
      }
    } else if (isOverdue(job, now)) {
      // The hold expired with the job unfinished.
      await deps.db
        .prepare("UPDATE jobs SET state = 'failed', spent = 0, finished_at = ? WHERE id = ? AND state IN ('queued', 'running')")
        .bind(now, job.id)
        .run();
    }
    // Otherwise the job settled a moment ago; its Workflow marks it succeeded and the credits stay charged.
  }
  await deleteJobInputs(deps.bucket, job.id);
  await deps.bucket.delete(resultObjectKey(job.id));
  await deps.db.prepare("UPDATE jobs SET result_key = NULL WHERE id = ?").bind(job.id).run();
}
```

`apps/api/test/helpers/jobs.ts`, exactly. Reused by Part B, PR 21 and PR 22 to 25; PR 22A appends two functions and two imports to it, and nothing is ever redefined.

```ts
// Stand-ins for the jobs code (PR 20): an R2 bucket in memory, Workflow bindings that record what they were asked,
// a real wallet store on node:sqlite, and queues that record messages. PR 22A appends fakeSteps and makeJobFixture
// below; PR 21 and PR 22 to 25 reuse this file and never redefine anything in it.
import type { Command } from "@waypoint/ledger";
import type { JobDeps } from "../../src/jobs/job.ts";
import type { JobRunInput, JobWorkflow } from "../../src/jobs/start.ts";
import type { PushMessage } from "../../src/push/messages.ts";
import type { BatchDb } from "../../src/storage.ts";
import type { UsageEvent } from "../../src/usage.ts";
import { createWalletStore } from "../../src/wallet/store.ts";
import { createTestDb } from "./d1.ts";
import { insertDevice, makeTestDevice, type TestDevice } from "./signing.ts";
import { createTestStore } from "./sql.ts";
import { configEntries } from "./tasks.ts";

export const JOB_NOW = 1_763_560_000_000;

export type StoredObject = { value: Uint8Array; contentType: string | null };

// An in-memory bucket with the R2 methods the jobs code uses. failPut makes put throw.
export function memoryBucket() {
  const objects = new Map<string, StoredObject>();
  const bucket = {
    failPut: false,
    async put(
      key: string,
      value: Uint8Array | ReadableStream<Uint8Array>,
      options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
    ) {
      if (bucket.failPut) throw new Error("r2 down");
      const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { value: bytes, contentType: options?.httpMetadata?.contentType ?? null });
      return { key, size: bytes.length };
    },
    async get(key: string) {
      const found = objects.get(key);
      if (found === undefined) return null;
      const copy = found.value.slice();
      return { body: new Response(copy.slice()).body ?? new ReadableStream(), size: copy.length, arrayBuffer: async () => copy.buffer };
    },
    async head(key: string) {
      const found = objects.get(key);
      return found === undefined ? null : { size: found.value.length };
    },
    async delete(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list(options: { prefix: string; limit: number; cursor?: string }) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
      return { objects: keys.slice(0, options.limit).map((key) => ({ key })), truncated: false };
    },
  };
  return { bucket, objects };
}

export type FakeWorkflow = JobWorkflow & {
  created: { id: string; params: JobRunInput }[];
  terminated: string[];
  events: { id: string; type: string; payload: unknown }[];
  failCreate: boolean;
};

export function fakeWorkflow(): FakeWorkflow {
  const workflow: FakeWorkflow = {
    created: [],
    terminated: [],
    events: [],
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
        sendEvent: async (event) => {
          workflow.events.push({ id, ...event });
        },
      };
    },
  };
  return workflow;
}

// A user u1 (billing account ba_u1) with an approved phone and iPad, and a second user u2 with an approved device.
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
  const { bucket, objects } = memoryBucket();
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
  const deps: JobDeps = { db, bucket, wallet: walletFor("ba_u1"), usage: env.USAGE_QUEUE, push: env.PUSH_QUEUE, now: () => clock.now };
  return { db, env, deps, store, commands, usage, pushes, bucket, objects, workflow, clock, phone, ipad, other };
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
- One valid body for each of the seven types parses (research with and without `text`; a written type with and without `prompt`); `"  the cell  "` comes back as `"the cell"`.
- Rejected: an unknown `type`; `overview_script` without `text`; `text` `""` and `"   "`; `overview_script` `text` of 40,001 characters (40,000 accepted) and `diagram` of 16,001; `research` `text` of 8,001; `research` without `depth`, without `question`, or with a 501-character question; a 501-character `prompt`; `prompt` on `research`; `fallback_voice` on `diagram`; `minutes` on `overview_script`; `retranscribe` with `text`; `retranscribe` with `minutes` 0 or 601 (600 accepted); an extra key.
- `JOB_TEXT_MAX_CHARS` is exactly `{ overview_script: 40000, video_slides: 48000, diagram: 16000, mini_app: 24000, practice: 28000, research: 8000 }`.
- `JobViewSchema` accepts a full view and rejects an extra key, `tier: "huge"`, `quoted: 0` and `state: "paused"`; `JobResponseSchema` accepts `{ job: <view> }`.

`db/d1/test/schema.test.mjs`: the new test above; the existing column and type tests now cover the six columns.

`apps/api/test/usage.test.ts` (add): an event with `outcome: "cancelled"` and credits 0 is written and acked; `outcome: "other"` is acked and writes nothing.

`apps/api/test/push.test.ts` (add):
- `sendPush` sends a valid message once, unchanged.
- `sendPush` sends nothing for a `ref` of 49 characters or a `device_id` of 7 characters.
- `sendPush` with a queue whose `send` throws resolves.
- Compile-time check: `export const pushQueueFits: (queue: Queue<PushMessage>) => PushQueue = (queue) => queue;`.

`apps/api/test/cleanup.test.ts`: in "objects under groups/ are never listed or deleted", the allowed prefixes become `"results/"`, `"tmp/audio/"` and `"tmp/input/"`; in the request-nonces test the expected counts gain `tmp_input: 0`. Add: `tmp/input/` objects older than 24 hours are deleted and younger ones kept (`counts.tmp_input` 1).

`apps/api/test/jobs-core.test.ts`, with `makeJobsWorld()`, `insertJob()` and `memoryBucket()` from the helper (`w.store.read().monthly` is the free monthly balance; the world starts with 100; `w.objects` holds what is in the bucket):
- Compile-time checks: `(bucket: R2Bucket) => JobBucket`, `(bucket: R2Bucket) => InputBucket`, `(workflow: Workflow<JobRunInput>) => JobWorkflow`, and `(bucket: ReturnType<typeof memoryBucket>["bucket"]) => JobBucket & InputBucket & ResultBucket` (`ResultBucket` from `src/jobs/seal.ts`).
- `jobWorkflow` returns null for each of the seven types (pass `{} as Env`); with `JOB_WORKFLOWS.diagram` set to a function for one test (restore it after), it returns what that function returns.
- `jobTimeLimitMs`: research quick, standard, deep 20, 30, 60 minutes; `retranscribe` with 4.2 minutes 90 minutes + 50 s; diagram and practice 20 minutes; the other three 30 minutes.
- `jobIdFor("u1", key)` matches `^job_[A-Za-z0-9_-]{22}$`, is the same twice, and differs for user `u2` and for another key.
- `jobWalletIds` gives exactly `job:u1:K`, `job_settle:u1:K`, `job_release:u1:K`; with a 36-character user id and a 64-character key each is at most 128 characters.
- `putJobInput` then `readJobInput` gives `{ text, prompt }` back; the key is 43 characters; the stored bytes do not contain the text (use a marker string).
- `readJobInput` with another job id, another key, one changed stored byte, or no object gives null; `deleteJobInput` removes the object.
- `deleteJobInputs` deletes `tmp/input/{job}` and every `tmp/audio/{job}/{n}`, and keeps `results/{job}`, another job's input and `tmp/audio/{job}x/0`.
- `loadJob` returns the row with `billing_account_id` `ba_u1`; with user `u2` it returns null; an unknown id gives null.
- `jobView` maps the row (tier from `route`); `result_ready` is true for a succeeded job with a `result_key` before `expires_at`, false at `expires_at`, false with `result_key` null.
- `isOverdue`: a running job at exactly deadline + 60,000 ms is not overdue, 1 ms later it is, and its view says `failed`; a succeeded job is never overdue.
- `cancelJob` on a running job: `stop` called once; balance 100; state `cancelled`, `spent` 0, `finished_at` now; one usage event `{ id: "job:u1:<key>", outcome: "cancelled", credits: 0, task: "overview_script", tier: "strong", router: "skipped", bytes_sent: 12, tokens_in: null, tokens_out: null }`; the job's result, input and two audio parts deleted; `result_key` null.
- `cancelJob` whose `stop` rejects still cancels.
- `cancelJob` on a succeeded job: `stop` not called; no wallet command; `spent` kept; `results/{job}` deleted and `result_key` null.
- `cancelJob` on a running job whose hold was already settled (settle it in the store first): the state stays `running`, the charge stays, the objects are deleted, no usage event.
- `cancelJob` on an overdue running job whose hold expired: state `failed`, nothing charged.
- `cancelJob` twice: one usage event, one release in the ledger.

The runner (`runJob`, `finishJob`, `notifyJob`) and its tests are PR 22A's.

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
import { deleteJobInput, putJobInput, type JobInput } from "./input.ts";
import { cancelJob, jobDeps, jobIdFor, jobView, jobWalletIds, loadJob } from "./job.ts";
import { JOB_RETENTION, jobTimeLimitMs, WHISPER_MODEL, type JobRunInput, type JobWorkflows } from "./start.ts";

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
  if (request.type === "research") return { text: request.text ?? "", prompt: request.question };
  return { text: request.text, prompt: request.prompt ?? null };
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
      const depth = request.type === "research" ? request.depth : null;
      const minutes = request.type === "retranscribe" ? request.minutes : null;
      const deadline = now + jobTimeLimitMs({ type: request.type, depth, minutes });
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
      const bytesSent = input === null ? 0 : utf8Bytes(input.text, input.prompt ?? "");
      try {
        const inputKey = input === null ? null : await putJobInput(c.env.BUCKET, id, input);
        await db
          .prepare(
            "INSERT INTO jobs (id, user_id, type, state, quoted, route, model, retention, bytes_sent, command_key, device_id, created_at, deadline_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(id, user.id, request.type, credits, route.tier, route.model, route.retention, bytesSent, key, device.id, now, deadline)
          .run();
        const params: JobRunInput = {
          v: 1,
          job_id: id,
          type: request.type,
          user_id: user.id,
          billing_account_id: user.billing_account_id,
          credits,
          hold_id: ids.hold,
          settle_id: ids.settle,
          release_id: ids.release,
          deadline,
          tier: route.tier,
          model: route.model,
          retention: route.retention,
          zero_retention: user.zero_retention,
          depth,
          minutes,
          input_key: inputKey,
          bytes_sent: bytesSent,
        };
        await workflow.create({ id, params, retention: JOB_RETENTION });
      } catch {
        // Nothing ran: release the hold, delete the locked input, and mark the row failed if it was written.
        await wallet.apply({ type: "release", id: ids.release, hold_id: ids.hold }).catch(() => undefined);
        await deleteJobInput(c.env.BUCKET, id).catch(() => undefined);
        await db
          .prepare("UPDATE jobs SET state = 'failed', spent = 0, finished_at = ? WHERE id = ?")
          .bind(now, id)
          .run()
          .catch(() => undefined);
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
      await cancelJob(jobDeps(c.env, job.billing_account_id, deps.now), job, async () => {
        if (workflow !== null) await (await workflow.get(job.id)).terminate();
      });
      const after = await loadJob(c.env.DB, job.id, user.id);
      if (after === null) throw new ApiFailure("not_found", "no such job");
      return c.json({ job: jobView(after, deps.now()) } satisfies JobResponse);
    });
}
```

The route order matters inside `POST`: route and price before the hold (nothing to release on 400 or 403); the existing-job check before the hold (a request run again must not hold twice); the input and the jobs row before `create` (the Workflow's first step reads the row, its `make` step the input). `GET /v1/jobs/:id/result` is never stored: it has no `idempotent()` and replies with content.

`apps/api/src/app.ts`: `import { jobsRoutes } from "./jobs/routes.ts";`, `import { jobWorkflow } from "./jobs/start.ts";` and, at the end of the routes, `app.route("/", jobsRoutes({ now: deps.now, workflows: jobWorkflow }));`.

Tests (`apps/api/test/jobs.test.ts`): a fresh app as in `docs/cards/security.md` ("Rules for every security card"), with the session user u1 (`billing_account_id` `ba_u1`), `jobsRoutes({ now: () => w.clock.now, workflows: () => w.workflow })` (or `() => null` where a test says so), and `w.env` from `makeJobsWorld()` as the env. Signed requests use `signedInit(w.phone, { method, path, body, now: w.clock.now, idempotencyKey })`. Each bullet is one test.

`POST /v1/jobs`:
- `overview_script` → 201; the body passes `JobResponseSchema`; `state` `queued`, `quoted` 40, `tier` `strong`, `result_ready` false; the job id is `jobIdFor("u1", key)`; one Workflow `create` with that id, `retention` `JOB_RETENTION` and `params` equal to the full `JobRunInput` (`v` 1, `type`, `user_id` `u1`, `billing_account_id` `ba_u1`, `credits` 40, the three wallet ids, `deadline` now + 1,800,000, `tier` `strong`, `model` `workers-ai/kimi-k2.6`, `retention` `standard`, `zero_retention` false, `depth` and `minutes` null, a 43-character `input_key`, `bytes_sent` the UTF-8 bytes of the text), and `JSON.stringify(params)` does not contain the text; one hold with id `job:u1:<key>`, credits 40 and `expires_at` now + 1,800,000 + 60,000; balance 60; the row has `device_id` `dev_phone`, `command_key` the key, `model`, `retention`, `bytes_sent` as in the params and `deadline_at` now + 1,800,000; `tmp/input/{job}` exists, does not contain the text, and `readJobInput` with the params key gives `{ text, prompt: null }`.
- With `prompt: "Focus on plants"` → `readJobInput` gives `{ text, prompt: "Focus on plants" }` and `bytes_sent` counts both.
- Prices: `research` `deep` with a question only → 125, `params.depth` `deep`, `deadline` now + 3,600,000, and `readJobInput` gives `{ text: "", prompt: question }`; `research` `quick` with text → 15; `video_slides` with `fallback_voice: true` → 52; `diagram` 18; `mini_app` 40; `practice` 8.
- `retranscribe` with `minutes` 4.2 → `quoted` 5, `tier` `light`, the row's `model` `WHISPER_MODEL`, no `tmp/input/` object, `params.input_key` null, `params.minutes` 4.2, `params.bytes_sent` 0, `deadline` now + 5,450,000.
- Signed by the iPad → the row's `device_id` is `dev_ipad1`.
- The same key and body again → the stored 201 with `Idempotent-Replayed: true`; still one `create` and one hold.
- The same key after its idempotency row is deleted → 201 with the same job; still one `create` and one hold.
- Monthly 10 → 402 with `shortfall` 30 passing `InsufficientCreditsErrorSchema`; no row, no `create`, no R2 object. After granting 100 credits, the same key → 201.
- A zero-retention user: `diagram` → 403 "no zero-retention route for this task" with no wallet command; `retranscribe` → 403.
- `workflows` returning null → 400 "job type not available" and no wallet command.
- Bad JSON, `{ "type": "nope" }`, `overview_script` without text, an extra key → 400 "invalid request"; no body contains the text sent.
- `config:current` missing → 500 "config unavailable".
- `create` fails (`w.workflow.failCreate = true`) → 500 "job could not start"; balance 100; the row is `failed` with `spent` 0 and `finished_at` now; no `tmp/input/` object; no usage event.
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
- A running job with its input and two audio parts in R2 → 200 with `state` `cancelled`; the fake Workflow's `terminated` is `[job id]`; balance 100; one usage event `cancelled`; no objects left for the job.
- A succeeded job → 200 with `state` `succeeded`, `spent` kept, `result_ready` false; then `GET .../result` → 404.
- The same key again → the stored reply; `terminated` still has one entry.
- With `workflows` returning null for the type, a running job is still cancelled.
- Another user's job or an unknown id → 404; without a signature → 401.

`apps/api/test/app.test.ts` (add; change nothing else), through `createApp` with the file's `setup()` and `authed()`:
- `POST /v1/jobs` signed in, with a valid key and no `Waypoint-*` headers → 401 "device signature required".
- `GET /v1/jobs/x` without `Authorization` → 401.

Not in this PR: any Workflow class, binding, runner or generator (PR 22 to 25); the audio upload routes for `retranscribe` (PR 23); `GET /v1/jobs/:id/events` (PR 21); a list of jobs; a push for a failed job; refunds after a job succeeded.

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

`apps/api/src/app.ts`: `import { jobEventsRoute } from "./jobs/events.ts";` and, at the end of the routes (after PR 20's line), exactly:

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

Branch `pr/s1f-device-pushes`. Builds on S1D, PR 31 and PR 20 Part A (which adds `sendPush` and `PushQueue` to `src/push/messages.ts`; if S1F is built before PR 20, it adds that block exactly as PR 20 Part A gives it, and PR 20 then skips it). No new dependencies. Files: `apps/api/src/devices/register.ts`, `apps/api/src/devices/pairing.ts`, `apps/api/src/devices/remove.ts`, `apps/api/test/device-push.test.ts`. No other files; the existing device tests stay as they are (they pass no `PUSH_QUEUE`, and `sendPush` drops the send).

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

Moved to "Open questions" in `docs/build-plan.md` (job inputs per type, zero retention and the second transcript, free cancelling, time limits, push id limits, a `job_failed` push), with the workflow and groups questions, without repeats. The migration number is settled: `0006_jobs.sql`.
