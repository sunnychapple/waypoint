export const CREDIT_VALUE_USD = 0.0005;

export function creditsForCost(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new RangeError(`cost must be a finite number >= 0, got ${costUsd}`);
  }
  return Math.max(1, Math.ceil(costUsd / CREDIT_VALUE_USD - 1e-9));
}
