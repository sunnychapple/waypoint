import { RetranscribeResultSchema } from "@waypoint/contracts";
import { openResult } from "@waypoint/crypto";
import { describe, expect, test } from "vitest";
import type { AiBinding, GatewayCallOptions } from "../src/ai/gateway.ts";
import { makeTranscript, runRetranscribeJob, toBase64, UPLOAD_WAIT_MS, type AudioBucket, type RetranscribeDeps, type RetranscribeSteps } from "../src/jobs/retranscribe.ts";
import { fakeSteps, makeJobFixture } from "./helpers/jobs.ts";

// Compile-time check: the R2 binding is accepted where the retranscribe job expects its bucket (no cast needed).
export const bucketFits: (bucket: R2Bucket) => AudioBucket = (bucket) => bucket;

type Call = { model: string; inputs: Record<string, unknown>; options: { gateway: GatewayCallOptions; signal?: AbortSignal } };

// A fake Whisper binding: records each call and answers with reply(call index), or rejects with rejectWith.
function fakeWhisper(reply: (index: number) => unknown, rejectWith?: Error) {
  const calls: Call[] = [];
  const ai: AiBinding = {
    run: async (model, inputs, options) => {
      calls.push({ model, inputs, options });
      if (rejectWith !== undefined) throw rejectWith;
      return reply(calls.length - 1);
    },
  };
  return { ai, calls };
}

const whisperReply = (text: string, duration: number | null, segments: { start: number; end: number; text: string }[] = []) =>
  duration === null ? { text, segments } : { text, segments, transcription_info: { duration } };

function deps(f: Awaited<ReturnType<typeof makeJobFixture>>, ai: AiBinding): RetranscribeDeps {
  return { ...f.deps, ai, gatewayId: "gw", bucket: f.bucket };
}

const PART_0 = new Uint8Array([1, 2, 3]);
const PART_1 = new Uint8Array([4, 5]);

async function withParts(f: Awaited<ReturnType<typeof makeJobFixture>>): Promise<void> {
  await f.bucket.put("tmp/audio/job_1/0", PART_0);
  await f.bucket.put("tmp/audio/job_1/1", PART_1);
}

const audioLeft = (objects: Map<string, unknown>): string[] => [...objects.keys()].filter((key) => key.startsWith("tmp/audio/"));

