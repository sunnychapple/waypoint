import { OverviewScriptResultSchema } from "@waypoint/contracts";
import { openResult, toBase64Url } from "@waypoint/crypto";
import { describe, expect, test } from "vitest";
import type { AiBinding, GatewayCallOptions } from "../src/ai/gateway.ts";
import { ModelError } from "../src/jobs/model.ts";
import { runWriteJob, makeWritten, WRITE_SPECS, WRITE_STEP, type WriteDeps } from "../src/jobs/write.ts";
import type { ChatMessage } from "../src/tasks/instant.ts";
import { fakeSteps, makeJobFixture } from "./helpers/jobs.ts";

// Compile-time check: the R2 binding is accepted where the write job expects its bucket (no cast needed).
export const bucketFits: (bucket: R2Bucket) => WriteDeps["bucket"] = (bucket) => bucket;

const SCRIPT = {
  title: "Osmosis",
  lines: [
    { host: "A", text: "Osmosis moves water across a membrane." },
    { host: "B", text: "Why does the water move?" },
    { host: "A", text: "It moves toward the side with more solute." },
    { host: "B", text: "So the cell takes in water?" },
  ],
};
const SCRIPT_JSON = JSON.stringify(SCRIPT);
const TEXT = "Osmosis moves water across a membrane.";

// A fake Workers AI binding: records each call and answers with the content given (or rejects with an error).
function fakeAi(content: string, rejectWith?: Error) {
  const calls: { model: string; inputs: Record<string, unknown>; options: { gateway: GatewayCallOptions; signal?: AbortSignal } }[] = [];
  const ai: AiBinding = {
    run: async (model, inputs, options) => {
      calls.push({ model, inputs, options });
      if (rejectWith !== undefined) throw rejectWith;
      return { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } };
    },
  };
  return { ai, calls };
}

// The write deps for a fixture: its own deps plus the fake model and the gateway id.
function writeDeps(f: Awaited<ReturnType<typeof makeJobFixture>>, ai: AiBinding): WriteDeps {
  return { ...f.deps, ai, gatewayId: "gw_test", bucket: f.bucket };
}

