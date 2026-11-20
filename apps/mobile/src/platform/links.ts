import { getRandomBytes } from "expo-crypto";
import { LinkPasscodeSchema } from "@waypoint/contracts";
import { lockLink } from "../../modules/waypoint-keys/index.ts";
import { toBase64Url } from "../core/jobs/bytes.ts";
import { getSetting, setSetting } from "../core/db/settings.ts";
import { expiryFor, linkUrl, markRevoked, recordLink, sharedItem, type LinkExpiry } from "../core/share/links.ts";
import { api } from "./api.ts";
import { createGroup } from "./groups.ts";
import { getDb, writeDb } from "./db.ts";

// The personal group for links from a session whose space does not sync. Made once; never mapped to a space.
const SHARED_LINKS_KEY = "shared_links_group";
const SHARED_LINKS_NAME = "Shared links";
const baseUrl: string = process.env.EXPO_PUBLIC_API_URL ?? "";

// The group a session's link is made for: its space's group when the space syncs (the space is not changed), else the
// "Shared links" group. Making a link never starts syncing a space.
async function groupForLink(sessionId: string): Promise<string> {
  const synced = getDb().get<{ group_id: string }>(
    "SELECT sg.group_id AS group_id FROM sessions s JOIN space_groups sg ON sg.space_id = s.space_id WHERE s.id = ?",
    [sessionId],
  );
  if (synced) return synced.group_id;
  const known = getSetting(getDb(), SHARED_LINKS_KEY);
  if (known !== null) return known;
  const id = await createGroup("personal", SHARED_LINKS_NAME);
  writeDb((db) => setSetting(db, SHARED_LINKS_KEY, id));
  return id;
}

// Makes a link to one session: a new random link id and key, the locked item, POST /v1/links (signed). The key is kept
// only in the URL and this phone's links table. Throws on failure (the screen uses toFailure).
export async function createLink(sessionId: string, options: { passcode: string | null; expiry: LinkExpiry }): Promise<{ url: string; cut: boolean }> {
  const made = sharedItem(getDb(), sessionId);
  if (made === null) throw new Error("no such session");
  if (options.passcode !== null && !LinkPasscodeSchema.safeParse(options.passcode).success) throw new RangeError("passcode");
  const groupId = await groupForLink(sessionId);
  const linkId = toBase64Url(getRandomBytes(16));
  const locked = await lockLink(linkId, JSON.stringify(made.item));
  const now = Date.now();
  const expiresAt = expiryFor(options.expiry, now);
  await api.createLink({ id: linkId, group_id: groupId, data: locked.data, passcode: options.passcode, expires_at: expiresAt });
  const url = linkUrl(baseUrl, linkId, locked.key);
  writeDb((db) => recordLink(db, { id: linkId, sessionId, groupId, url, hasPasscode: options.passcode !== null, expiresAt, createdAt: now }));
  return { url, cut: made.cut };
}

// Turns a link off on the server (DELETE /v1/links/:id, signed), then marks it revoked here.
export async function revokeLink(linkId: string): Promise<void> {
  await api.revokeLink(linkId);
  writeDb((db) => markRevoked(db, linkId, Date.now()));
}
