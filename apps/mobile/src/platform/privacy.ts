import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import type { ActivityItem } from "@waypoint/contracts";
import { ApiCallError, NetworkError } from "@waypoint/api-client";
import { ZERO_RETENTION_KEY } from "../core/cloud/activity.ts";
import { deleteSetting, getSetting, setSetting } from "../core/db/settings.ts";
import { api } from "./api.ts";
import { useQuery, writeDb } from "./db.ts";
import { requireApprovedDevice } from "./device.ts";

export type SwitchResult = "ok" | "plan_required" | "offline" | "failed";

// PUT /v1/settings/zero-retention (PR 32). Plus only; the server answers 403 plan_required otherwise. Signed by this
// iPhone (H12), so it needs an approved device; otherwise the screen that explains why opens.
export async function setZeroRetention(enabled: boolean): Promise<SwitchResult> {
  if (!requireApprovedDevice()) return "failed";
  try {
    const reply = await api.setZeroRetention(enabled);
    writeDb((db) => setSetting(db, ZERO_RETENTION_KEY, reply.zero_retention ? "1" : "0"));
    return "ok";
  } catch (error) {
    if (error instanceof ApiCallError && error.code === "plan_required") return "plan_required";
    return error instanceof NetworkError ? "offline" : "failed";
  }
}

export function useStoredZeroRetention(): string | null {
  return useQuery((db) => getSetting(db, ZERO_RETENTION_KEY));
}

export function clearStoredZeroRetention(): void {
  writeDb((db) => deleteSetting(db, ZERO_RETENTION_KEY));
}

export type ActivityState = { items: ActivityItem[]; more: boolean; error: "offline" | "failed" | null; loadMore: () => void };

// GET /v1/activity, newest first, 50 at a time; reloaded each time the screen comes into view.
export function useActivity(): ActivityState {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<"offline" | "failed" | null>(null);
  const load = useCallback((before: string | null) => {
    api.activity(before ?? undefined).then(
      (page) => {
        setItems((old) => (before === null ? page.items : [...old, ...page.items]));
        setNext(page.next);
        setError(null);
      },
      (e: unknown) => setError(e instanceof NetworkError ? "offline" : "failed"),
    );
  }, []);
  useFocusEffect(useCallback(() => load(null), [load]));
  return { items, more: next !== null, error, loadMore: () => (next === null ? undefined : load(next)) };
}
