import { describe, expect, test } from "vitest";
import {
  DiagramDraftSchema,
  DiagramResultSchema,
  MiniAppDraftSchema,
  MiniAppResultSchema,
  PracticeSetDraftSchema,
  PracticeSetResultSchema,
  ProblemHelpDraftSchema,
  ProblemHelpResultSchema,
  VideoSlidesDraftSchema,
  VideoSlidesResultSchema,
} from "../src/made.ts";

const SLIDE = { heading: "Osmosis", bullets: ["Water moves", "Across a membrane"], narration: "Water crosses the membrane." };
const VIDEO = { title: "Osmosis", slides: [SLIDE, SLIDE, SLIDE] };
const MC = { kind: "multiple_choice", prompt: "Which way?", choices: ["In", "Out"], answer: 1, explanation: "Out is right." };
const SA = { kind: "short_answer", prompt: "What moves?", answer: "Water", explanation: "Water moves." };

describe("made job schemas", () => {
  test("video slides: three slides parse; two slides, six bullets on a slide and an 81-character heading are rejected", () => {
    expect(VideoSlidesDraftSchema.parse(VIDEO)).toEqual(VIDEO);
    expect(VideoSlidesDraftSchema.safeParse({ ...VIDEO, slides: [SLIDE, SLIDE] }).success).toBe(false);
    expect(VideoSlidesDraftSchema.safeParse({ ...VIDEO, slides: [{ ...SLIDE, bullets: Array(6).fill("x") }, SLIDE, SLIDE] }).success).toBe(false);
    expect(VideoSlidesDraftSchema.safeParse({ ...VIDEO, slides: [{ ...SLIDE, heading: "x".repeat(81) }, SLIDE, SLIDE] }).success).toBe(false);
  });

  test("diagram: each of the four kinds parses; kind pie and an empty mermaid are rejected", () => {
    for (const kind of ["flowchart", "mindmap", "timeline", "sequence"]) {
      expect(DiagramDraftSchema.safeParse({ title: "Cells", kind, mermaid: "flowchart TD\n  A-->B" }).success).toBe(true);
    }
    expect(DiagramDraftSchema.safeParse({ title: "Cells", kind: "pie", mermaid: "pie" }).success).toBe(false);
    expect(DiagramDraftSchema.safeParse({ title: "Cells", kind: "flowchart", mermaid: "" }).success).toBe(false);
  });

  test("mini app: inline markup and a data: image parse", () => {
    const html = '<p>See https://example.com</p><img src="data:image/png;base64,AA">';
    expect(MiniAppDraftSchema.safeParse({ title: "Slider", html }).success).toBe(true);
  });

  test("mini app: an external script src, a protocol-relative link href and an unquoted http src are rejected", () => {
    for (const html of [
      '<script src="https://cdn.example.com/x.js"></script>',
      '<link href="//cdn.example.com/a.css">',
      "<img src=http://x.example/a.png>",
    ]) {
      expect(MiniAppDraftSchema.safeParse({ title: "Slider", html }).success).toBe(false);
    }
  });

  test("practice set: three questions mixing both kinds parse", () => {
    const parsed = PracticeSetDraftSchema.parse({ title: "Osmosis", questions: [MC, SA, MC] });
    expect(parsed.questions).toHaveLength(3);
  });

  test("practice set: a multiple-choice answer that indexes no choice, and kind essay, are rejected", () => {
    const bad = { ...MC, choices: ["In", "Out"], answer: 2 };
    expect(PracticeSetDraftSchema.safeParse({ title: "Osmosis", questions: [bad, SA, MC] }).success).toBe(false);
    expect(PracticeSetDraftSchema.safeParse({ title: "Osmosis", questions: [{ ...SA, kind: "essay" }, SA, MC] }).success).toBe(false);
  });

  test("each of the four result schemas needs v: 1", () => {
    const body = { title: "Osmosis", slides: [SLIDE, SLIDE, SLIDE] };
    expect(VideoSlidesResultSchema.parse({ v: 1, ...body }).v).toBe(1);
    expect(VideoSlidesResultSchema.safeParse(body).success).toBe(false);
    expect(DiagramResultSchema.parse({ v: 1, title: "Cells", kind: "mindmap", mermaid: "mindmap\n  root" }).v).toBe(1);
    expect(DiagramResultSchema.safeParse({ title: "Cells", kind: "mindmap", mermaid: "mindmap" }).success).toBe(false);
    expect(MiniAppResultSchema.parse({ v: 1, title: "Slider", html: "<p>Hi</p>" }).v).toBe(1);
    expect(MiniAppResultSchema.safeParse({ v: 2, title: "Slider", html: "<p>Hi</p>" }).success).toBe(false);
    expect(PracticeSetResultSchema.parse({ v: 1, title: "Osmosis", questions: [MC, SA, MC] }).v).toBe(1);
    expect(PracticeSetResultSchema.safeParse({ title: "Osmosis", questions: [MC, SA, MC] }).success).toBe(false);
  });
});

describe("problem help", () => {
  const STEP = { step: "Read what the question asks.", why: "Knowing the goal tells you which facts matter." };

  test("a readable reply with steps and an answer parses; keys the model adds are dropped", () => {
    const parsed = ProblemHelpDraftSchema.parse({ readable: true, steps: [STEP, STEP], answer: "The answer.", extra: 1 });
    expect(parsed).toEqual({ readable: true, steps: [STEP, STEP], answer: "The answer." });
  });

  test("an unreadable reply with a reason parses", () => {
    expect(ProblemHelpDraftSchema.parse({ readable: false, reason: "The question is cut off." })).toEqual({ readable: false, reason: "The question is cut off." });
  });

  test("no steps, nine steps, an empty answer, a step without why, and readable missing are rejected", () => {
    for (const body of [
      { readable: true, steps: [], answer: "A" },
      { readable: true, steps: Array.from({ length: 9 }, () => STEP), answer: "A" },
      { readable: true, steps: [STEP], answer: "" },
      { readable: true, steps: [{ step: "Do it." }], answer: "A" },
      { steps: [STEP], answer: "A" },
      { readable: false, reason: "" },
    ]) {
      expect(ProblemHelpDraftSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  test("the result needs v: 1, readable or not", () => {
    expect(ProblemHelpResultSchema.parse({ v: 1, readable: true, steps: [STEP], answer: "A" }).v).toBe(1);
    expect(ProblemHelpResultSchema.parse({ v: 1, readable: false, reason: "Too blurry." }).v).toBe(1);
    expect(ProblemHelpResultSchema.safeParse({ readable: true, steps: [STEP], answer: "A" }).success).toBe(false);
  });
});
