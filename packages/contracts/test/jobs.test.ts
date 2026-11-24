import { describe, expect, test } from "vitest";
import {
  CreateJobRequestSchema,
  JOB_PROBLEM_MAX_CHARS,
  JOB_TEXT_MAX_CHARS,
  JobResponseSchema,
  JobViewSchema,
} from "../src/jobs.ts";

const RESEARCH = { type: "research", depth: "standard", question: "Why is the sky blue?" };
const OVERVIEW = { type: "overview_script", text: "the cell takes in water" };
const VIEW = {
  id: "job_abcdefghijklmnopqrstuv",
  type: "research",
  state: "running",
  quoted: 40,
  spent: null,
  tier: "strong",
  retention: "standard",
  result_ready: false,
  created_at: 1000,
  finished_at: null,
  expires_at: null,
};

function rejects(body: unknown): boolean {
  return !CreateJobRequestSchema.safeParse(body).success;
}

describe("CreateJobRequestSchema", () => {
  test("one valid body for each of the seven types parses, and text comes back trimmed", () => {
    const valid = [
      RESEARCH,
      { ...RESEARCH, text: "notes" },
      OVERVIEW,
      { ...OVERVIEW, prompt: "make it short" },
      { type: "video_slides", text: "the cell", fallback_voice: true },
      { type: "diagram", text: "the cell" },
      { type: "mini_app", text: "the cell", prompt: "a quiz" },
      { type: "practice", text: "the cell" },
      { type: "retranscribe", minutes: 4.2 },
    ];
    for (const body of valid) {
      expect(CreateJobRequestSchema.parse(body)).toEqual(body);
    }
    expect(CreateJobRequestSchema.parse({ type: "diagram", text: "  the cell  " })).toEqual({ type: "diagram", text: "the cell" });
  });

  test("rejects each bad body the card lists: type, text, length, prompt, fields and minutes", () => {
    const bad: unknown[] = [
      { type: "summarize", text: "the cell" },
      { type: "overview_script" },
      { ...OVERVIEW, text: "" },
      { ...OVERVIEW, text: "   " },
      { ...OVERVIEW, text: "a".repeat(JOB_TEXT_MAX_CHARS.overview_script + 1) },
      { type: "diagram", text: "a".repeat(JOB_TEXT_MAX_CHARS.diagram + 1) },
      { ...RESEARCH, text: "a".repeat(JOB_TEXT_MAX_CHARS.research + 1) },
      { type: "research", question: "Why?" },
      { ...RESEARCH, depth: undefined },
      { ...RESEARCH, question: undefined },
      { ...RESEARCH, question: "a".repeat(501) },
      { ...OVERVIEW, prompt: "a".repeat(501) },
      { ...RESEARCH, prompt: "make it short" },
      { type: "diagram", text: "the cell", fallback_voice: true },
      { ...OVERVIEW, minutes: 4 },
      { type: "retranscribe", minutes: 4, text: "the cell" },
      { type: "retranscribe", minutes: 0 },
      { type: "retranscribe", minutes: 601 },
      { ...OVERVIEW, extra: true },
    ];
    for (const body of bad) {
      expect(rejects(body), JSON.stringify(body).slice(0, 80)).toBe(true);
    }
    expect(CreateJobRequestSchema.safeParse({ type: "retranscribe", minutes: 600 }).success).toBe(true);
    expect(CreateJobRequestSchema.safeParse({ ...OVERVIEW, text: "a".repeat(JOB_TEXT_MAX_CHARS.overview_script) }).success).toBe(true);
    expect(CreateJobRequestSchema.safeParse({ type: "diagram", text: "a".repeat(JOB_TEXT_MAX_CHARS.diagram) }).success).toBe(true);
  });

  test("JOB_TEXT_MAX_CHARS is exactly the card's limits", () => {
    expect(JOB_TEXT_MAX_CHARS).toEqual({
      overview_script: 40000,
      video_slides: 48000,
      diagram: 16000,
      mini_app: 24000,
      practice: 28000,
      research: 8000,
      problem_help: 4000,
    });
  });
});

describe("job views", () => {
  test("JobViewSchema accepts a full view and rejects an extra key, tier huge, quoted 0 and state paused; JobResponseSchema wraps it", () => {
    expect(JobViewSchema.parse(VIEW)).toEqual(VIEW);
    expect(JobViewSchema.safeParse({ ...VIEW, extra: 1 }).success).toBe(false);
    expect(JobViewSchema.safeParse({ ...VIEW, tier: "huge" }).success).toBe(false);
    expect(JobViewSchema.safeParse({ ...VIEW, quoted: 0 }).success).toBe(false);
    expect(JobViewSchema.safeParse({ ...VIEW, state: "paused" }).success).toBe(false);
    expect(JobResponseSchema.parse({ job: VIEW })).toEqual({ job: VIEW });
  });
});

describe("problem_help requests", () => {
  const HELP = { type: "problem_help", problem: "Find the missing value.", text: "Exercise 4. Find the missing value. Show your work." };

  test("a problem and its page text parse, trimmed", () => {
    expect(CreateJobRequestSchema.parse(HELP)).toEqual(HELP);
    expect(CreateJobRequestSchema.parse({ ...HELP, problem: "  Find it.  " })).toEqual({ ...HELP, problem: "Find it." });
  });

  test("the caps are exact: problem 2,000 and text 4,000 characters", () => {
    expect(CreateJobRequestSchema.safeParse({ ...HELP, problem: "a".repeat(JOB_PROBLEM_MAX_CHARS) }).success).toBe(true);
    expect(CreateJobRequestSchema.safeParse({ ...HELP, problem: "a".repeat(JOB_PROBLEM_MAX_CHARS + 1) }).success).toBe(false);
    expect(CreateJobRequestSchema.safeParse({ ...HELP, text: "a".repeat(JOB_TEXT_MAX_CHARS.problem_help) }).success).toBe(true);
    expect(CreateJobRequestSchema.safeParse({ ...HELP, text: "a".repeat(JOB_TEXT_MAX_CHARS.problem_help + 1) }).success).toBe(false);
  });

  test("an empty page text is allowed, and a missing one is not", () => {
    expect(CreateJobRequestSchema.parse({ ...HELP, text: "" })).toEqual({ ...HELP, text: "" });
    expect(CreateJobRequestSchema.parse({ ...HELP, text: "   " })).toEqual({ ...HELP, text: "" });
    expect(CreateJobRequestSchema.safeParse({ type: "problem_help", problem: "Find it." }).success).toBe(false);
  });

  test("a blank problem, a missing text, a prompt and an extra key are rejected", () => {
    for (const body of [{ ...HELP, problem: "   " }, { type: "problem_help", problem: "Find it." }, { ...HELP, prompt: "short" }, { ...HELP, extra: 1 }]) {
      expect(CreateJobRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});
