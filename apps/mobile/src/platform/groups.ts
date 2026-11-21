import { useEffect } from "react";
import { AppState } from "react-native";
import { ApiCallError } from "@waypoint/api-client";
import type { GroupView } from "@waypoint/contracts";
import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytes, randomUUID } from "expo-crypto";
import {
  dropGroupKey,
  getAccountKey,
  getDeviceKeys,
  heldGroupKeyVersions,
  lockContent,
  makeGroupKey,
  openGroupKeys,
  unlockContent,
  verifyCertificate,
  wrapGroupKeys,
  type GroupSigner,
  type KeyTarget,
  type WrappedFor,
} from "../../modules/waypoint-keys/index.ts";
import type { SqlDb } from "../core/db/sql.ts";
import { freeSpaceName, renameSpace } from "../core/db/spaces.ts";
import { toBase64Url } from "../core/jobs/bytes.ts";
import {
  firstSetDelayMs,
  knownAccounts,
  noteAccounts,
  planKeys,
  versionsFor,
  type Target,
} from "../core/groups/keys.ts";
import {
  getGroup,
  heldVersions,
  listGroups,
  markLeft,
  noteKeyVersion,
  rememberSigner,
  trustedSigners,
  upsertGroup,
  type Role,
  type StoredGroup,
} from "../core/groups/groups.ts";
import { isFallbackSpaceName } from "../core/share/spaces.ts";
import { inviteLink } from "../core/share/invite-link.ts";
import { api, apiBaseUrl } from "./api.ts";
import { currentUserId, useDeviceStatus } from "./device.ts";
import { dbGeneration, getDb, stillSame, writeDb, writeDbIf } from "./db.ts";

// The contract's cap on envelopes in one request (GroupKeysRequest, GroupEnvelope list of approve).
const BATCH = 500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const toKeyTarget = (t: Target): KeyTarget => ({ id: t.id, userId: t.user_id, kind: t.kind, signPub: t.sign_pub, boxPub: t.box_pub, cert: t.cert });

// The group's name is locked with its key. A name this iPhone cannot open yet (no key) comes back as null.
async function nameOf(user: string, view: GroupView): Promise<string | null> {
  try {
    return await unlockContent(user, view.id, "group-name", [view.id], view.name_locked);
  } catch {
    return null;
  }
}

// A joined group's local space still has the placeholder name: it takes the group's name once that name is readable.
function nameJoinedSpaces(db: SqlDb, views: GroupView[], names: (string | null)[]): void {
  views.forEach((v, i) => {
    const name = names[i] ?? "";
    if (name === "") return;
    const space = db.get<{ id: string; name: string }>(
      "SELECT s.id, s.name FROM spaces s JOIN space_groups g ON g.space_id = s.id WHERE g.group_id = ?",
      [v.id],
    );
    if (space === null || !isFallbackSpaceName(space.name)) return;
    try {
      renameSpace(db, space.id, freeSpaceName(db, name, space.id));
    } catch {
      // Too long for a space name: the placeholder stays.
    }
  });
}

// GET /v1/groups into the local rows. A group the list no longer has is marked left (its local copy stays).
export async function refreshGroups(): Promise<void> {
  const user = currentUserId();
  if (user === null) return;
  const generation = dbGeneration();
  const views = await api.groups();
  const names = await Promise.all(views.map((v) => nameOf(user, v)));
  if (!stillSame(generation)) return;
  const now = Date.now();
  writeDb((db) => {
    views.forEach((v, i) => upsertGroup(db, v, names[i] ?? null, now, user));
    nameJoinedSpaces(db, views, names);
    const listed = new Set(views.map((v) => v.id));
    for (const g of listGroups(db)) if (!listed.has(g.id)) markLeft(db, g.id, now);
  });
}

// Signers this iPhone may open envelopes from: the certificate verifies under the signer's person's known account key.
function verifiedSigner(s: GroupSigner, known: Record<string, string>): boolean {
  const account = known[s.userId];
  return account !== undefined && verifyCertificate({ accountSignPub: account, cert: s.cert, userId: s.userId, deviceId: s.id, signPub: s.signPub, boxPub: s.boxPub });
}