describe("write job", () => {
  test("happy path: the job succeeds, the sealed result opens for the device and matches the schema", async () => {
    const f = await makeJobFixture("overview_script");
    const { ai } = fakeAi(SCRIPT_JSON);
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(true);
    const stored = f.objects.get("results/job_1");
    expect(stored).toBeDefined();
    const opened = await openResult(stored?.value ?? new Uint8Array(), "job_1", "device_1", f.device.boxPrivate);
    const parsed = OverviewScriptResultSchema.parse(JSON.parse(new TextDecoder().decode(opened)));
    expect(parsed).toEqual({ v: 1, ...SCRIPT });
    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 40, result_key: "results/job_1" });
    expect(f.objects.has("tmp/input/job_1")).toBe(false);
    expect(f.pushes).toEqual([{ user_id: "u1", kind: "job_ready", ref: "job_1", device_id: "device_1" }]);
    expect(f.usage).toHaveLength(1);
    expect(f.usage[0]).toMatchObject({ outcome: "ok", credits: 40, tokens_in: 10, tokens_out: 20, task: "overview_script" });
  });

  test("the model call uses the route's model, the spec's token cap and the spec's system message", async () => {
    const f = await makeJobFixture("overview_script");
    const { ai, calls } = fakeAi(SCRIPT_JSON);
    await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("@cf/test/strong");
    expect(calls[0]?.inputs.max_tokens).toBe(4000);
    const messages = calls[0]?.inputs.messages as ChatMessage[];
    expect(messages[0]).toEqual({ role: "system", content: WRITE_SPECS.overview_script?.system });
    expect(messages[1]?.content).toBe(`Source text:\n${TEXT}`);
  });

  test("with an instruction the user message starts with it", async () => {
    const f = await makeJobFixture("overview_script", { input: { text: TEXT, prompt: "Focus on plants" } });
    const { ai, calls } = fakeAi(SCRIPT_JSON);
    await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input);
    const messages = calls[0]?.inputs.messages as ChatMessage[];
    expect(messages[1]?.content.startsWith("Instruction from the student: Focus on plants\n\nSource text:\n")).toBe(true);
  });

  test("a reply with the JSON inside prose and a json fence still succeeds", async () => {
    const f = await makeJobFixture("overview_script");
    const { ai } = fakeAi(`Here is the script:\n\`\`\`json\n${SCRIPT_JSON}\n\`\`\`\nEnjoy.`);
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(true);
    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 40 });
  });

  test("a reply whose script has three lines fails the job, releases the hold and stores no result", async () => {
    const f = await makeJobFixture("overview_script");
    const { ai } = fakeAi(JSON.stringify({ title: "Osmosis", lines: SCRIPT.lines.slice(0, 3) }));
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(false);
    expect(f.store.read().monthly).toBe(100);
    expect(f.objects.has("results/job_1")).toBe(false);
    expect(f.usage[0]).toMatchObject({ outcome: "model_failed" });
  });

  test("ai.run rejects: the job fails, the hold is released and no result is stored", async () => {
    const f = await makeJobFixture("overview_script");
    const { ai } = fakeAi("", new Error("model down"));
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(false);
    expect(f.store.read().monthly).toBe(100);
    expect(f.objects.has("results/job_1")).toBe(false);
  });

  test("device removed: the job fails, the hold is released, no result and no push, and the model's tokens are kept", async () => {
    const f = await makeJobFixture("overview_script", { device: "removed" });
    const { ai } = fakeAi(SCRIPT_JSON);
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(false);
    expect(f.store.read().monthly).toBe(100);
    expect(f.objects.has("results/job_1")).toBe(false);
    expect(f.pushes).toEqual([]);
    expect(f.usage[0]).toMatchObject({ outcome: "model_failed", tokens_in: 10 });
  });

  test("no input: the model is never called and the job fails", async () => {
    const f = await makeJobFixture("overview_script", { input: null });
    const { ai, calls } = fakeAi(SCRIPT_JSON);
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("an input key that does not open the input: the model is never called and the job fails", async () => {
    const f = await makeJobFixture("overview_script");
    const { ai, calls } = fakeAi(SCRIPT_JSON);
    const input = { ...f.input, input_key: toBase64Url(new Uint8Array(32)) };
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, input)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("makeWritten with a reply that is not JSON rejects with ModelError so the step is retried", async () => {
    const f = await makeJobFixture("overview_script");
    const { ai } = fakeAi("not json");
    await expect(makeWritten(writeDeps(f, ai), f.input)).rejects.toBeInstanceOf(ModelError);
  });

  test("the model call gives up at the job's deadline, not after the 10 minute cap", async () => {
    const f = await makeJobFixture("overview_script");
    // Waits for the call's abort signal, then rejects: the call ends only when its time limit does.
    const ai: AiBinding = {
      run: (_model, _inputs, options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("timed out")));
        }),
    };
    const deps = { ...writeDeps(f, ai), now: () => f.input.deadline - 500 };
    await expect(makeWritten(deps, f.input)).rejects.toBeInstanceOf(ModelError);
  }, 5_000);

  test("makeWritten for a type with no spec returns no_input without calling the model", async () => {
    const f = await makeJobFixture("retranscribe", { input: null, minutes: 3 });
    const { ai, calls } = fakeAi(SCRIPT_JSON);
    expect(await makeWritten(writeDeps(f, ai), f.input)).toEqual({ ok: false, reason: "no_input", tokens_in: null, tokens_out: null });
    expect(calls).toHaveLength(0);
  });

  test("WRITE_STEP is one retry, 30 s apart, with a 15 minute timeout", () => {
    expect(WRITE_STEP).toEqual({ retries: { limit: 1, delay: 30000, backoff: "constant" }, timeout: 900000 });
  });
});
