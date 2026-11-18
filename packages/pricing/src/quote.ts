import { PRICE_KEYS, type PriceKey, type PriceTable } from "./table.ts";

export type QuoteInput = {
  task: string;
  depth?: "quick" | "standard" | "deep";
  minutes?: number;
  fallback_voice?: boolean;
};

function isPriceKey(value: string): value is PriceKey {
  return (PRICE_KEYS as readonly string[]).includes(value);
}

export function priceKeyFor(input: QuoteInput): PriceKey {
  const { task, depth } = input;
  if (task === "research") {
    if (depth === undefined) {
      throw new Error("research tasks need a depth");
    }
    return `research_${depth}`;
  }
  if (task === "retranscribe") {
    return "retranscribe";
  }
  if (task !== "fallback_voice" && isPriceKey(task)) {
    return task;
  }
  throw new Error(`unknown task: ${task}`);
}

export function quoteCredits(table: PriceTable, input: QuoteInput): number {
  const key = priceKeyFor(input);
  let credits = table.credits[key];
  if (key === "retranscribe") {
    const { minutes } = input;
    if (minutes === undefined || !(minutes > 0)) {
      throw new Error("retranscribe needs minutes > 0");
    }
    credits *= Math.ceil(minutes);
  }
  if (input.fallback_voice === true) {
    credits += table.credits.fallback_voice;
  }
  return credits;
}