// Reads the group's devices and the envelopes for `recipientId` (this device, or the account row when recovering), and
// opens the versions this iPhone does not hold yet. Trust: known accounts, then device certificates (never a bare key).
async function readGroup(user: string, groupId: string, recipientId: string): Promise<{ devices: Target[]; keyVersion: number; known: Record<string, string> }> {
  const account = getAccountKey(user);
  if (account === null) throw new Error("no account key");
  const now = Date.now();
  const generation = dbGeneration();
  const listing = await api.groupDevices(groupId);
  const mine = await api.groupKeys(groupId, recipientId);
  if (!stillSame(generation)) throw new Error("the notes changed");
  writeDb((db) => noteAccounts(db, listing.devices, { userId: user, accountSignPub: account.signPub }, now));
  const known = knownAccounts(getDb());
  const listed = new Set(mine.signers.map((s) => s.id));
  const candidates = new Map<string, GroupSigner>();
  for (const t of listing.devices) {
    if (t.kind === "device" && t.cert !== null) candidates.set(t.id, { id: t.id, userId: t.user_id, signPub: t.sign_pub, boxPub: t.box_pub, cert: t.cert });
  }
  for (const s of trustedSigners(getDb())) if (!candidates.has(s.id)) candidates.set(s.id, s);
  const signers = [...candidates.values()].filter((s) => listed.has(s.id) && verifiedSigner(s, known));
  const held = heldGroupKeyVersions(user, groupId);
  const missing = mine.envelopes
    .filter((e) => !held.includes(e.key_version))
    .map((e) => ({ keyVersion: e.key_version, wrappedKey: e.wrapped_key }));
  if (missing.length > 0) await openGroupKeys(user, groupId, recipientId, missing, signers, known);
  if (!stillSame(generation)) throw new Error("the notes changed");
  writeDb((db) => {
    for (const v of heldGroupKeyVersions(user, groupId)) noteKeyVersion(db, groupId, v, now);
    for (const s of signers) if (listed.has(s.id)) rememberSigner(db, s);
  });
  return { devices: listing.devices, keyVersion: listing.key_version, known };
}

// Posts envelopes in batches. Returns false when the server refused the set (409: someone else filled the slot).
async function postEnvelopes(groupId: string, keyVersion: number, wrapped: WrappedFor[]): Promise<boolean> {
  for (let i = 0; i < wrapped.length; i += BATCH) {
    const envelopes = wrapped.slice(i, i + BATCH).map((w) => ({ device_id: w.deviceId, wrapped_key: w.wrappedKey }));
    try {
      await api.postGroupKeys(groupId, { key_version: keyVersion, envelopes });
    } catch (error) {
      if (error instanceof ApiCallError && error.status === 409) return false;
      throw error;
    }
  }
  return true;
}

// The first set of a version: make the key and wrap it for every target. A refused row (no valid certificate) stops it.
async function makeFirstSet(user: string, groupId: string, keyVersion: number, targets: Target[], known: Record<string, string>): Promise<void> {
  const generation = dbGeneration();
  await makeGroupKey(user, groupId, keyVersion);
  const wrapped = await wrapGroupKeys(user, groupId, [keyVersion], targets.map(toKeyTarget), known);
  if (wrapped.refused.length > 0) {
    await dropGroupKey(user, groupId, keyVersion);
    return;
  }
  let stored: boolean;
  try {
    stored = await postEnvelopes(groupId, keyVersion, wrapped.envelopes);
  } catch (error) {
    await dropGroupKey(user, groupId, keyVersion);
    throw error;
  }
  if (!stored) {
    await dropGroupKey(user, groupId, keyVersion);
    return runEnsureKeys(groupId, { now: true }); // the winner's key is on the server now: open it
  }
  writeDbIf(generation, (db) => noteKeyVersion(db, groupId, keyVersion, Date.now()));
}

// The history start a member's row gives; a member this iPhone does not list gets only the current version.
function historyFromOf(group: StoredGroup, userId: string): number {
  return group.members.find((m) => m.user_id === userId)?.history_from ?? Number.MAX_SAFE_INTEGER;
}

// Wraps the held key(s) for the targets that lack them: our own rows get every held version, others the versions
// their history start allows (docs/security.md section 10).
async function addEnvelopes(user: string, group: StoredGroup, keyVersion: number, recipients: Target[], known: Record<string, string>): Promise<void> {
  const held = heldVersions(getDb(), group.id);
  const heldNow = heldGroupKeyVersions(user, group.id);
  const byVersion = new Map<number, Target[]>();
  for (const r of recipients) {
    const versions = r.user_id === user ? heldNow : versionsFor(held, historyFromOf(group, r.user_id), keyVersion);
    for (const v of versions) byVersion.set(v, [...(byVersion.get(v) ?? []), r]);
  }
  for (const v of [...byVersion.keys()].sort((a, b) => a - b)) {
    const wrapped = await wrapGroupKeys(user, group.id, [v], (byVersion.get(v) ?? []).map(toKeyTarget), known);
    if (wrapped.envelopes.length > 0) await postEnvelopes(group.id, v, wrapped.envelopes);
  }
}

