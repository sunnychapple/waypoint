import { z } from "zod";

// The sealed result of a research job. answer is Markdown that cites sources as [n].
export const ResearchResultSchema = z.strictObject({
  v: z.literal(1),
  answer: z.string().min(1),
  sources: z.array(z.strictObject({ n: z.number().int().min(1), url: z.string(), title: z.string() })),
});

export type ResearchResult = z.infer<typeof ResearchResultSchema>;
