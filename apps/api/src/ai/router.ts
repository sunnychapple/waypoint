import type { InstantTask } from "@waypoint/contracts";
import {
  decideRoute,
  RouterAnswersSchema,
  SUBJECTS,
  type RouteDecision,
  type RouterAnswers,
} from "@waypoint/router";
import { z } from "zod";
import type { LoadedConfig } from "../config/load.ts";
import { gatewayOptions, type AiBinding } from "./gateway.ts";

export const ROUTER_TIMEOUT_MS = 3000;

// Used when the router gives no usable answer, and for zero-retention users (the router model is
// not confirmed zero-retention, so their text is never sent to it). p 0 means "unsure", which the
// router package sends to the strong tier.
export const UNSURE_ANSWERS: RouterAnswers = {
  difficulty: { value: 5, p: 0 },
  needs_web: { value: false, p: 0 },
  subject: { value: "other", p: 0 },
  unsafe: { value: false, p: 0 },
};

// Clef-flash takes its questions as data, not as chat messages, so they are sent as this object.
const CLEF_QUESTIONS = {
  difficulty: {
    type: "score",
    instructions: "How hard is a good answer to write for a student?",
    criteria: [
      "a plain definition",
      "a short explanation",
      "a normal explanation",
      "a multi-step explanation",
      "careful expert reasoning",
    ],
  },
  needs_web: { type: "noul", instructions: "Does a good answer need facts newer than or missing from general knowledge?" },
  subject: {
    type: "choice",
    instructions: "Which school subject is this?",
    criteria: { math: null, science: null, language: null, history: null, other: null },
  },
  unsafe: { type: "noul", instructions: "Does the request ask for harmful content?" },
} as const;

const Probability = z.number().min(0).max(1);
const Level = z.enum(["0", "1", "2", "3", "4"]);

// Clef-flash's answers. Fields the mapping does not use (legend, confidence, usage) are dropped.
const ClefReply = z.object({
  answers: z.object({
    // Above 4 is allowed: a score past the top level still means the top level, which the mapping clamps.
    difficulty: z.object({
      type: z.literal("score"),
      score: z.number().min(0).max(5),
      probabilities: z.record(Level, Probability),
    }),
    needs_web: z.object({ type: z.literal("noul"), noul: Probability }),
    subject: z.object({
      type: z.literal("choice"),
      choice: z.enum(SUBJECTS),
      probabilities: z.record(z.enum(SUBJECTS), Probability),
    }),
    unsafe: z.object({ type: z.literal("noul"), noul: Probability }),
  }),
});

// The reply may come bare or wrapped as { result }.
const ClefReplySchema = z.union([ClefReply, z.object({ result: ClefReply })]);

// Score levels that make up each difficulty value's tier band. p for a value is the probability
// that the answer falls in the same tier band, which is what the router package's tiers depend on.
const DIFFICULTY_BANDS: Record<number, z.infer<typeof Level>[]> = {
  1: ["0", "1"],
  2: ["0", "1"],
  3: ["2", "3"],
  4: ["2", "3"],
  5: ["4"],
};

// Clef reads noul as the probability of yes, so the value is yes from one half up.
function yesNo(noul: number): { value: boolean; p: number } {
  const value = noul >= 0.5;
  return { value, p: value ? noul : 1 - noul };
}

function toAnswers(answers: z.infer<typeof ClefReply>["answers"]): RouterAnswers {
  const { difficulty, needs_web, subject, unsafe } = answers;
  const value = Math.min(5, Math.max(1, Math.round(difficulty.score) + 1));
  const band = DIFFICULTY_BANDS[value] ?? [];
  // Clamped to 1 so two band probabilities that round above 1 still pass RouterAnswersSchema.
  const bandP = Math.min(1, band.reduce((sum, level) => sum + difficulty.probabilities[level], 0));
  return {
    difficulty: { value, p: bandP },
    needs_web: yesNo(needs_web.noul),
    subject: { value: subject.choice, p: subject.probabilities[subject.choice] },
    unsafe: yesNo(unsafe.noul),
  };
}

export type RouterInput = { task: InstantTask; question: string; text: string };

// Asks the router model the four questions. Returns null on any failure: the call throws or
// times out, the reply does not match Clef-flash's answer shape, or the mapped answers are not RouterAnswers.
export async function askRouter(
  ai: AiBinding,
  gatewayId: string,
  model: string,
  input: RouterInput,
): Promise<RouterAnswers | null> {
  let output: unknown;
  // The abort signal only helps if the binding honors it, so the wait is also raced against a timer.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("router timeout")), ROUTER_TIMEOUT_MS);
  });
  try {
    output = await Promise.race([ai.run(
      model,
      {
        // The model field is the last path segment of the configured id, e.g. "clef-flash".
        model: model.slice(model.lastIndexOf("/") + 1),
        state: { task: input.task, question: input.question, text: input.text },
        questions: CLEF_QUESTIONS,
      },
      { gateway: gatewayOptions(gatewayId), signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS) },
    ), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  const reply = ClefReplySchema.safeParse(output);
  if (!reply.success) return null;
  const answers = "result" in reply.data ? reply.data.result.answers : reply.data.answers;
  const parsed = RouterAnswersSchema.safeParse(toAnswers(answers));
  return parsed.success ? parsed.data : null;
}

export type RoutedTask = { decision: RouteDecision; router: "ok" | "failed" | "skipped" };

// Picks the route for one instant task. Fixed tasks never call the router. Zero-retention users
// never call it either; they route as unsure. Otherwise a failed router call also routes as unsure.
export async function routeTask(deps: {
  ai: AiBinding;
  gatewayId: string;
  config: LoadedConfig;
  zeroRetention: boolean;
  input: RouterInput;
}): Promise<RoutedTask> {
  const { config, zeroRetention, input } = deps;
  const base = { task: input.task, zeroRetention, routes: config.routes, minConfidence: config.router.min_confidence };
  if (Object.hasOwn(config.routes.fixed, input.task)) {
    return { decision: decideRoute(base), router: "skipped" };
  }
  if (zeroRetention) {
    return { decision: decideRoute({ ...base, answers: UNSURE_ANSWERS }), router: "skipped" };
  }
  const answers = await askRouter(deps.ai, deps.gatewayId, config.router.model, input);
  return {
    decision: decideRoute({ ...base, answers: answers ?? UNSURE_ANSWERS }),
    router: answers === null ? "failed" : "ok",
  };
}
