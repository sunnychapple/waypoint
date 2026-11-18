import type { RouterAnswers } from "./questions.ts";
import { TIERS, type RouteEntry, type RouteTable, type Tier } from "./routes.ts";

const DEFAULT_MIN_CONFIDENCE = 0.6;

function checkMinConfidence(minConfidence: number): void {
  if (!Number.isFinite(minConfidence) || minConfidence <= 0 || minConfidence > 1) {
    throw new RangeError("minConfidence must be a finite number greater than 0 and at most 1");
  }
}

export function chooseTier(answers: RouterAnswers, minConfidence = DEFAULT_MIN_CONFIDENCE): Tier {
  checkMinConfidence(minConfidence);
  // "Unsure" means only difficulty.p below minConfidence; the other answers do not change the tier.
  if (answers.difficulty.p < minConfidence) return "strong";
  const difficulty = answers.difficulty.value;
  if (difficulty <= 2) return "light";
  if (difficulty <= 4) return "standard";
  return "strong";
}

export type RouteDecision =
  | {
      ok: true;
      // The tier of the entry actually used; differs from requested_tier only when zero retention moves up.
      tier: Tier;
      requested_tier: Tier;
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

function pickEntry(
  routes: RouteTable,
  tier: Tier,
  zeroRetention: boolean,
): { tier: Tier; entry: RouteEntry } | undefined {
  if (!zeroRetention) {
    const entry = routes.tiers[tier][0];
    return entry === undefined ? undefined : { tier, entry };
  }
  // Zero retention: the first zero entry in this tier, else in the next stronger tiers.
  for (const candidate of TIERS.slice(TIERS.indexOf(tier))) {
    const zero = routes.tiers[candidate].find((entry) => entry.retention === "zero");
    if (zero) return { tier: candidate, entry: zero };
  }
  return undefined;
}

export function decideRoute(input: DecideRouteInput): RouteDecision {
  const minConfidence = input.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  checkMinConfidence(minConfidence);
  const { answers } = input;

  const fixedTier = Object.hasOwn(input.routes.fixed, input.task)
    ? input.routes.fixed[input.task]
    : undefined;
  let requestedTier: Tier;
  if (fixedTier !== undefined) {
    requestedTier = fixedTier;
  } else if (answers !== undefined) {
    requestedTier = chooseTier(answers, minConfidence);
  } else {
    return { ok: false, reason: "answers_required" };
  }

  const picked = pickEntry(input.routes, requestedTier, input.zeroRetention);
  if (picked === undefined) return { ok: false, reason: "no_zero_retention_route" };

  const offerResearch =
    answers !== undefined && answers.needs_web.value && answers.needs_web.p >= minConfidence;
  const unsafe = answers !== undefined && answers.unsafe.value && answers.unsafe.p >= minConfidence;

  return {
    ok: true,
    tier: picked.tier,
    requested_tier: requestedTier,
    model: picked.entry.model,
    retention: picked.entry.retention,
    offerResearch,
    unsafe,
  };
}
