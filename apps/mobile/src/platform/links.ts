import { getRandomBytes } from "expo-crypto";
import { ApiCallError } from "@waypoint/api-client";
import { LinkPasscodeSchema } from "@waypoint/contracts";
import { lockLink } from "../../modules/waypoint-keys/index.ts";
import { toBase64Url } from "../core/jobs/bytes.ts";
import { getSetting, setSetting } from "../core/db/settings.ts";
import { expiryFor, linkUrl, markRevoked, recordLink, sharedItem, type LinkExpiry } from "../core/share/links.ts";
import { failureCopy } from "../core/cloud/failure.ts";
import { api } from "./api.ts";
import { createGroup } from "./groups.ts";
import { dbGeneration, getDb, writeDbIf } from "./db.ts";
import { toFailure } from "./tasks.ts";

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
  const generation = dbGeneration();
  const id = await createGroup("personal", SHARED_LINKS_NAME);
  writeDbIf(generation, (db) => setSetting(db, SHARED_LINKS_KEY, id));
  return id;
}

// Makes a link to one session: a new random link id and key, the locked item, POST /v1/links (signed). The key is kept
// only in the URL and this phone's links table. Throws on failure (the screen uses toFailure).
export async function createLink(sessionId: string, options: { passcode: string | null; expiry: LinkExpiry }): Promise<{ url: string; cut: boolean }> {
  const generation = dbGeneration();
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
  writeDbIf(generation, (db) => recordLink(db, { id: linkId, sessionId, groupId, url, hasPasscode: options.passcode !== null, expiresAt, createdAt: now }));
  return { url, cut: made.cut };
}

// Turns a link off on the server (DELETE /v1/links/:id, signed), then marks it revoked here. Its maker can always turn
// it off, so a 404 means the server has no such link: there is nothing to turn off, and it is marked revoked too.
export async function revokeLink(linkId: string): Promise<void> {
  const generation = dbGeneration();
  try {
    await api.revokeLink(linkId);
  } catch (error) {
    if (!(error instanceof ApiCallError && error.status === 404)) throw error;
  }
  writeDbIf(generation, (db) => markRevoked(db, linkId, Date.now()));
}

// A 403: a viewer making a link, or someone other than its maker or an owner turning one off.
export function linkRefused(error: unknown): boolean {
  return error instanceof ApiCallError && error.status === 403;
}

// What the share screen says when making or turning off a link fails. A 403 here is the space's rule, not zero retention.
export function linkFailureText(error: unknown, action: "make" | "turn_off"): string {
  if (!linkRefused(error)) return failureCopy(toFailure(error)).title;
  return action === "make"
    ? "You can only read this shared space, so you can't make a link to it."
    : "Only the person who made this link, or an owner of the shared space, can turn it off.";
}
