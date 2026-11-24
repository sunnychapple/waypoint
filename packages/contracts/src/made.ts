import { z } from "zod";

// What the model must write for each of these jobs. z.object (not strict): keys the model adds are dropped.
export const VideoSlidesDraftSchema = z.object({
  title: z.string().min(1).max(120),
  slides: z
    .array(
      z.object({
        heading: z.string().min(1).max(80),
        bullets: z.array(z.string().min(1).max(120)).max(5),
        narration: z.string().min(1).max(700),
      }),
    )
    .min(3)
    .max(15),
});

export const DIAGRAM_KINDS = ["flowchart", "mindmap", "timeline", "sequence"] as const;
export const DiagramDraftSchema = z.object({
  title: z.string().min(1).max(120),
  kind: z.enum(DIAGRAM_KINDS),
  mermaid: z.string().min(1).max(6_000),
});

// A self-contained page. The app shows it only in a web view with the network blocked and no storage (card M25):
// that is the control. This check only refuses the plain src/href forms of an external URL so a bad draft is
// retried; it is not a defence (scripts, CSS url(), srcset, form actions and meta refresh all pass it).
export const MiniAppDraftSchema = z.object({
  title: z.string().min(1).max(120),
  html: z
    .string()
    .min(1)
    .max(60_000)
    .refine((html) => !/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html), "no external resources"),
});

export const PracticeSetDraftSchema = z.object({
  title: z.string().min(1).max(120),
  questions: z
    .array(
      z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("multiple_choice"),
            prompt: z.string().min(1).max(600),
            choices: z.array(z.string().min(1).max(200)).min(2).max(6),
            answer: z.number().int().min(0).max(5),
            explanation: z.string().min(1).max(600),
          })
          .refine((question) => question.answer < question.choices.length, "answer must index a choice"),
        z.object({
          kind: z.literal("short_answer"),
          prompt: z.string().min(1).max(600),
          answer: z.string().min(1).max(300),
          explanation: z.string().min(1).max(600),
        }),
      ]),
    )
    .min(3)
    .max(20),
});

// Step-by-step help on one problem. When the model can't tell what the problem asks, it says so instead of guessing.
const ProblemHelpStepSchema = z.object({ step: z.string().min(1).max(200), why: z.string().min(1).max(300) });
const ReadableHelpSchema = z.object({
  readable: z.literal(true),
  steps: z.array(ProblemHelpStepSchema).min(1).max(8),
  answer: z.string().min(1).max(600),
});
const UnreadableHelpSchema = z.object({ readable: z.literal(false), reason: z.string().min(1).max(300) });
export const ProblemHelpDraftSchema = z.discriminatedUnion("readable", [ReadableHelpSchema, UnreadableHelpSchema]);

export const VideoSlidesResultSchema = VideoSlidesDraftSchema.extend({ v: z.literal(1) });
export const DiagramResultSchema = DiagramDraftSchema.extend({ v: z.literal(1) });
export const MiniAppResultSchema = MiniAppDraftSchema.extend({ v: z.literal(1) });
export const PracticeSetResultSchema = PracticeSetDraftSchema.extend({ v: z.literal(1) });
export const ProblemHelpResultSchema = z.discriminatedUnion("readable", [
  ReadableHelpSchema.extend({ v: z.literal(1) }),
  UnreadableHelpSchema.extend({ v: z.literal(1) }),
]);

export type VideoSlidesResult = z.infer<typeof VideoSlidesResultSchema>;
export type DiagramResult = z.infer<typeof DiagramResultSchema>;
export type MiniAppResult = z.infer<typeof MiniAppResultSchema>;
export type PracticeSetResult = z.infer<typeof PracticeSetResultSchema>;
export type ProblemHelpResult = z.infer<typeof ProblemHelpResultSchema>;
