import { z } from "zod";

export const TIERS = ["light", "standard", "strong"] as const;
export type Tier = (typeof TIERS)[number];

export type RouteEntry = { model: string; retention: "standard" | "zero" };

const RouteEntrySchema = z.strictObject({
  model: z.string().min(1),
  retention: z.enum(["standard", "zero"]),
});

const TierSchema = z.enum(TIERS);

export const RouteTableSchema = z.strictObject({
  version: z.string().min(1),
  tiers: z.strictObject({
    light: z.array(RouteEntrySchema).min(1),
    standard: z.array(RouteEntrySchema).min(1),
    strong: z.array(RouteEntrySchema).min(1),
  }),
  fixed: z.record(z.string(), TierSchema),
});

export type RouteTable = z.infer<typeof RouteTableSchema>;

// Placeholder model ids until flow 8 picks the model per tier.
// No route is confirmed zero-retention yet, so every entry is "standard".
export const DEFAULT_ROUTES: RouteTable = {
  version: "2026-11-16.1",
  tiers: {
    light: [{ model: "workers-ai/glm-4.7-flash", retention: "standard" }],
    standard: [{ model: "workers-ai/deepseek-v4.1-flash", retention: "standard" }],
    strong: [{ model: "workers-ai/kimi-k2.6", retention: "standard" }],
  },
  fixed: {
    more_detail: "standard",
    double_check: "strong",
    read_link: "light",
    research: "standard",
    overview_script: "strong",
    video_slides: "strong",
    diagram: "strong",
    mini_app: "strong",
    practice: "standard",
  },
};
