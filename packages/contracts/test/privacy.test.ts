import { describe, expect, test } from "vitest";
import { ActivityItemSchema, ActivityResponseSchema, ZeroRetentionRequestSchema } from "../src/privacy.ts";

const GOOD_ITEM = {
  id: "a1",
  task: "explain",
  bytes_sent: 12,
  credits: 1,
  route: "clef/fast",
  retention: "standard",
  at: 1_700_000_000_000,
};

describe("privacy schemas", () => {
  test("the zero-retention request rejects a string enabled and an extra key, and the activity schemas reject an extra text key, an unknown task, and accept next null", () => {
    expect(ZeroRetentionRequestSchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(ZeroRetentionRequestSchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false);
    expect(ActivityItemSchema.safeParse({ ...GOOD_ITEM, text: "note" }).success).toBe(false);
    expect(ActivityItemSchema.safeParse({ ...GOOD_ITEM, task: "unknown_task" }).success).toBe(false);
    expect(ActivityResponseSchema.safeParse({ items: [GOOD_ITEM], next: null }).success).toBe(true);
  });
});
