import { PRICE_KEYS, type PriceKey, type PriceTable } from "./table.ts";

export type QuoteInput = {
  task: string;
  depth?: "quick" | "standard" | "deep" | undefined;
  minutes?: number | undefined;
  fallback_voice?: boolean | undefined;
};

// An own-property lookup, so inherited names such as "toString" are not keys.
const PRICE_KEY_SET: Readonly<Record<string, true>> = Object.fromEntries(
  PRICE_KEYS.map((key): [PriceKey, true] => [key, true]),
);

function isPriceKey(value: string): value is PriceKey {
  return Object.hasOwn(PRICE_KEY_SET, value);
}

export function priceKeyFor(input: QuoteInput): PriceKey {
  const { task, depth } = input;
  if (task === "research") {
    if (depth === undefined) {
      throw new Error("research tasks need a depth");
    }
    const key = `research_${depth}`;
    if (isPriceKey(key)) {
      return key;
    }
    throw new Error(`unknown task: ${task}`);
  }
  if (task === "retranscribe") {
    return "retranscribe";
  }
  if (task !== "fallback_voice" && isPriceKey(task)) {
    return task;
  }
  throw new Error(`unknown task: ${task}`);
}

const OVERVIEW_TASKS: readonly string[] = ["overview_script", "video_slides"];

export function quoteCredits(table: PriceTable, input: QuoteInput): number {
  const key = priceKeyFor(input);
  let credits = table.credits[key];
  if (key === "retranscribe") {
    const { minutes } = input;
    if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
      throw new RangeError(
        `retranscribe needs minutes > 0 and at most 600, got ${minutes}`,
      );
    }
    credits *= Math.ceil(minutes);
  }
  if (input.fallback_voice === true) {
    if (!OVERVIEW_TASKS.includes(input.task)) {
      throw new Error("fallback_voice is only for overviews");
    }
    credits += table.credits.fallback_voice;
  }
  return credits;
}
