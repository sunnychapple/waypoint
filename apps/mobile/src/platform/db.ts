import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { openDatabaseSync } from "expo-sqlite";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { migrate } from "../core/db/migrate.ts";
import { ensureDefaultSpace } from "../core/db/spaces.ts";
import type { SqlDb, SqlValue } from "../core/db/sql.ts";
import { LEGACY_DB_NAME, checkpointDone, clerkIdsIn, legacyIsTheirs, seedFromLegacy, userDbName } from "../core/db/users.ts";
import { userIdKey } from "../core/device/registration.ts";

function openDeviceDb(name: string): { db: SqlDb; close: () => void } {
  const db = openDatabaseSync(name);
  db.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    db: {
      exec: (sql) => db.execSync(sql),
      run: (sql, params: SqlValue[] = []) => {
        const r = db.runSync(sql, params);
        return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
      },
      all: <T,>(sql: string, params: SqlValue[] = []) => db.getAllSync<T>(sql, params),
      get: <T,>(sql: string, params: SqlValue[] = []) => db.getFirstSync<T>(sql, params),
      transaction: (task) => db.withTransactionSync(task),
    },
    close: () => db.closeSync(),
  };
}

// Whose notes are open (open question 52). The Keychain keeps the Clerk user id of the person signed in last, readable
// after the first unlock, so a silent push that wakes the app with no screen opens that same person's notes.
const DB_USER_KEY = "waypoint.db_user";
const SIGNED_IN_BEFORE = "waypoint.signed_in_before"; // kept by the single-database app
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

let open: { user: string; db: SqlDb; close: () => void } | null = null;
// The Keychain value once read: a Clerk user id, null for nobody, undefined before the first read.
let stored: string | null | undefined;
// The Keychain writes, one after the other: a delete at sign-out finishes before the next person's id is written.
let forgetting: Promise<void> = Promise.resolve();
let pendingKeychain = 0; // Keychain writes queued and not finished: while any, a new id is written behind them
const retryOnce = (op: () => Promise<void>): Promise<void> => op().catch(op).catch(() => undefined);

function queueKeychain(op: () => Promise<void>): Promise<void> {
  pendingKeychain += 1;
  const done = forgetting.then(() => retryOnce(op));
  forgetting = done;
  void done.then(() => {
    pendingKeychain -= 1;
  });
  return done;
}
const closeHooks = new Set<() => void>();

// Called once whenever open notes are closed (sign-out, or another person's notes opening): module state kept for the
// person whose notes they were (device.ts) is reset there.
export function onNotesClosed(hook: () => void): void {
  closeHooks.add(hook);
}

// Closes the open notes. A failing close must not leave them open: the next person could never sign in.
function closeOpen(): void {
  const prev = open;
  open = null;
  if (prev === null) return;
  try {
    prev.close();
  } catch {
    // Dropped anyway.
  }
  for (const hook of closeHooks) hook();
}
// Counts every open and close. Work that awaits between reading and writing notes compares it before writing, so it
// never writes into the notes of someone who signed in meanwhile.
let generation = 0;

export function dbGeneration(): number {
  // Opened first when it can be (the person signed in last): a read taken before the lazy open in getDb would be stale
  // the moment that open counted, and the work holding it would drop every write.
  if (open === null) {
    try {
      getDb();
    } catch {
      // nobody is signed in: the generation stays, and getDb throws where the work reads notes
    }
  }
  return generation;
}

// Whether these are still the notes that were open when `generation` was read (before an await).
export function stillSame(generation: number): boolean {
  return generation === dbGeneration();
}

// writeDb that does nothing when the notes changed since `generation` was read: async work that awaits and then
// writes uses this so a write never lands in someone else's notes. undefined when it did not write.
export function writeDbIf<T>(generation: number, write: (db: SqlDb) => T): T | undefined {
  return stillSame(generation) ? writeDb(write) : undefined;
}

// First launch after the update from the single database (see seedFromLegacy): the person it records, kept as the
// Keychain user, and the old flag is dropped so this happens once.
function seedFromLegacyDb(): string | null {
  try {
    if (SecureStore.getItem(SIGNED_IN_BEFORE) !== "1" || !new File(Paths.document, "SQLite", LEGACY_DB_NAME).exists) return null;
    const old = openDatabaseSync(LEGACY_DB_NAME);
    let user: string | null;
    try {
      const keys = old.getAllSync<{ key: string }>("SELECT key FROM settings WHERE key LIKE ?", [`${userIdKey("")}%`]).map((row) => row.key);
      user = seedFromLegacy({ flagSet: true, recorded: clerkIdsIn(keys) });
    } finally {
      old.closeSync();
    }
    if (user === null) return null;
    SecureStore.setItem(DB_USER_KEY, user, KEYCHAIN);
    void SecureStore.deleteItemAsync(SIGNED_IN_BEFORE).catch(() => undefined);
    return user;
  } catch {
    return null;
  }
}

