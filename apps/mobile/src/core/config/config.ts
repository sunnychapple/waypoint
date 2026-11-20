import { ConfigResponseSchema, type ConfigResponse } from "@waypoint/contracts";

// How long a fetched config is used before the app asks again (on launch and when it comes back to the front).
export const CONFIG_MAX_AGE_MS = 10 * 60 * 1000;

// "1.4" or "1.4.2" → [1, 4, 2]. Anything else → null.
export function parseVersion(text: string): [number, number, number] | null {
  const match = /^(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?$/.exec(text.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
}

// True when this build is older than the oldest build the server supports. A version that cannot be read never
// blocks anything.
export function needsUpdate(native: string | null, minNative: string): boolean {
  const have = native === null ? null : parseVersion(native);
  const need = parseVersion(minNative);
  if (have === null || need === null) return false;
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

export function isStale(fetchedAt: number | null, now: number): boolean {
  // A value that is not a number (a damaged setting) counts as stale; NaN would fail every comparison below.
  return fetchedAt === null || !Number.isFinite(fetchedAt) || now - fetchedAt >= CONFIG_MAX_AGE_MS || now < fetchedAt;
}

// The cached config from the settings table, or null when it is missing or does not match the contract.
export function parseCachedConfig(text: string | null): ConfigResponse | null {
  if (text === null) return null;
  try {
    const parsed = ConfigResponseSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Credits for a price key in the live price table ("explain", "more_detail", ...), or null when unknown.
export function priceOf(config: ConfigResponse | null, key: string): number | null {
  if (config === null || !Object.hasOwn(config.prices.credits, key)) return null;
  return config.prices.credits[key] ?? null;
}

// "1 credit", "3 credits", "2,000 credits".
export function creditsLabel(credits: number): string {
  const digits = String(credits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${digits} ${credits === 1 ? "credit" : "credits"}`;
}
