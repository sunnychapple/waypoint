import { randomUUID, CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { createSpace, SpaceNameError } from "../core/db/spaces.ts";
import { getGroup, type Role } from "../core/groups/groups.ts";
import { acceptNewAccountKey } from "../core/groups/keys.ts";
import { safetyCode } from "../core/share/spaces.ts";
import { getDb, writeDb } from "./db.ts";
import { currentUserId } from "./device.ts";
import {
  acceptInvite,
  createGroup,
  createInvite,
  ensureAllKeysNow,
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

const SHARED_FALLBACK_NAME = "Shared space";

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
  return createInvite(groupId, role, historyFrom, role === "owner" ? null : ends);
}

// Joins with a token (the token is used once and never kept), then maps a local space named from the group's name.
export async function join(token: string): Promise<string> {
  const groupId = await acceptInvite(token);
  const group = getGroup(getDb(), groupId);
  if (group !== null && getDb().get("SELECT 1 AS ok FROM space_groups WHERE group_id = ?", [groupId]) === null) {
    const base = group.name === "" ? SHARED_FALLBACK_NAME : group.name;
    // A name this iPhone already uses gets a number after it.
    for (let n = 1; ; n += 1) {
      const name = n === 1 ? base : `${base} ${n}`;
      try {
        const space = writeDb((db) => createSpace(db, { now: Date.now, newId: randomUUID }, name));
        mapSpace(space.id, groupId);
        break;
      } catch (error) {
        if (!(error instanceof SpaceNameError && error.message === "taken")) throw error;
      }
    }
  }
  return groupId;
}

// Leaves a shared group (the same call as removing oneself). The local copy stays; the mapping goes, so sync stops.
export async function leave(groupId: string): Promise<void> {
  const me = currentUserId();
  if (me === null) throw new Error("signed out");
  await removeGroupMember(groupId, me);
  writeDb((db) => db.run("DELETE FROM space_groups WHERE group_id = ?", [groupId]));
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
  return Promise.all(
    rows.map(async (r) => ({
      userId: r.user_id,
      changedAt: r.changed_at,
      code: safetyCode(await digestStringAsync(CryptoDigestAlgorithm.SHA256, r.pending_sign_pub)),
      trust: async () => {
        writeDb((db) => acceptNewAccountKey(db, r.user_id));
        await ensureAllKeysNow();
      },
    })),
  );
}
