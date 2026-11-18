import { z } from "zod";

export const SUBJECTS = ["math", "science", "language", "history", "other"] as const;

// The four questions the router answers, as in docs/architecture.md section 6.
export const ROUTER_QUESTIONS = {
  difficulty: { kind: "score", range: [1, 5], text: "Difficulty, score 1 to 5" },
  needs_web: { kind: "yes_no", text: "Needs the web" },
  subject: { kind: "choice", options: SUBJECTS, text: "Subject" },
  unsafe: { kind: "yes_no", text: "Unsafe" },
} as const;

const Probability = z.number().min(0).max(1);

export const RouterAnswersSchema = z.strictObject({
  difficulty: z.strictObject({ value: z.number().int().min(1).max(5), p: Probability }),
  needs_web: z.strictObject({ value: z.boolean(), p: Probability }),
  subject: z.strictObject({ value: z.enum(SUBJECTS), p: Probability }),
  unsafe: z.strictObject({ value: z.boolean(), p: Probability }),
});

export type RouterAnswers = z.infer<typeof RouterAnswersSchema>;
