import { z } from "zod";

export const PRICE_KEYS = [
  "explain",
  "double_check",
  "more_detail",
  "research_quick",
  "research_standard",
  "research_deep",
  "overview_script",
  "video_slides",
  "diagram",
  "mini_app",
  "practice",
  "retranscribe",
  "fallback_voice",
] as const;

export type PriceKey = (typeof PRICE_KEYS)[number];

// Keys added after the live table was published. A table may leave one out; quoteCredits then uses OPTIONAL_PRICES.
// The next price table version should list them; then they move into PRICE_KEYS.
export const OPTIONAL_PRICE_KEYS = ["problem_help"] as const;
export type OptionalPriceKey = (typeof OPTIONAL_PRICE_KEYS)[number];
// Step-by-step help on one problem (standard tier): about 1,800 tokens in and at most 1,500 out is $0.0023, so 5 credits.
export const OPTIONAL_PRICES: Readonly<Record<OptionalPriceKey, number>> = { problem_help: 5 };

const credit = z.number().int().min(1);
const required = Object.fromEntries(PRICE_KEYS.map((key) => [key, credit])) as Record<PriceKey, typeof credit>;

export const PriceTableSchema = z.strictObject({
  version: z.string().min(1),
  credits: z.strictObject({ ...required, problem_help: credit.exactOptional() }),
});

export type PriceTable = z.infer<typeof PriceTableSchema>;

export const PRICE_TABLE_2026_11_16_2: PriceTable = {
  version: "2026-11-16.2",
  credits: {
    explain: 1,
    double_check: 4,
    more_detail: 3,
    research_quick: 15,
    research_standard: 45,
    research_deep: 125,
    overview_script: 40,
    video_slides: 50,
    diagram: 18,
    mini_app: 40,
    practice: 8,
    retranscribe: 1,
    fallback_voice: 2,
  },
};
