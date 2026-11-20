import type { RetranscribeResult } from "@waypoint/contracts";
import { z } from "zod";
import { gatewayOptions, type AiBinding } from "../ai/gateway.ts";
import { audioPrefix, type JobDeps } from "./job.ts";
import { ModelError } from "./model.ts";
import { failed, runJob, type Made, type StepConfig, type Steps } from "./run.ts";
import { SealError, sealJobResult, type ResultBucket } from "./seal.ts";
import type { JobRunInput } from "./start.ts";

export const AUDIO_UPLOADED_EVENT = "audio_uploaded";
export const UPLOAD_WAIT_MS = 60 * 60_000;
// Generous for AAC at 64 kbit/s (480,000 bytes a minute); more audio than this for the quoted minutes is refused.
export const MAX_AUDIO_BYTES_PER_MINUTE = 600_000;
export const WHISPER_TIMEOUT_MS = 2 * 60_000;
// The step reads every chunk again on a retry, so one retry.
export const TRANSCRIBE_STEP: StepConfig = { retries: { limit: 1, delay: 30_000, backoff: "constant" }, timeout: 4 * 60 * 60_000 };

export const audioKey = (jobId: string, n: number): string => `${audioPrefix(jobId)}${n}`;

// The event POST /v1/jobs/:id/audio/done sends to the instance.
export const AudioUploadedSchema = z.strictObject({ chunks: z.number().int().min(1), bytes: z.number().int().min(1) });
export type AudioUploaded = z.infer<typeof AudioUploadedSchema>;

const WhisperOutputSchema = z.object({
  text: z.string(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })).optional(),
  transcription_info: z.object({ duration: z.number().optional() }).optional(),
});

export type RetranscribeSteps = Steps & {
  // Resolves with the event's payload; throws when the wait times out.
  waitForUpload(name: string, timeoutMs: number): Promise<unknown>;
};

// The parts of R2 this module uses. R2Bucket satisfies this type.
export type AudioBucket = JobDeps["bucket"] & ResultBucket;

export type RetranscribeDeps = JobDeps & { ai: AiBinding; gatewayId: string; bucket: AudioBucket };

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const round = (seconds: number): number => Math.round(Math.max(0, seconds) * 100) / 100;

// The make step: Whisper on each chunk in order, then seal. Stops reading chunks once the audio passes the quoted
// minutes (plus 30 s). Charges the per-minute price for each started minute of reported audio, never above the
// quote; if a chunk's duration is not reported, charges the quote.
export async function makeTranscript(deps: RetranscribeDeps, input: JobRunInput, uploaded: AudioUploaded | null): Promise<Made> {
  if (uploaded === null || input.minutes === null) return failed("no_upload");
  const quotedMinutes = Math.ceil(input.minutes);
  if (uploaded.bytes > quotedMinutes * MAX_AUDIO_BYTES_PER_MINUTE) return failed("no_upload");
  const limitSeconds = quotedMinutes * 60 + 30;
  const chunks: RetranscribeResult["chunks"] = [];
  let seconds = 0;
  let allKnown = true;
  let bytes = 0;
  let truncated = false;
  for (let n = 0; n < uploaded.chunks; n++) {
    if (seconds > limitSeconds) {
      truncated = true;
      break;
    }
    if (deps.now() > input.deadline) return failed("deadline");
    const object = await deps.bucket.get(audioKey(input.job_id, n));
    if (object === null) return failed("no_upload");
    const audio = new Uint8Array(await object.arrayBuffer());
    bytes += audio.length;
    // The parts read, not the sizes POST .../audio/done reported: a part can be replaced until the job starts.
    if (bytes > quotedMinutes * MAX_AUDIO_BYTES_PER_MINUTE) return failed("no_upload");
    let output: unknown;
    try {
      output = await deps.ai.run(
        input.model,
        { audio: toBase64(audio), task: "transcribe", vad_filter: true },
        {
          gateway: gatewayOptions(deps.gatewayId),
          signal: AbortSignal.timeout(Math.max(1_000, Math.min(WHISPER_TIMEOUT_MS, input.deadline - deps.now()))),
        },
      );
    } catch {
      throw new ModelError();
    }
    const parsed = WhisperOutputSchema.safeParse(output);
    if (!parsed.success) throw new ModelError();
    const duration = parsed.data.transcription_info?.duration ?? null;
    if (duration === null) allKnown = false;
    seconds += duration ?? 300;
    chunks.push({
      n,
      duration: duration === null ? null : round(duration),
      text: parsed.data.text.trim(),
      segments: (parsed.data.segments ?? []).map((s) => ({ start: round(s.start), end: round(s.end), text: s.text.trim() })),
    });
  }
  const perMinute = Math.max(1, Math.floor(input.credits / quotedMinutes));
  const credits = allKnown ? Math.min(input.credits, perMinute * Math.max(1, Math.ceil(seconds / 60))) : input.credits;
  const result: RetranscribeResult = { v: 1, truncated, chunks };
  try {
    const sealed = await sealJobResult(
      { db: deps.db, bucket: deps.bucket },
      { jobId: input.job_id, plaintext: new TextEncoder().encode(JSON.stringify(result)) },
    );
    return { ok: true, result_key: sealed.result_key, credits, bytes_sent: bytes, tokens_in: null, tokens_out: null };
  } catch (err) {
    if (err instanceof SealError) return failed(err.reason);
    throw err;
  }
}

export async function runRetranscribeJob(deps: RetranscribeDeps, steps: RetranscribeSteps, input: JobRunInput): Promise<boolean> {
  let uploaded: AudioUploaded | null = null;
  try {
    const parsed = AudioUploadedSchema.safeParse(await steps.waitForUpload("upload", UPLOAD_WAIT_MS));
    uploaded = parsed.success ? parsed.data : null;
  } catch {
    uploaded = null;
  }
  // The runner's cleanup step deletes every uploaded part, whether the job worked, failed or the upload never came.
  return runJob(deps, steps, input, { config: TRANSCRIBE_STEP, run: () => makeTranscript(deps, input, uploaded) });
}
