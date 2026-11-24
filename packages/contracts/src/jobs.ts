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
  problem_help: 4_000, // the text around the problem on its page
} as const;
// The one problem a person asked for help with (problem_help).
export const JOB_PROBLEM_MAX_CHARS = 2_000;
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
  z.strictObject({
    type: z.literal("problem_help"),
    problem: text(JOB_PROBLEM_MAX_CHARS),
    text: text(JOB_TEXT_MAX_CHARS.problem_help),
  }),
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