describe("retranscribe job", () => {
  test("toBase64 matches Buffer base64 across the 0x8000 boundary and gives an empty string for no bytes", () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i += 65_536) crypto.getRandomValues(bytes.subarray(i, i + 65_536));
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    expect(toBase64(new Uint8Array())).toBe("");
  });

  test("two 150 s parts: Whisper runs on each in order, the sealed transcript opens, 5 started minutes are charged and no audio is left", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await withParts(f);
    const { ai, calls } = fakeWhisper((n) =>
      n === 0
        ? whisperReply(" Hello there. ", 150, [{ start: 0.123, end: 1.456, text: " Hello " }])
        : whisperReply("Second part.", 150, [{ start: 2, end: 3.5, text: "Second" }]),
    );
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 2, bytes: 5 }) }, f.input)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      model: "@cf/test/strong",
      inputs: { audio: Buffer.from(PART_0).toString("base64"), task: "transcribe", vad_filter: true },
      options: { gateway: { id: "gw", collectLog: false, skipCache: true }, signal: expect.any(AbortSignal) },
    });
    expect(calls[1]?.inputs).toEqual({ audio: Buffer.from(PART_1).toString("base64"), task: "transcribe", vad_filter: true });
    const stored = f.objects.get("results/job_1");
    const opened = await openResult(stored?.value ?? new Uint8Array(), "job_1", "device_1", f.device.boxPrivate);
    expect(RetranscribeResultSchema.parse(JSON.parse(new TextDecoder().decode(opened)))).toEqual({
      v: 1,
      truncated: false,
      chunks: [
        { n: 0, duration: 150, text: "Hello there.", segments: [{ start: 0.12, end: 1.46, text: "Hello" }] },
        { n: 1, duration: 150, text: "Second part.", segments: [{ start: 2, end: 3.5, text: "Second" }] },
      ],
    });
    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 5, result_key: "results/job_1" });
    expect(f.store.read().monthly).toBe(95);
    expect(f.usage[0]).toMatchObject({ outcome: "ok", credits: 5, bytes_sent: 5, tokens_in: null, tokens_out: null, task: "retranscribe" });
    expect(audioLeft(f.objects)).toEqual([]);
  });

  test("301 s of audio is charged 6 credits", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await withParts(f);
    const { ai } = fakeWhisper(() => whisperReply("Long.", 301));
    expect(await makeTranscript(deps(f, ai), f.input, { chunks: 1, bytes: 3 })).toMatchObject({ ok: true, credits: 6 });
  });

  test("a part with no transcription_info is charged the quote and its duration is null", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await withParts(f);
    const { ai } = fakeWhisper(() => whisperReply("No duration.", null));
    const made = await makeTranscript(deps(f, ai), f.input, { chunks: 1, bytes: 3 });
    expect(made).toMatchObject({ ok: true, credits: 10 });
    const opened = await openResult(f.objects.get("results/job_1")?.value ?? new Uint8Array(), "job_1", "device_1", f.device.boxPrivate);
    expect(JSON.parse(new TextDecoder().decode(opened)).chunks[0]).toMatchObject({ n: 0, duration: null });
  });

  test("audio past the quoted minutes stops Whisper early: two calls, truncated, charged 1", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 1, minutes: 1, input: null });
    await withParts(f);
    await f.bucket.put("tmp/audio/job_1/2", PART_0);
    const { ai, calls } = fakeWhisper(() => whisperReply("Part.", 50));
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 3, bytes: 8 }) }, f.input)).toBe(true);
    expect(calls).toHaveLength(2);
    const opened = await openResult(f.objects.get("results/job_1")?.value ?? new Uint8Array(), "job_1", "device_1", f.device.boxPrivate);
    expect(JSON.parse(new TextDecoder().decode(opened))).toMatchObject({ truncated: true });
    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 1 });
  });

  test("one part with ten minutes of audio for 1 quoted minute: the transcript stops at 90 s, truncated, charged 1", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 1, minutes: 1, input: null });
    await withParts(f);
    const segments = [
      { start: 0, end: 40, text: " First. " },
      { start: 60, end: 95, text: "Second." },
      { start: 100, end: 120, text: "Paid for by nobody." },
      { start: 500, end: 600, text: "Nor this." },
    ];
    const { ai, calls } = fakeWhisper(() => whisperReply("First. Second. Paid for by nobody. Nor this.", 600, segments));
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 2, bytes: 5 }) }, f.input)).toBe(true);
    expect(calls).toHaveLength(1);
    const opened = await openResult(f.objects.get("results/job_1")?.value ?? new Uint8Array(), "job_1", "device_1", f.device.boxPrivate);
    expect(RetranscribeResultSchema.parse(JSON.parse(new TextDecoder().decode(opened)))).toEqual({
      v: 1,
      truncated: true,
      chunks: [
        {
          n: 0,
          duration: 90,
          text: "First. Second.",
          segments: [
            { start: 0, end: 40, text: "First." },
            { start: 60, end: 90, text: "Second." },
          ],
        },
      ],
    });
    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 1 });
  });

  test("an upload bigger than minutes × 600,000 bytes: no Whisper call, the job fails, the hold is released and the parts are deleted", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await withParts(f);
    const { ai, calls } = fakeWhisper(() => whisperReply("x", 1));
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 1, bytes: 6_000_001 }) }, f.input)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await f.jobRow()).toMatchObject({ state: "failed" });
    expect(f.store.read().monthly).toBe(100);
    expect(audioLeft(f.objects)).toEqual([]);
  });

  test("the wait times out: no Whisper call, the job fails, the hold is released, the parts are deleted, the steps are the five and the wait used UPLOAD_WAIT_MS", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await withParts(f);
    const { ai, calls } = fakeWhisper(() => whisperReply("x", 1));
    const fake = fakeSteps();
    const waits: [string, number][] = [];
    const steps: RetranscribeSteps = {
      ...fake.steps,
      waitForUpload: async (name, timeoutMs) => {
        waits.push([name, timeoutMs]);
        throw new Error("timed out");
      },
    };
    expect(await runRetranscribeJob(deps(f, ai), steps, f.input)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await f.jobRow()).toMatchObject({ state: "failed" });
    expect(f.store.read().monthly).toBe(100);
    expect(audioLeft(f.objects)).toEqual([]);
    expect(fake.names).toEqual(["start", "make", "cleanup", "finish", "notify"]);
    expect(waits).toEqual([["upload", UPLOAD_WAIT_MS]]);
  });

  test("an upload event with chunks: 0 counts as no upload: the job fails and is released", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await withParts(f);
    const { ai, calls } = fakeWhisper(() => whisperReply("x", 1));
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 0, bytes: 5 }) }, f.input)).toBe(false);
    expect(calls).toHaveLength(0);
    expect(await f.jobRow()).toMatchObject({ state: "failed" });
    expect(f.store.read().monthly).toBe(100);
  });

  test("the event says 2 parts but part 1 is missing from R2: the job fails and is released", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await f.bucket.put("tmp/audio/job_1/0", PART_0);
    const { ai } = fakeWhisper(() => whisperReply("x", 60));
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 2, bytes: 5 }) }, f.input)).toBe(false);
    expect(await f.jobRow()).toMatchObject({ state: "failed" });
    expect(f.store.read().monthly).toBe(100);
  });

  test("Whisper rejects: the job fails, the hold is released, no results object is written and the parts are deleted", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await withParts(f);
    const { ai } = fakeWhisper(() => whisperReply("x", 1), new Error("whisper down"));
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 2, bytes: 5 }) }, f.input)).toBe(false);
    expect(await f.jobRow()).toMatchObject({ state: "failed" });
    expect(f.store.read().monthly).toBe(100);
    expect([...f.objects.keys()].filter((key) => key.startsWith("results/"))).toEqual([]);
    expect(audioLeft(f.objects)).toEqual([]);
  });

  test("Whisper replies without text: the job fails", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null });
    await withParts(f);
    const { ai } = fakeWhisper(() => ({ segments: [] }));
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 1, bytes: 3 }) }, f.input)).toBe(false);
    expect(await f.jobRow()).toMatchObject({ state: "failed" });
  });

  test("the device was removed: the job fails and is released, and the parts are deleted", async () => {
    const f = await makeJobFixture("retranscribe", { credits: 10, minutes: 10, input: null, device: "removed" });
    await withParts(f);
    const { ai } = fakeWhisper(() => whisperReply("x", 60));
    expect(await runRetranscribeJob(deps(f, ai), { ...fakeSteps().steps, waitForUpload: async () => ({ chunks: 2, bytes: 5 }) }, f.input)).toBe(false);
    expect(await f.jobRow()).toMatchObject({ state: "failed" });
    expect(f.store.read().monthly).toBe(100);
    expect(audioLeft(f.objects)).toEqual([]);
  });

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
});