// The person whose notes this iPhone opens: the one signed in, or signed in last. null when nobody is.
export function dbUser(): string | null {
  if (stored === undefined) {
    try {
      stored = SecureStore.getItem(DB_USER_KEY, KEYCHAIN) ?? seedFromLegacyDb();
    } catch {
      return null; // not readable yet (before the first unlock): asked again next time
    }
  }
  return stored;
}

// Before this change the app kept one database, waypoint.db, for everyone. A person who signs in takes it over when it
// is theirs or nobody's (legacyIsTheirs): it is renamed to their name, never copied, after its write-ahead log is folded
// in. Someone else's is left untouched. If it cannot be read or renamed, this person starts with a new file and it stays
// for its owner (nothing is logged: the app has no log). expo-sqlite keeps its files in Documents/SQLite on iOS.
function adoptLegacyDb(clerkUserId: string, name: string): void {
  const legacy = new File(Paths.document, "SQLite", LEGACY_DB_NAME);
  if (!legacy.exists || new File(Paths.document, "SQLite", name).exists) return;
  try {
    const old = openDatabaseSync(LEGACY_DB_NAME);
    try {
      const keys = old.getAllSync<{ key: string }>("SELECT key FROM settings WHERE key LIKE ?", [`${userIdKey("")}%`]).map((row) => row.key);
      if (!legacyIsTheirs(clerkIdsIn(keys), clerkUserId)) return;
      if (!checkpointDone(old.getFirstSync<{ busy: number }>("PRAGMA wal_checkpoint(TRUNCATE)"))) return; // not folded in: a new file
    } finally {
      old.closeSync();
    }
    legacy.rename(name);
    for (const suffix of ["-wal", "-shm"]) {
      const leftover = new File(Paths.document, "SQLite", `${LEGACY_DB_NAME}${suffix}`);
      if (leftover.exists) leftover.delete();
    }
  } catch {
    // A new file for this person; the old one stays as it is.
  }
}

// Opens one person's notes, closing anyone else's. Called by the sign-in gate on every render once Clerk says who is
// signed in, before any screen reads notes, so it does nothing when that person's notes are already open.
export function openUserDb(clerkUserId: string): SqlDb {
  if (open !== null && open.user === clerkUserId) return open.db;
  closeOpen();
  const name = userDbName(clerkUserId);
  adoptLegacyDb(clerkUserId, name);
  const { db, close } = openDeviceDb(name);
  try {
    migrate(db);
    ensureDefaultSpace(db, { now: Date.now, newId: randomUUID });
  } catch (error) {
    try {
      close();
    } catch {
      // Nothing more to do.
    }
    throw error;
  }
  open = { user: clerkUserId, db, close };
  generation += 1;
  if (stored !== clerkUserId) {
    stored = clerkUserId;
    try {
      if (pendingKeychain > 0) void queueKeychain(() => SecureStore.setItemAsync(DB_USER_KEY, clerkUserId, KEYCHAIN));
      else SecureStore.setItem(DB_USER_KEY, clerkUserId, KEYCHAIN);
    } catch {
      // Not kept: a silent push does nothing until the next sign-in keeps it.
    }
  }
  version += 1; // every query reads the newly opened notes
  notifyLater();
  return db;
}

// Signed out (or Clerk found the session gone): this person's notes are closed and nothing is deleted. They open again
// when this person signs in; anyone else who signs in gets their own. Resolves once the Keychain no longer names them.
export async function closeUserDb(): Promise<void> {
  closeOpen();
  generation += 1;
  version += 1;
  notifyLater();
  if (stored !== null) {
    stored = null;
    void queueKeychain(() => SecureStore.deleteItemAsync(DB_USER_KEY, KEYCHAIN));
  }
  await forgetting;
}

// The open person's notes, opened first for the person signed in last (a silent push with no screen). Throws when
// nobody is signed in on this iPhone.
export function getDb(): SqlDb {
  if (open !== null) return open.db;
  const user = dbUser();
  if (user === null) throw new Error("nobody is signed in");
  return openUserDb(user);
}

let version = 0;
const listeners = new Set<() => void>();

// Tells the mounted screens to read again. Opening can happen while the sign-in gate renders, and React does not allow
// other components to be updated during a render, so the screens are told right after it.
function notifyLater(): void {
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
}

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
    // Signed out: a screen on its way out keeps what it showed, and nothing is opened.
    if (open === null && dbUser() === null && cache.current !== null) return cache.current.value;
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
