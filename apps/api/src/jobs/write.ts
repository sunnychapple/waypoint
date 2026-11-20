import { OverviewScriptDraftSchema } from "@waypoint/contracts";
import type { z } from "zod";
import type { AiBinding } from "../ai/gateway.ts";
import type { ChatMessage } from "../tasks/instant.ts";
import { readJobInput, type InputBucket, type JobInput } from "./input.ts";
import type { JobDeps } from "./job.ts";
import { callModel, jsonObjectIn, ModelError, type Tokens } from "./model.ts";
import { failed, runJob, type Made, type StepConfig, type Steps } from "./run.ts";
import { SealError, sealJobResult, type ResultBucket } from "./seal.ts";
import type { JobRunInput } from "./start.ts";

// A job where one model call writes the whole result from the text the person sent.
export type WriteSpec = {
  system: string;
  maxTokens: number;
  // The user message: the person's text, and their instruction if they gave one.
  user(input: JobInput): string;
  // The result to seal (with v: 1), or null if the reply is not valid.
  result(json: unknown): object | null;
};

export const WRITE_MODEL_TIMEOUT_MS = 10 * 60_000;
// One retry of the model call (a second full call); then the job fails and the hold is released.
export const WRITE_STEP: StepConfig = { retries: { limit: 1, delay: 30_000, backoff: "constant" }, timeout: 15 * 60_000 };

export function userMessage(input: JobInput): string {
  const instruction = input.prompt === null ? "" : `Instruction from the student: ${input.prompt}\n\n`;
  return `${instruction}Source text:\n${input.text}`;
}

// Checks a reply against the model-output schema and adds v: 1. Keys the model added are dropped.
export function fromDraft<S extends z.ZodType<object>>(schema: S): (json: unknown) => object | null {
  return (json) => {
    const parsed = schema.safeParse(json);
    return parsed.success ? { v: 1, ...parsed.data } : null;
  };
}

export const WRITE_SPECS: Partial<Record<JobRunInput["type"], WriteSpec>> = {
  overview_script: {
    system: [
      "You write the script of a short audio overview of a student's lecture or reading, spoken by two hosts, A and B.",
      "A guides the conversation; B asks the questions a student would ask and adds examples. They explain the main ideas",
      "in order, define new terms in plain words, and end with a short recap. About 1,200 to 1,500 words in total.",
      "Use only facts from the source text. No stage directions, no sound effects, no markdown.",
      "Reply with one JSON object and nothing else:",
      '{"title":"<at most 120 characters>","lines":[{"host":"A"|"B","text":"<one turn, at most 1200 characters>"}]}',
    ].join("\n"),
    maxTokens: 2_500,
    user: userMessage,
    result: fromDraft(OverviewScriptDraftSchema),
  },
};

export type WriteDeps = JobDeps & { ai: AiBinding; gatewayId: string; bucket: JobDeps["bucket"] & InputBucket & ResultBucket };

// The make step of a write job: read the input, call the model, check the reply, seal it. Throws ModelError (so the
// step retries) for a failed call or an invalid reply; returns a failure for anything a retry cannot fix.
export async function makeWritten(deps: WriteDeps, input: JobRunInput): Promise<Made> {
  const spec = WRITE_SPECS[input.type];
  const tokens: Tokens = { tokens_in: null, tokens_out: null };
  if (spec === undefined || input.input_key === null) return failed("no_input");
  const sent = await readJobInput(deps.bucket, input.job_id, input.input_key);
  if (sent === null) return failed("no_input");
  const messages: ChatMessage[] = [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user(sent) },
  ];
  const timeoutMs = Math.max(1_000, Math.min(WRITE_MODEL_TIMEOUT_MS, input.deadline - deps.now()));
  const reply = await callModel(deps.ai, deps.gatewayId, { model: input.model, messages, maxTokens: spec.maxTokens, timeoutMs }, tokens);
  const result = spec.result(jsonObjectIn(reply));
  if (result === null) throw new ModelError();
  try {
    const sealed = await sealJobResult(
      { db: deps.db, bucket: deps.bucket },
      { jobId: input.job_id, plaintext: new TextEncoder().encode(JSON.stringify(result)) },
    );
    return { ok: true, result_key: sealed.result_key, credits: input.credits, bytes_sent: input.bytes_sent, ...tokens };
  } catch (err) {
    if (err instanceof SealError) return failed(err.reason, tokens);
    throw err;
  }
}

export async function runWriteJob(deps: WriteDeps, steps: Steps, input: JobRunInput): Promise<boolean> {
  return runJob(deps, steps, input, { config: WRITE_STEP, run: () => makeWritten(deps, input) });
}
