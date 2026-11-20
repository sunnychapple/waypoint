import { randomUUID } from "expo-crypto";
import { openDatabaseSync } from "expo-sqlite";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { migrate } from "../core/db/migrate.ts";
import { ensureDefaultSpace } from "../core/db/spaces.ts";
import type { SqlDb, SqlValue } from "../core/db/sql.ts";

function openDeviceDb(name: string): SqlDb {
  const db = openDatabaseSync(name);
  db.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params: SqlValue[] = []) => {
      const r = db.runSync(sql, params);
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    all: <T,>(sql: string, params: SqlValue[] = []) => db.getAllSync<T>(sql, params),
    get: <T,>(sql: string, params: SqlValue[] = []) => db.getFirstSync<T>(sql, params),
    transaction: (task) => db.withTransactionSync(task),
  };
}

let device: SqlDb | null = null;

export function getDb(): SqlDb {
  if (!device) {
    const db = openDeviceDb("waypoint.db");
    migrate(db);
    ensureDefaultSpace(db, { now: Date.now, newId: randomUUID });
    device = db;
  }
  return device;
}

let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Re-runs `read` after every writeDb call, and when `key` changes. Pass as `key` every value `read` uses
// that can change while the screen is open (an id from the route, the time), joined into one string.
// The result is cached per version and key, as useSyncExternalStore requires.
export function useQuery<T>(read: (db: SqlDb) => T, key = ""): T {
  const cache = useRef<{ version: number; key: string; value: T } | null>(null);
  const getSnapshot = (): T => {
    if (cache.current === null || cache.current.version !== version || cache.current.key !== key) {
      cache.current = { version, key, value: read(getDb()) };
    }
    return cache.current.value;
  };
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function writeDb<T>(write: (db: SqlDb) => T): T {
  const result = write(getDb());
  version += 1;
  for (const listener of listeners) listener();
  return result;
}

const MINUTE_MS = 60_000;

// The time, rounded down to the minute, for reads that depend on it (cards due now). Re-checked every 15 s.
export function useMinuteNow(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS);
  useEffect(() => {
    const timer = setInterval(() => setMinute(Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS), 15_000);
    return () => clearInterval(timer);
  }, []);
  return minute;
}
