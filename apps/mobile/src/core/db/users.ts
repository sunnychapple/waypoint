import { userIdKey } from "../device/registration.ts";

// One notes database per person on this iPhone (open question 52), named after their Clerk user id. Clerk ids are
// "user_" and letters and digits; anything else is refused, so a name can never reach outside the database folder.
export const LEGACY_DB_NAME = "waypoint.db";

export function userDbName(clerkUserId: string): string {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(clerkUserId)) throw new Error("not a Clerk user id");
  return `waypoint-${clerkUserId}.db`;
}

// The Clerk ids a database's settings record as having signed in with it (the userIdKey rows device.ts writes).
export function clerkIdsIn(settingKeys: readonly string[]): string[] {
  const prefix = userIdKey("");
  return settingKeys.filter((key) => key.startsWith(prefix) && key.length > prefix.length).map((key) => key.slice(prefix.length));
}

// Whether the one database the app kept before (waypoint.db) becomes this person's: when it records them, or records
// nobody. Someone else's stays where it is until one of the people it records signs in.
export function legacyIsTheirs(recorded: readonly string[], clerkUserId: string): boolean {
  return recorded.length === 0 || recorded.includes(clerkUserId);
}

// An iPhone updated from the single-database app has no Keychain user yet. Offline on its first launch it would have no
// one to open: when the old "signed in before" flag was set and the old database records exactly one Clerk id, that
// person is the one signed in last.
export function seedFromLegacy(input: { flagSet: boolean; recorded: readonly string[] }): string | null {
  const [only] = input.recorded;
  if (!input.flagSet || input.recorded.length !== 1 || only === undefined) return null;
  return /^[A-Za-z0-9_]{1,64}$/.test(only) ? only : null;
}

// PRAGMA wal_checkpoint(TRUNCATE) returns (busy, log, checkpointed) and does not throw when it could not finish: the
// old file may be renamed only when busy is 0, otherwise the write-ahead log would be left behind.
export function checkpointDone(row: { busy: number } | null | undefined): boolean {
  return row !== null && row !== undefined && row.busy === 0;
}

// What the sign-in gate does with the notes: open the signed-in person's, close them once Clerk says nobody is signed
// in, and leave them as they are while Clerk is still loading (offline, the person signed in last is opened on use).
export type NotesStep = { kind: "open"; user: string } | { kind: "close" } | { kind: "keep" };

export function notesStep(input: { clerkLoaded: boolean; clerkSignedIn: boolean | undefined; clerkUserId: string | null | undefined }): NotesStep {
  if (!input.clerkLoaded) return { kind: "keep" };
  if (input.clerkSignedIn === true && typeof input.clerkUserId === "string" && input.clerkUserId !== "") return { kind: "open", user: input.clerkUserId };
  if (input.clerkSignedIn === false) return { kind: "close" };
  return { kind: "keep" };
}

// Deleting the account (open question 7): the files on this iPhone that belong to the person deleted. Their notes
// database with its write-ahead log, and the sessions and overview audio their notes name. Nobody else's database, and
// never the old shared file, is named here. Ids that are not plain ids are dropped, so a name cannot reach outside.
const DATABASE_SUFFIXES = ["", "-wal", "-shm", "-journal"] as const;
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;
const OVERVIEW_FILE = /^overviews\/[A-Za-z0-9-]{1,64}\.m4a$/;

export type AccountFiles = { files: string[]; sessionIds: string[] };

export function accountFiles(input: { clerkUserId: string; sessionIds: readonly string[]; overviewFiles: readonly string[] }): AccountFiles {
  const name = userDbName(input.clerkUserId);
  return {
    files: [
      ...DATABASE_SUFFIXES.map((suffix) => `SQLite/${name}${suffix}`),
      ...input.overviewFiles.filter((file) => OVERVIEW_FILE.test(file)),
    ],
    sessionIds: input.sessionIds.filter((id) => SESSION_ID.test(id)),
  };
}

// What the deletion screen does when Clerk refuses: offline, a sign-in again (Clerk asks for a fresh verification
// before a sensitive change), or anything else.
export type DeleteFailure = "offline" | "reverify" | "failed";

// Reads a Clerk error without depending on its class: a runtime network error has code "network_error"; an API error
// carries codes such as "session_reverification_required" in its errors list.
export function deleteAccountFailure(error: unknown): DeleteFailure {
  if (typeof error !== "object" || error === null) return "failed";
  const { code, errors, message } = error as { code?: unknown; errors?: unknown; message?: unknown };
  if (code === "network_error") return "offline";
  const codes = Array.isArray(errors) ? errors.map((item) => (typeof item === "object" && item !== null ? (item as { code?: unknown }).code : undefined)) : [];
  if ([code, ...codes].some((value) => typeof value === "string" && /reverification/i.test(value))) return "reverify";
  if (typeof message === "string" && /network request failed|failed to fetch|offline|no internet/i.test(message)) return "offline";
  return "failed";
}

// The confirmation the person types before the red button works: DELETE, in capitals, spaces ignored.
export function isDeleteConfirmation(typed: string): boolean {
  return typed.trim() === "DELETE";
}
