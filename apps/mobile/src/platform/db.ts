import { openDatabaseSync } from "expo-sqlite";
import { useRef, useSyncExternalStore } from "react";
import { migrate } from "../core/db/migrate.ts";
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

// Re-runs `read` after every writeDb call. The result is cached per version, as useSyncExternalStore requires.
export function useQuery<T>(read: (db: SqlDb) => T): T {
  const cache = useRef<{ version: number; value: T } | null>(null);
  const getSnapshot = (): T => {
    if (cache.current === null || cache.current.version !== version) {
      cache.current = { version, value: read(getDb()) };
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
