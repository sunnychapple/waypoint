import { z } from "zod";
import { RESEARCH_DEPTHS } from "./tasks.ts";

export const QUOTE_TASKS = [
  "explain",
  "more_detail",
  "double_check",
  "research",
  "overview_script",
  "video_slides",
  "diagram",
  "mini_app",
  "practice",
  "retranscribe",
] as const;

export const QuoteRequestSchema = z
  .strictObject({
    task: z.enum(QUOTE_TASKS),
    minutes: z.number().gt(0).max(600).optional(),
    depth: z.enum(RESEARCH_DEPTHS).optional(),
    fallback_voice: z.boolean().optional(),
  })
  .superRefine((req, ctx) => {
    if (req.task === "research" && req.depth === undefined) {
      ctx.addIssue({ code: "custom", message: "research requires depth", path: ["depth"] });
    }
    if (req.task !== "research" && req.depth !== undefined) {
      ctx.addIssue({ code: "custom", message: "depth is only allowed for research", path: ["depth"] });
    }
    if (req.task === "retranscribe" && req.minutes === undefined) {
      ctx.addIssue({ code: "custom", message: "retranscribe requires minutes", path: ["minutes"] });
    }
    if (
      req.minutes !== undefined &&
      req.task !== "overview_script" &&
      req.task !== "retranscribe"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "minutes is only allowed for overview_script and retranscribe",
        path: ["minutes"],
      });
    }
    if (
      req.fallback_voice === true &&
      req.task !== "overview_script" &&
      req.task !== "video_slides"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "fallback_voice is only allowed for overview_script and video_slides",
        path: ["fallback_voice"],
      });
    }
  });

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const QuoteResponseSchema = z.strictObject({
  credits: z.number().int().min(1),
  price_table: z.string().min(1),
  retention: z.enum(["standard", "zero"]),
  balance_after: z.number().int().min(0),
  expires_in: z.number().int().min(1),
});

export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;
