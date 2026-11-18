import type { RouterAnswers } from "./questions.ts";
import { TIERS, type RouteEntry, type RouteTable, type Tier } from "./routes.ts";

const DEFAULT_MIN_CONFIDENCE = 0.6;

export function chooseTier(answers: RouterAnswers, minConfidence = DEFAULT_MIN_CONFIDENCE): Tier {
  if (answers.difficulty.p < minConfidence) return "strong";
  const difficulty = answers.difficulty.value;
  if (difficulty <= 2) return "light";
  if (difficulty <= 4) return "standard";
  return "strong";
}

export type RouteDecision =
  | {
      ok: true;
      tier: Tier;
      model: string;
      retention: RouteEntry["retention"];
      offerResearch: boolean;
      unsafe: boolean;
    }
  | { ok: false; reason: "no_zero_retention_route" | "answers_required" };

export type DecideRouteInput = {
  task: string;
  answers?: RouterAnswers;
  zeroRetention: boolean;
  routes: RouteTable;
  minConfidence?: number;
};

function pickEntry(routes: RouteTable, tier: Tier, zeroRetention: boolean): RouteEntry | undefined {
  if (!zeroRetention) return routes.tiers[tier][0];
  // Zero retention: the first zero entry in this tier, else in the next stronger tiers.
  for (const candidate of TIERS.slice(TIERS.indexOf(tier))) {
    const zero = routes.tiers[candidate].find((entry) => entry.retention === "zero");
    if (zero) return zero;
  }
  return undefined;
}

export function decideRoute(input: DecideRouteInput): RouteDecision {
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const { answers } = input;

  const fixedTier = input.routes.fixed[input.task];
  let tier: Tier;
  if (fixedTier !== undefined) {
    tier = fixedTier;
  } else if (answers !== undefined) {
    tier = chooseTier(answers, minConfidence);
  } else {
    return { ok: false, reason: "answers_required" };
  }

  const entry = pickEntry(input.routes, tier, input.zeroRetention);
  if (entry === undefined) return { ok: false, reason: "no_zero_retention_route" };

  const offerResearch =
    answers !== undefined && answers.needs_web.value && answers.needs_web.p >= minConfidence;
  const unsafe = answers !== undefined && answers.unsafe.value && answers.unsafe.p >= minConfidence;

  return {
    ok: true,
    tier,
    model: entry.model,
    retention: entry.retention,
    offerResearch,
    unsafe,
  };
}
