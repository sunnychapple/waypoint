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
export const JOB_WORKFLOWS: Partial<Record<JobType, (env: Env) => JobWorkflow>> = {
  overview_script: (env) => env.WRITE_WORKFLOW,
  retranscribe: (env) => env.RETRANSCRIBE_WORKFLOW,
  video_slides: (env) => env.WRITE_WORKFLOW,
  diagram: (env) => env.WRITE_WORKFLOW,
  mini_app: (env) => env.WRITE_WORKFLOW,
  practice: (env) => env.WRITE_WORKFLOW,
  problem_help: (env) => env.WRITE_WORKFLOW,
  research: (env) => env.RESEARCH_WORKFLOW,
};

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
    case "problem_help":
      return 20 * MINUTE;
    default:
      return 30 * MINUTE;
  }
}