// Brings one group's keys up to date for this iPhone (docs/security.md section 10). `now`: skip the random 0-30 s wait
// that lets two devices rarely race to make a missing key.
// One run per group at a time: two at once (a keys_needed nudge during a sync) could both make the first set, and the
// loser would drop the local key the winner just stored.
const keyRuns = new Map<string, Promise<void>>();

export function ensureKeys(groupId: string, options: { now: boolean }): Promise<void> {
  const run = (keyRuns.get(groupId) ?? Promise.resolve()).catch(() => undefined).then(() => runEnsureKeys(groupId, options));
  const tail = run.catch(() => undefined);
  keyRuns.set(groupId, tail);
  void tail.then(() => {
    if (keyRuns.get(groupId) === tail) keyRuns.delete(groupId);
  });
  return run;
}

async function runEnsureKeys(groupId: string, options: { now: boolean }): Promise<void> {
  const user = currentUserId();
  const keys = user === null ? null : getDeviceKeys(user);
  const group = getGroup(getDb(), groupId);
  if (user === null || keys === null || group === null || group.leftAt !== null) return;
  const { devices, keyVersion, known } = await readGroup(user, groupId, keys.deviceId);
  const plan = planKeys({
    targets: devices,
    me: { userId: user, role: group.role },
    keyVersion,
    holdsCurrent: heldGroupKeyVersions(user, groupId).includes(keyVersion),
    known,
    verify: verifyCertificate,
  });
  if (plan.kind === "first") {
    if (!options.now) {
      await delay(firstSetDelayMs(Math.random));
      return runEnsureKeys(groupId, { now: true });
    }
    return makeFirstSet(user, groupId, keyVersion, devices, known);
  }
  if (plan.kind === "add") return addEnvelopes(user, group, keyVersion, plan.recipients, known);
}

// Creates a group: a version 1 key, the locked name, the server row, then the envelopes for every target.
export async function createGroup(kind: StoredGroup["kind"], name: string): Promise<string> {
  const user = currentUserId();
  if (user === null) throw new Error("signed out");
  const id = randomUUID();
  await makeGroupKey(user, id, 1);
  try {
    const nameLocked = await lockContent(user, id, 1, "group-name", [id], name);
    await api.createGroup({ id, kind, name_locked: nameLocked });
  } catch (error) {
    await dropGroupKey(user, id, 1);
    throw error;
  }
  await refreshGroups();
  await ensureKeys(id, { now: true });
  return id;
}

// A new invite: a random token shown once, as the https link <API host>/i/<token> (it opens the app). The server gets only its SHA-256 (hex).
export async function createInvite(groupId: string, role: Role, historyFrom: number, endsAt: number | null): Promise<string> {
  const token = toBase64Url(getRandomBytes(32));
  const tokenHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, token);
  await api.createInvite(groupId, { token_hash: tokenHash, role, history_from: historyFrom, ends_at: endsAt });
  return inviteLink(apiBaseUrl, token);
}

// Joins with an invite token. Only the server step is here: the caller maps the group locally at once.
export async function acceptInvite(token: string): Promise<GroupView> {
  return api.acceptInvite(token);
}

// Removes a member (or, with this person's own id, leaves). Once the server has removed them, the rest is best effort.
export async function removeMember(groupId: string, userId: string): Promise<void> {
  const me = currentUserId();
  await api.removeMember(groupId, userId);
  await refreshGroups().catch(() => undefined);
  if (userId !== me) await ensureKeys(groupId, { now: true }).catch(() => undefined);
}

// Approving a new device: the envelopes for every held version of every group, for that device (at most 500).
export async function envelopesForDevice(user: string, device: KeyTarget): Promise<{ group_id: string; key_version: number; wrapped_key: string }[]> {
  const account = getAccountKey(user);
  if (account === null) return [];
  const now = Date.now();
  writeDb((db) => noteAccounts(db, [], { userId: user, accountSignPub: account.signPub }, now));
  const known = knownAccounts(getDb());
  const out: { group_id: string; key_version: number; wrapped_key: string }[] = [];
  for (const g of listGroups(getDb())) {
    const versions = heldGroupKeyVersions(user, g.id);
    if (versions.length === 0) continue;
    const wrapped = await wrapGroupKeys(user, g.id, versions, [device], known);
    for (const w of wrapped.envelopes) out.push({ group_id: g.id, key_version: w.keyVersion, wrapped_key: w.wrappedKey });
    if (out.length >= BATCH) break;
  }
  return out.slice(0, BATCH);
}

// Right after a device removal: brings every group's keys up to date now (no random wait). Best effort per group.
export async function ensureAllKeysNow(): Promise<void> {
  for (const g of listGroups(getDb())) await ensureKeys(g.id, { now: true }).catch(() => undefined);
}

