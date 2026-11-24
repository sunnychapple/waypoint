import { z } from "zod";

export const TIERS = ["light", "standard", "strong"] as const;
export type Tier = (typeof TIERS)[number];

export type RouteEntry = { model: string; retention: "standard" | "zero" };

const RouteEntrySchema = z.strictObject({
  model: z.string().min(1),
  retention: z.enum(["standard", "zero"]),
});

const TierSchema = z.enum(TIERS);

// explain is not here (the router picks its tier); retranscribe is never routed.
export const FIXED_TASKS = ["more_detail", "double_check", "read_link", "research", "overview_script", "video_slides", "diagram", "mini_app", "practice"] as const;

// Fixed tasks added after the live route table was published. A table may leave one out; decideRoute then uses the
// tier here. The next routes version should list them; then they move into FIXED_TASKS.
export const OPTIONAL_FIXED_TASKS = ["problem_help"] as const;
export type OptionalFixedTask = (typeof OPTIONAL_FIXED_TASKS)[number];
export const OPTIONAL_FIXED_TIERS: Readonly<Record<OptionalFixedTask, Tier>> = { problem_help: "standard" };

export const RouteTableSchema = z.strictObject({
  version: z.string().min(1),
  tiers: z.strictObject({
    light: z.array(RouteEntrySchema).min(1),
    standard: z.array(RouteEntrySchema).min(1),
    strong: z.array(RouteEntrySchema).min(1),
  }),
  fixed: z.partialRecord(z.enum([...FIXED_TASKS, ...OPTIONAL_FIXED_TASKS]), TierSchema).refine(
    (fixed) => FIXED_TASKS.every((task) => Object.hasOwn(fixed, task)),
    "fixed must list every fixed task",
  ),
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
