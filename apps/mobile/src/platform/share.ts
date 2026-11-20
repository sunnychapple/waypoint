import { randomUUID, CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { createSpace, freeSpaceName } from "../core/db/spaces.ts";
import { getGroup, upsertGroup, type Role } from "../core/groups/groups.ts";
import { acceptNewAccountKey } from "../core/groups/keys.ts";
import { SHARED_FALLBACK_NAME, safetyCode } from "../core/share/spaces.ts";
import { dbGeneration, getDb, stillSame, writeDb, writeDbIf } from "./db.ts";
import { currentUserId } from "./device.ts";
import {
  acceptInvite,
  createGroup,
  createInvite,
  ensureAllKeysNow,
  ensureKeys,
  refreshGroups,
  removeMember as removeGroupMember,
} from "./groups.ts";

// Shared spaces (M30a): a shared group, mapped to a local space (space_groups) so sync (M29) carries its rows.
export type HistoryChoice = "from_now" | "everything";

export type PendingKeyChange = {
  userId: string;
  changedAt: number;
  code: string;
  // "Trust the new key": accepts the member's new account key, then wraps the group keys for it.
  trust: () => Promise<void>;
};

// Maps a local space to a group and marks the space's row to send (as M29b's turnOnSync does for a personal space).
function mapSpace(spaceId: string, groupId: string): void {
  writeDb((db) => {
    db.transaction(() => {
      db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, ?)", [spaceId, groupId]);
      db.run("INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('spaces', ?, 0, NULL)", [spaceId]);
    });
  });
}

// A new shared space: the local space first (a taken name fails before anything goes to the server), then the group.
export async function newSharedSpace(name: string): Promise<string> {
  const trimmed = name.trim();
  const space = writeDb((db) => createSpace(db, { now: Date.now, newId: randomUUID }, trimmed));
  let groupId: string;
  try {
    groupId = await createGroup("shared", trimmed);
  } catch (error) {
    writeDb((db) => db.run("DELETE FROM spaces WHERE id = ?", [space.id]));
    throw error;
  }
  mapSpace(space.id, groupId);
  return groupId;
}

// The link for a new invite. "From now" gives history_from = now; "everything" gives 0. An owner invite never ends.
export async function invite(groupId: string, role: Role, history: HistoryChoice, ends: number | null): Promise<string> {
  const historyFrom = history === "from_now" ? Date.now() : 0;
  return createInvite(groupId, role, historyFrom, ends);
}

// Joins with a token (the token is used once and never kept). Once the server accepts it, the local space is mapped
// first; the keys and the refresh are best effort, so nothing after the server step can fail the join.
export async function join(token: string): Promise<string> {
  const user = currentUserId();
  if (user === null) throw new Error("signed out");
  const generation = dbGeneration();
  const view = await acceptInvite(token);
  if (!stillSame(generation)) throw new Error("signed out"); // the group is not mapped into someone else's notes
  const groupId = view.id;
  writeDb((db) => upsertGroup(db, view, null, Date.now(), user));
  if (getDb().get("SELECT 1 AS ok FROM space_groups WHERE group_id = ?", [groupId]) === null) {
    const group = getGroup(getDb(), groupId);
    const base = group === null || group.name === "" ? SHARED_FALLBACK_NAME : group.name;
    const space = writeDb((db) => createSpace(db, { now: Date.now, newId: randomUUID }, freeSpaceName(db, base, null)));
    mapSpace(space.id, groupId);
  }
  await ensureKeys(groupId, { now: false }).catch(() => undefined);
  await refreshGroups().catch(() => undefined);
  return groupId;
}

// Leaves a shared group (the same call as removing oneself). The local copy stays; the mapping goes, so sync stops.
export async function leave(groupId: string): Promise<void> {
  const me = currentUserId();
  if (me === null) throw new Error("signed out");
  const generation = dbGeneration();
  await removeGroupMember(groupId, me);
  writeDbIf(generation,(db) => db.run("DELETE FROM space_groups WHERE group_id = ?", [groupId]));
}

// An owner removes a member. The new key is made at once.
export async function removeMember(groupId: string, userId: string): Promise<void> {
  await removeGroupMember(groupId, userId);
}

// Members whose account key changed and that this iPhone has not trusted yet (TOFU, docs/security.md section 6).
export async function pendingKeyChanges(): Promise<PendingKeyChange[]> {
  const rows = getDb().all<{ user_id: string; pending_sign_pub: string; changed_at: number }>(
    "SELECT user_id, pending_sign_pub, changed_at FROM known_accounts WHERE pending_sign_pub IS NOT NULL ORDER BY changed_at",
  );
  const generation = dbGeneration();
  return Promise.all(
    rows.map(async (r) => ({
      userId: r.user_id,
      changedAt: r.changed_at,
      code: safetyCode(await digestStringAsync(CryptoDigestAlgorithm.SHA256, r.pending_sign_pub)),
      trust: async () => {
        writeDbIf(generation, (db) => acceptNewAccountKey(db, r.user_id));
        await ensureAllKeysNow();
      },
    })),
  );
}
