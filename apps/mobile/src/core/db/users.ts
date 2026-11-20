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
