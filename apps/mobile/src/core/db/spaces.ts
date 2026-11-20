import type { SqlDb } from "./sql.ts";
import { getSetting, setSetting } from "./settings.ts";

export type Space = { id: string; name: string; isDefault: boolean; lastUsedAt: number; sessionCount: number };

export const DEFAULT_SPACE_NAME = "My notes";
const SAVING_TO_KEY = "saving_to";
const NAME_MAX = 60;

// message is "empty", "too_long" or "taken"
export class SpaceNameError extends Error {}

type Deps = { now: () => number; newId: () => string };

type SpaceRow = { id: string; name: string; is_default: number; last_used_at: number; session_count: number };

const SPACE_SELECT = `
  SELECT s.id, s.name, s.is_default, s.last_used_at,
         (SELECT count(*) FROM sessions WHERE space_id = s.id) AS session_count
  FROM spaces s`;

function toSpace(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default === 1,
    lastUsedAt: row.last_used_at,
    sessionCount: row.session_count,
  };
}

export function listSpaces(db: SqlDb): Space[] {
  return db.all<SpaceRow>(`${SPACE_SELECT} ORDER BY s.last_used_at DESC, s.name ASC`).map(toSpace);
}

export function getSpace(db: SqlDb, id: string): Space | null {
  const row = db.get<SpaceRow>(`${SPACE_SELECT} WHERE s.id = ?`, [id]);
  return row ? toSpace(row) : null;
}

export function ensureDefaultSpace(db: SqlDb, deps: Deps): Space {
  const existing = db.get<SpaceRow>(`${SPACE_SELECT} WHERE s.is_default = 1`);
  if (existing) return toSpace(existing);
  const id = deps.newId();
  const now = deps.now();
  db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES (?, ?, 1, ?, ?)", [
    id,
    DEFAULT_SPACE_NAME,
    now,
    now,
  ]);
  return getSpace(db, id) as Space;
}

// Compared in JavaScript: SQLite's NOCASE folds only A to Z, so "Écologie" and "écologie" would both be allowed.
const foldName = (text: string): string => text.normalize("NFC").toLocaleLowerCase();

// The trimmed name, or the error it gives: empty, too long, or the name of another space (not `except`).
function checkName(db: SqlDb, name: string, except: string | null): string {
  const trimmed = name.trim();
  const length = [...trimmed].length;
  if (length === 0) throw new SpaceNameError("empty");
  if (length > NAME_MAX) throw new SpaceNameError("too_long");
  if (listSpaces(db).some((space) => space.id !== except && foldName(space.name) === foldName(trimmed))) throw new SpaceNameError("taken");
  return trimmed;
}

// The first free name from `base`: `base`, then `base 2`, `base 3`… (`except` is the space being renamed, if any).
export function freeSpaceName(db: SqlDb, base: string, except: string | null): string {
  const taken = new Set(listSpaces(db).filter((space) => space.id !== except).map((space) => foldName(space.name)));
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!taken.has(foldName(name))) return name;
  }
}

// Renames a space. Throws SpaceNameError when the name is empty, too long, or another space's.
export function renameSpace(db: SqlDb, id: string, name: string): void {
  const trimmed = checkName(db, name, id);
  db.run("UPDATE spaces SET name = ? WHERE id = ?", [trimmed, id]);
}

export function createSpace(db: SqlDb, deps: Deps, name: string): Space {
  const trimmed = checkName(db, name, null);
  const id = deps.newId();
  const now = deps.now();
  db.run("INSERT INTO spaces (id, name, is_default, created_at, last_used_at) VALUES (?, ?, 0, ?, ?)", [
    id,
    trimmed,
    now,
    now,
  ]);
  return getSpace(db, id) as Space;
}

// The space the next capture is saved to. A missing or deleted choice falls back to the default space.
export function getSavingTo(db: SqlDb): Space {
  const chosen = getSetting(db, SAVING_TO_KEY);
  const space = chosen === null ? null : getSpace(db, chosen);
  if (space) return space;
  const fallback = listSpaces(db).find((s) => s.isDefault);
  if (!fallback) throw new Error("no default space; call ensureDefaultSpace first");
  return fallback;
}

export function setSavingTo(db: SqlDb, id: string, now: number): void {
  db.transaction(() => {
    if (!getSpace(db, id)) throw new Error(`no such space: ${id}`);
    setSetting(db, SAVING_TO_KEY, id);
    db.run("UPDATE spaces SET last_used_at = ? WHERE id = ?", [now, id]);
  });
}
