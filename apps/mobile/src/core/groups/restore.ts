import type { SqlDb } from "../db/sql.ts";
import { createSpace, freeSpaceName, listSpaces, SpaceNameError } from "../db/spaces.ts";
import { listGroups } from "./groups.ts";

// Compared the way spaces.ts compares names (its foldName is private).
const foldName = (text: string): string => text.normalize("NFC").toLocaleLowerCase();

// Gives each group this iPhone holds a key for, but has no space for (a new or recovered iPhone), a local space, so sync
// carries its notes. An empty space with the group's name that no group maps yet is used (the fresh default space);
// otherwise a new space takes the name. Only space_groups is written, never dirty: nothing here is sent back.
// A name the space table refuses (too long) skips that group. Returns the group ids it mapped.
export function restoreGroupSpaces(db: SqlDb, deps: { now: () => number; newId: () => string }, hasKey: (groupId: string) => boolean): string[] {
  const restored: string[] = [];
  db.transaction(() => {
    for (const group of listGroups(db)) {
      const name = group.name.trim();
      if (name === "" || !hasKey(group.id)) continue;
      if (db.get("SELECT 1 AS ok FROM space_groups WHERE group_id = ?", [group.id]) !== null) continue;
      const empty = listSpaces(db).find(
        (space) =>
          space.sessionCount === 0 &&
          foldName(space.name) === foldName(name) &&
          db.get("SELECT 1 AS ok FROM space_groups WHERE space_id = ?", [space.id]) === null,
      );
      try {
        const spaceId = empty?.id ?? createSpace(db, deps, freeSpaceName(db, name, null)).id;
        db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, ?)", [spaceId, group.id]);
        restored.push(group.id);
      } catch (error) {
        // createSpace checks the name before it writes, so a refused name leaves nothing behind.
        if (!(error instanceof SpaceNameError)) throw error;
      }
    }
  });
  return restored;
}
