export const INSTANT_TASKS = ["explain", "more_detail", "double_check", "read_link"] as const;

export const JOB_TYPES = [
  "research",
  "overview_script",
  "video_slides",
  "diagram",
  "mini_app",
  "practice",
  "retranscribe",
  "problem_help",
] as const;

export const RESEARCH_DEPTHS = ["quick", "standard", "deep"] as const;

export type InstantTask = (typeof INSTANT_TASKS)[number];
export type JobType = (typeof JOB_TYPES)[number];
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];
