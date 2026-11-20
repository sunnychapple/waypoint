import { z } from "zod";

// What the model must write for an audio overview. z.object (not strict): keys the model adds are dropped.
export const OverviewScriptDraftSchema = z.object({
  title: z.string().min(1).max(120),
  lines: z
    .array(z.object({ host: z.enum(["A", "B"]), text: z.string().min(1).max(1200) }))
    .min(4)
    .max(200),
});

// The sealed result of an overview_script job, as the app opens it.
export const OverviewScriptResultSchema = OverviewScriptDraftSchema.extend({ v: z.literal(1) });

export type OverviewScriptResult = z.infer<typeof OverviewScriptResultSchema>;
