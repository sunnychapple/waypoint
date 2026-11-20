import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import type { ConfigResponse } from "@waypoint/contracts";
import { isStale, needsUpdate, parseCachedConfig } from "../core/config/config.ts";
import { getSetting, setSetting } from "../core/db/settings.ts";
import { api } from "./api.ts";
import { getDb, writeDb } from "./db.ts";

const CACHE_KEY = "config_cache";
const FETCHED_KEY = "config_fetched_at";

let loaded = false;
let current: ConfigResponse | null = null;
let fetchedAt: number | null = null;
let refreshing = false;
let updateShown = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded) return;
  loaded = true;
  const db = getDb();
  current = parseCachedConfig(getSetting(db, CACHE_KEY));
  const at = getSetting(db, FETCHED_KEY);
  fetchedAt = current === null || at === null ? null : Number(at);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConfig(): ConfigResponse | null {
  load();
  return current;
}

// The native version is expo.version in app.json, built into the binary (docs/architecture.md section 2).
export function nativeVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}

export function isUpdateRequired(): boolean {
  const config = getConfig();
  return config !== null && needsUpdate(nativeVersion(), config.min_native.ios);
}

// Fetches GET /v1/config when the cached copy is older than CONFIG_MAX_AGE_MS. Offline keeps the cached copy.
export async function refreshConfig(): Promise<void> {
  load();
  if (refreshing || !isStale(fetchedAt, Date.now())) return;
  refreshing = true;
  try {
    const config = await api.config();
    const now = Date.now();
    writeDb((db) => {
      setSetting(db, CACHE_KEY, JSON.stringify(config));
      setSetting(db, FETCHED_KEY, String(now));
    });
    current = config;
    fetchedAt = now;
    for (const listener of listeners) listener();
  } catch {
    // Keep the cached config; the next launch or return to the app tries again.
  } finally {
    refreshing = false;
  }
}

export function useConfig(): ConfigResponse | null {
  return useSyncExternalStore(subscribe, getConfig);
}

export function useUpdateRequired(): boolean {
  return useSyncExternalStore(subscribe, isUpdateRequired);
}

// Called once in (tabs)/_layout.tsx: refreshes on launch and whenever the app comes back to the front, and opens
// "Update Waypoint" once per launch when this build is too old.
export function useConfigRefresh(): void {
  const updateRequired = useUpdateRequired();
  useEffect(() => {
    void refreshConfig();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshConfig();
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (updateRequired && !updateShown) {
      updateShown = true;
      router.push("/update");
    }
  }, [updateRequired]);
}
