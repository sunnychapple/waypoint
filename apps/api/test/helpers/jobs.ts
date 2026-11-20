// Stand-ins for the jobs code (PR 20): an R2 bucket in memory, Workflow bindings that record what they were asked,
// a real wallet store on node:sqlite, and queues that record messages. PR 22A appends fakeSteps and makeJobFixture
// below; PR 21 and PR 22 to 25 reuse this file and never redefine anything in it.
import type { Command } from "@waypoint/ledger";
import { putJobInput, type JobInput } from "../../src/jobs/input.ts";
import type { JobDeps } from "../../src/jobs/job.ts";
import type { StepConfig, Steps } from "../../src/jobs/run.ts";
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
    JOB_STARTS: { limit: async (_options: { key: string }) => ({ success: true }) },
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
// PR 22A from here on.

// Runs each step once and records its name, config and what it returned (Workflows keep step results, so tests
// check they hold no text). failOn makes that step throw, like a step whose retries ran out.
export function fakeSteps(failOn: string[] = []): { steps: Steps; names: string[]; configs: StepConfig[]; results: unknown[] } {
  const names: string[] = [];
  const configs: StepConfig[] = [];
  const results: unknown[] = [];
  const steps: Steps = {
    do: async (name, config, fn) => {
      names.push(name);
      configs.push(config);
      if (failOn.includes(name)) throw new Error(`step ${name} failed`);
      const result = await fn();
      results.push(result);
      return result;
    },
  };
  return { steps, names, configs, results };
}

export type JobFixture = Awaited<ReturnType<typeof makeJobFixture>>;

// User u1 with device "device_1" (approved unless told otherwise), 100 monthly credits, a queued job "job_1" of this
// type with its hold of `credits`, and (unless input is null) its encrypted input in the bucket.
export async function makeJobFixture(
  type: JobRunInput["type"],
  options: {
    credits?: number;
    input?: JobInput | null;
    device?: "approved" | "removed" | "none";
    depth?: JobRunInput["depth"];
    minutes?: number | null;
  } = {},
) {
  const db = createTestDb();
  await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 1, 'ba_u1')").run();
  const device: TestDevice = await makeTestDevice("device_1");
  const deviceState = options.device ?? "approved";
  if (deviceState !== "none") await insertDevice(db, device, { userId: "u1", removedAt: deviceState === "removed" ? 2 : null });
  const credits = options.credits ?? 40;
  await db
    .prepare("INSERT INTO jobs (id, user_id, type, state, quoted, route, created_at, device_id) VALUES ('job_1', 'u1', ?, 'queued', ?, 'strong', ?, ?)")
    .bind(type, credits, JOB_NOW, deviceState === "none" ? null : "device_1")
    .run();
  const store = createWalletStore(createTestStore());
  store.apply({ type: "grant", id: "seed", bucket: "monthly", credits: 100, ref: "test" }, JOB_NOW);
  store.apply(
    { type: "hold", id: "job:u1:k1", hold_id: "job:u1:k1", user_id: "u1", task: type, credits, expires_at: JOB_NOW + 3_600_000 },
    JOB_NOW,
  );
  const { bucket, objects } = memoryBucket();
  const sent = options.input === undefined ? { text: "Osmosis moves water across a membrane.", prompt: null } : options.input;
  const inputKey = sent === null ? null : await putJobInput(bucket, "job_1", sent);
  const usage: UsageEvent[] = [];
  const pushes: PushMessage[] = [];
  const deps = {
    db,
    bucket,
    wallet: { apply: async (command: Command) => store.apply(command, JOB_NOW) },
    usage: { send: async (event: UsageEvent) => void usage.push(event) },
    push: { send: async (message: PushMessage) => void pushes.push(message) },
    now: () => JOB_NOW,
  } satisfies JobDeps;
  const input: JobRunInput = {
    v: 1,
    job_id: "job_1",
    type,
    user_id: "u1",
    billing_account_id: "ba_u1",
    credits,
    hold_id: "job:u1:k1",
    settle_id: "job_settle:u1:k1",
    release_id: "job_release:u1:k1",
    deadline: JOB_NOW + 600_000,
    tier: "strong",
    model: "@cf/test/strong",
    retention: "standard",
    zero_retention: false,
    depth: options.depth ?? null,
    minutes: options.minutes ?? null,
    input_key: inputKey,
    bytes_sent: 38,
  };
  const jobRow = async () =>
    db
      .prepare("SELECT state, spent, finished_at, expires_at, result_key FROM jobs WHERE id = 'job_1'")
      .first<{ state: string; spent: number | null; finished_at: number | null; expires_at: number | null; result_key: string | null }>();
  return { db, store, bucket, objects, device, deps, input, usage, pushes, jobRow };
}
