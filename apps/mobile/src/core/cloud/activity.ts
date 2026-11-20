import type { ActivityItem } from "@waypoint/contracts";
import { creditsLabel } from "../config/config.ts";
import { TASK_LABELS } from "../explain/sent.ts";
import { shortDate } from "../store/plans.ts";

// The server's activity id is the hold id, "<task>:<user id>:<Idempotency-Key>" (apps/api/src/tasks/instant.ts); the
// key is also this phone's sent_log id. null when the id has no key part.
export function sentKeyOf(activityId: string): string | null {
  const key = activityId.slice(activityId.lastIndexOf(":") + 1);
  return activityId.includes(":") && /^[A-Za-z0-9_-]{16,64}$/.test(key) ? key : null;
}

// "<1 KB", "3 KB", "1.2 MB" (1,000-based).
export function sizeLabel(bytes: number): string {
  if (bytes < 1000) return "<1 KB";
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export type ActivityLine = { title: string; detail: string; retention: "standard" | "zero" };

export function activityLine(item: ActivityItem, offsetMinutes: number): ActivityLine {
  const cost = item.credits === 0 ? "Not charged" : creditsLabel(item.credits);
  return {
    title: TASK_LABELS[item.task] ?? item.task,
    detail: `${shortDate(item.at, offsetMinutes)} · ${cost} · ${sizeLabel(item.bytes_sent)} sent`,
    retention: item.retention,
  };
}

// The switch's state as this phone last set it. The server has no read route for it (open question), and turns it off
// itself when Plus ends, so the screen shows it on only for Plus.
export const ZERO_RETENTION_KEY = "zero_retention";

export function zeroRetentionShown(stored: string | null, plan: "free" | "plus" | "own" | null): boolean {
  return plan === "plus" && stored === "1";
}

// A stored "1" from a Plus period must not outlive Plus: once the plan is known and is not Plus, the stored value is cleared.
export function needsZeroRetentionClear(stored: string | null, plan: "free" | "plus" | "own" | null): boolean {
  return plan !== null && plan !== "plus" && stored !== null;
}
