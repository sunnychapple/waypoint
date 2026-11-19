import { z } from "zod";
import { INSTANT_TASKS, JOB_TYPES } from "./tasks.ts";

export const ZeroRetentionRequestSchema = z.strictObject({ enabled: z.boolean() });
export const ZeroRetentionResponseSchema = z.strictObject({ zero_retention: z.boolean() });

export const ACTIVITY_TASKS = [...INSTANT_TASKS, ...JOB_TYPES] as const;

// One cloud task as GET /v1/activity shows it. No text: the text sent is kept only on the device.
export const ActivityItemSchema = z.strictObject({
  id: z.string().min(1),
  task: z.enum(ACTIVITY_TASKS),
  bytes_sent: z.number().int().min(0),
  credits: z.number().int().min(0),
  route: z.string().min(1),
  retention: z.enum(["standard", "zero"]),
  at: z.number().int().min(0),
});

// next: pass it back as ?before= for the following page; null when there are no older items.
export const ActivityResponseSchema = z.strictObject({
  items: z.array(ActivityItemSchema),
  next: z.string().nullable(),
});

export type ZeroRetentionRequest = z.infer<typeof ZeroRetentionRequestSchema>;
export type ZeroRetentionResponse = z.infer<typeof ZeroRetentionResponseSchema>;
export type ActivityItem = z.infer<typeof ActivityItemSchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
