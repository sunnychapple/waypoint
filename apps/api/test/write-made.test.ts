import { DiagramResultSchema, MiniAppResultSchema, PracticeSetResultSchema, ProblemHelpResultSchema, VideoSlidesResultSchema } from "@waypoint/contracts";
import { openResult } from "@waypoint/crypto";
import type { z } from "zod";
import { describe, expect, test } from "vitest";
import type { AiBinding, GatewayCallOptions } from "../src/ai/gateway.ts";
import { runWriteJob, WRITE_SPECS, type WriteDeps } from "../src/jobs/write.ts";
import type { ChatMessage } from "../src/tasks/instant.ts";
import { fakeSteps, makeJobFixture } from "./helpers/jobs.ts";

const TEXT = "Osmosis moves water across a membrane.";

const SLIDE = { heading: "Osmosis", bullets: ["Water moves", "Across a membrane"], narration: "Water crosses the membrane." };
const MC = { kind: "multiple_choice", prompt: "Which way?", choices: ["In", "Out"], answer: 1, explanation: "Out is right." };
const SA = { kind: "short_answer", prompt: "What moves?", answer: "Water", explanation: "Water moves." };

// One valid reply and one the draft schema rejects, per type, with the token cap the card gives.
const CASES: {
  type: "video_slides" | "diagram" | "mini_app" | "practice";
  maxTokens: number;
  valid: unknown;
  invalid: unknown;
  schema: z.ZodType;
}[] = [
  {
    type: "video_slides",
    maxTokens: 4000,
    valid: { title: "Osmosis", slides: [SLIDE, SLIDE, SLIDE] },
    invalid: { title: "Osmosis", slides: [SLIDE, SLIDE] },
    schema: VideoSlidesResultSchema,
  },
  {
    type: "diagram",
    maxTokens: 1200,
    valid: { title: "Osmosis", kind: "flowchart", mermaid: "flowchart TD\n  A-->B" },
    invalid: { title: "Osmosis", kind: "pie", mermaid: "pie" },
    schema: DiagramResultSchema,
  },
  {
    type: "mini_app",
    maxTokens: 6000,
    valid: { title: "Osmosis", html: "<p>Water moves across a membrane.</p>" },
    invalid: { title: "Osmosis", html: '<script src="https://cdn.example.com/x.js"></script>' },
    schema: MiniAppResultSchema,
  },
  {
    type: "practice",
    maxTokens: 2500,
    valid: { title: "Osmosis", questions: [MC, SA, MC] },
    invalid: { title: "Osmosis", questions: [{ ...SA, kind: "essay" }, SA, MC] },
    schema: PracticeSetResultSchema,
  },
];

// A fake Workers AI binding: records each call and answers with the content given.
function fakeAi(content: string) {
  const calls: { model: string; inputs: Record<string, unknown>; options: { gateway: GatewayCallOptions; signal?: AbortSignal } }[] = [];
  const ai: AiBinding = {
    run: async (model, inputs, options) => {
      calls.push({ model, inputs, options });
      return { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } };
    },
  };
  return { ai, calls };
}

// The write deps for a fixture: its own deps plus the fake model and the gateway id.
function writeDeps(f: Awaited<ReturnType<typeof makeJobFixture>>, ai: AiBinding): WriteDeps {
  return { ...f.deps, ai, gatewayId: "gw_test", bucket: f.bucket };
}