// After this iPhone replaced the account key (a device removal): wrap every held version for the new account row.
export async function rewrapForNewAccount(user: string, account: { id: string; signPub: string; boxPub: string; selfCert: string }): Promise<void> {
  const now = Date.now();
  writeDb((db) => noteAccounts(db, [], { userId: user, accountSignPub: account.signPub }, now));
  const known = knownAccounts(getDb());
  const target: KeyTarget = { id: account.id, userId: user, kind: "account", signPub: account.signPub, boxPub: account.boxPub, cert: account.selfCert };
  for (const g of listGroups(getDb())) {
    const versions = heldGroupKeyVersions(user, g.id);
    if (versions.length === 0) continue;
    const wrapped = await wrapGroupKeys(user, g.id, versions, [target], known);
    for (const v of versions) await postEnvelopes(g.id, v, wrapped.envelopes.filter((w) => w.keyVersion === v));
  }
}

// After a recovery with the words: open the group keys the account row holds, then wrap them for this iPhone.
// A group whose keys fail is skipped here; syncGroups reads the account row's envelopes again for it.
export async function recoverGroupKeys(user: string, accountId: string): Promise<void> {
  await refreshGroups();
  for (const g of listGroups(getDb())) {
    try {
      await readGroup(user, g.id, accountId);
      await ensureKeys(g.id, { now: false });
    } catch {
      // This group stays without its keys; the others still go on.
    }
  }
  await notifyGroupsReady();
}

// The owner's part of a keys_needed message (a member accepted an invite; platform/sync.ts): the same step syncGroups runs
// for this group. Only an owner wraps keys for another member's devices, so anyone else does nothing. Skipped when the
// notes changed since it started; ensureKeys' own reads and writes check the notes as well.
export async function wrapKeysNow(groupId: string): Promise<void> {
  const user = currentUserId();
  const generation = dbGeneration();
  const group = user === null ? null : getGroup(getDb(), groupId);
  if (user === null || group === null || group.leftAt !== null || group.role !== "owner") return;
  if (!stillSame(generation)) return;
  await ensureKeys(groupId, { now: false });
}

let syncing = false;

// A group being created or joined here: its space is mapped by that flow, so the restore (sync.ts) must not map a second
// space for it while it runs.
let making = 0;

export async function whileMakingGroup<T>(fn: () => Promise<T>): Promise<T> {
  making += 1;
  try {
    return await fn();
  } finally {
    making -= 1;
  }
}

export function makingGroup(): boolean {
  return making > 0;
}

// Run once the groups' keys and names have been brought up to date (sync.ts restores the groups' spaces).
let groupsReady: (() => void | Promise<void>) | null = null;

export function onGroupsReady(listener: () => void | Promise<void>): void {
  groupsReady = listener;
}

async function notifyGroupsReady(): Promise<void> {
  try {
    await groupsReady?.();
  } catch {
    // The listener's own failure must not break the group sync.
  }
}

// Refreshes the groups and brings their keys up to date. One run at a time; a failed run is retried on the next one,
// and a failed group does not stop the others.
async function syncGroups(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    await refreshGroups();
    const user = currentUserId();
    const account = user === null ? null : getAccountKey(user);
    for (const g of listGroups(getDb())) {
      try {
        // A group with no key on this iPhone, which holds the account key: its keys may be waiting in the account row's
        // envelopes (a recovery whose first read failed). Read those first; ensureKeys then wraps them for this iPhone.
        if (user !== null && account !== null && g.leftAt === null && heldGroupKeyVersions(user, g.id).length === 0) {
          // A failed read must not stop ensureKeys, which may need to make a first set for a later version.
          await readGroup(user, g.id, account.accountId).catch(() => undefined);
        }
        await ensureKeys(g.id, { now: false });
      } catch {
        // This group is tried again next time.
      }
    }
    // A key that arrived before its group's name is readable: the names are read again, once.
    if (user !== null && listGroups(getDb()).some((g) => g.name === "" && heldGroupKeyVersions(user, g.id).length > 0)) {
      await refreshGroups().catch(() => undefined);
    }
    await notifyGroupsReady();
  } catch {
    // Offline or a failed call: the next launch, or the next time the app comes to the front, tries again.
  } finally {
    syncing = false;
  }
}

// Once approved: at launch and each time the app comes to the front (tabs layout).
export function useGroupKeys(): void {
  const status = useDeviceStatus();
  useEffect(() => {
    if (status !== "approved") return;
    void syncGroups();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncGroups();
    });
    return () => subscription.remove();
  }, [status]);
}
