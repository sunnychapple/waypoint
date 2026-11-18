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

const credit = z.number().int().min(1);

export const PriceTableSchema = z.strictObject({
  version: z.string().min(1),
  credits: z.strictObject({
    explain: credit,
    double_check: credit,
    more_detail: credit,
    research_quick: credit,
    research_standard: credit,
    research_deep: credit,
    overview_script: credit,
    video_slides: credit,
    diagram: credit,
    mini_app: credit,
    practice: credit,
    retranscribe: credit,
    fallback_voice: credit,
  }),
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