describe("made job Workflows", () => {
  test("WRITE_SPECS has exactly the keys overview_script, video_slides, diagram, mini_app, practice and problem_help", () => {
    expect(Object.keys(WRITE_SPECS).sort()).toEqual(["diagram", "mini_app", "overview_script", "practice", "problem_help", "video_slides"]);
  });

  for (const c of CASES) {
    test(`${c.type}: a valid reply is sealed, opens to a result the schema parses with v: 1, and the job succeeds`, async () => {
      const f = await makeJobFixture(c.type);
      const { ai, calls } = fakeAi(JSON.stringify(c.valid));
      expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(true);
      const stored = f.objects.get("results/job_1");
      expect(stored).toBeDefined();
      const opened = await openResult(stored?.value ?? new Uint8Array(), "job_1", "device_1", f.device.boxPrivate);
      const parsed = c.schema.parse(JSON.parse(new TextDecoder().decode(opened)));
      expect(parsed).toMatchObject({ v: 1 });
      expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 40, result_key: "results/job_1" });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.inputs.max_tokens).toBe(c.maxTokens);
      const messages = calls[0]?.inputs.messages as ChatMessage[];
      expect(messages[0]).toEqual({ role: "system", content: WRITE_SPECS[c.type]?.system });
      expect(messages[1]?.content).toBe(`Source text:\n${TEXT}`);
    });

    test(`${c.type}: a reply its draft schema rejects fails the job, releases the hold and stores no result`, async () => {
      const f = await makeJobFixture(c.type);
      const { ai } = fakeAi(JSON.stringify(c.invalid));
      expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(false);
      expect(f.store.read().monthly).toBe(100);
      expect(f.objects.has("results/job_1")).toBe(false);
      expect(await f.jobRow()).toMatchObject({ state: "failed" });
    });
  }
});

describe("problem help Workflow", () => {
  const SENT = { text: "Exercise 4. Find the missing value. Then check it.", prompt: "Find the missing value." };
  const STEP = { step: "Read what the question asks.", why: "Knowing the goal tells you which facts matter." };

  test("a readable reply is sealed with v: 1 and settles at the quote; the user message holds the problem, then the page text", async () => {
    const f = await makeJobFixture("problem_help", { credits: 5, input: SENT });
    const { ai, calls } = fakeAi(JSON.stringify({ readable: true, steps: [STEP, STEP], answer: "The answer." }));
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(true);
    const opened = await openResult(f.objects.get("results/job_1")?.value ?? new Uint8Array(), "job_1", "device_1", f.device.boxPrivate);
    expect(ProblemHelpResultSchema.parse(JSON.parse(new TextDecoder().decode(opened)))).toEqual({ v: 1, readable: true, steps: [STEP, STEP], answer: "The answer." });
    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 5 });
    expect(calls[0]?.inputs.max_tokens).toBe(1500);
    const messages = calls[0]?.inputs.messages as ChatMessage[];
    expect(messages[1]?.content).toBe(`Problem:\n${SENT.prompt}\n\nText around it on the page:\n${SENT.text}`);
  });

  test("an unreadable reply is sealed and settles at 1 credit; the rest of the hold goes back", async () => {
    const f = await makeJobFixture("problem_help", { credits: 5, input: SENT });
    const { ai } = fakeAi(JSON.stringify({ readable: false, reason: "The question is cut off." }));
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(true);
    expect(await f.jobRow()).toMatchObject({ state: "succeeded", spent: 1 });
    expect(f.store.read().monthly).toBe(99);
  });

  test("a reply with no steps fails the job, releases the hold and stores no result", async () => {
    const f = await makeJobFixture("problem_help", { credits: 5, input: SENT });
    const { ai } = fakeAi(JSON.stringify({ readable: true, steps: [], answer: "The answer." }));
    expect(await runWriteJob(writeDeps(f, ai), fakeSteps().steps, f.input)).toBe(false);
    expect(f.store.read().monthly).toBe(100);
    expect(f.objects.has("results/job_1")).toBe(false);
    expect(await f.jobRow()).toMatchObject({ state: "failed" });
  });

  test("the system prompt is generic: any subject, numbered steps with a why, and what to say when the problem can't be read", () => {
    const system = WRITE_SPECS.problem_help?.system ?? "";
    expect(system).toContain("any subject, in any language");
    expect(system).toContain("short why");
    expect(system).toContain('{"readable":false');
  });
});
