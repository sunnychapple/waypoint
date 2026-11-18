export const CREDIT_VALUE_USD = 0.0005;

export function creditsForCost(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new RangeError(`cost must be a finite number >= 0, got ${costUsd}`);
  }
  // The 1e-9 epsilon absorbs float noise so that 0.0015 gives 3, not 4.
  const credits = Math.max(1, Math.ceil(costUsd / CREDIT_VALUE_USD - 1e-9));
  if (!Number.isSafeInteger(credits)) {
    throw new RangeError(`cost ${costUsd} is too large to price in credits`);
  }
  return credits;
}
