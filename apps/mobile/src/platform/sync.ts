import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { ApiCallError, type ChangesPage } from "@waypoint/api-client";
import { SYNC_EXTRA_CREDITS, SyncServerMessageSchema } from "@waypoint/contracts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { deleteSetting, getSetting, setSetting } from "../core/db/settings.ts";
import { getSpace } from "../core/db/spaces.ts";
import type { SqlDb } from "../core/db/sql.ts";
import { getGroup, type StoredGroup } from "../core/groups/groups.ts";
import { actionForPush } from "../core/push/push.ts";
import {
  SEGMENT_BUCKET_MS,
  SyncChangeSchema,
  applyPulled,
  changeKind,
  collectChanges,
  lastSeq,
  nextOutgoing,
  sent,
  setLastSeq,
  type Outgoing,
  type SyncChange,
} from "../core/sync/changes.ts";
import {
  KEY_REUSED_MESSAGE,
  KEY_STALE_MESSAGE,
  idempotencyKeyFor,
  missingKeyVersions,
  retryPlan,
  syncedMediaPath,
} from "../core/sync/rules.ts";
import { SYNC_LIMIT_KEY, extraOutcome, isSyncLimit, limitUntil, sendingPaused } from "../core/sync/limit.ts";
import { getDeviceKeys, heldGroupKeyVersions, lockContent, lockFile, unlockContent, unlockFile } from "../../modules/waypoint-keys/index.ts";
import { api } from "./api.ts";
import { deleteFile, blobTempPath } from "./files.ts";
import { dbGeneration, dbUser, getDb, stillSame, writeDb, writeDbIf } from "./db.ts";
import { currentUserId, requireApprovedDevice, restoreApprovedUser, useDeviceStatus } from "./device.ts";
import { createGroup, ensureKeys, refreshGroups } from "./groups.ts";
import { toFailure } from "./tasks.ts";

// The background task for silent "sync" pushes (defined at module scope, as expo-task-manager requires).
export const SYNC_TASK = "waypoint-sync";
// Set (to "1") when the server refused a file for a free plan (plan_required); the space screen says so.
export const SYNC_PLAN_KEY = "sync_plan_required";
const MEDIA_AT_ONCE = 3;
// While the app is open, locally made changes are sent this often (no pull: the socket says when there is more).
const SEND_EVERY_MS = 5_000;
// React Native's WebSocket takes a third argument with the headers (the DOM typings declare two).
const SocketWithHeaders: new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket = WebSocket;

type Opened = { change: SyncChange; deviceId: string };
type Link = { ws: WebSocket | null; openedAt: number | null; attempts: number; timer: ReturnType<typeof setTimeout> | null };
// An outbox entry's locked bytes, kept in memory until it is sent, with the key version and Idempotency-Key they went under.
type Sealed = { keyVersion: number; key: string; locked: string };

let foreground = false;
let sendTimer: ReturnType<typeof setInterval> | null = null;
const links = new Map<string, Link>();
// One run per group at a time: a later request waits for the one running, so no change is dropped.
const queues = new Map<string, Promise<void>>();
const waiting = new Map<string, number>();
// A pull that is queued but has not started yet: a change that arrives meanwhile is covered by it (no second run).
const pullQueued = new Map<string, Promise<void>>();
const sealed = new Map<string, Sealed>();
const sealings = new Map<string, number>();

// Work that awaits and then writes reads dbGeneration() first and stops here if the notes changed meanwhile (sign-out, or
// another person signed in): a write must never land in someone else's notes.
function sameNotes(generation: number): void {
  if (dbGeneration() !== generation) throw new Error("the notes changed");
}

const blobKey = (groupId: string, blobId: string): string => `groups/${groupId}/media/${blobId}`;

function syncedGroupIds(db: SqlDb): string[] {
  return db.all<{ group_id: string }>("SELECT sg.group_id FROM space_groups sg JOIN groups g ON g.id = sg.group_id WHERE g.left_at IS NULL").map((r) => r.group_id);
}

export function isSpaceSynced(db: SqlDb, spaceId: string): boolean {
  return db.get("SELECT 1 AS ok FROM space_groups WHERE space_id = ?", [spaceId]) !== null;
}

// Turning sync on for a space (M29b): a personal group, the mapping, then every row the space has now marked to send.
// Parents are marked with their children; collectChanges orders them. Triggers only mark rows once a space syncs.
function markExisting(db: SqlDb, spaceId: string): void {
  db.run("INSERT INTO dirty (table_name, row_id, deleted, group_id) SELECT 'spaces', id, 0, NULL FROM spaces WHERE id = ?", [spaceId]);
  db.run("INSERT INTO dirty (table_name, row_id, deleted, group_id) SELECT 'sessions', id, 0, NULL FROM sessions WHERE space_id = ?", [spaceId]);
  for (const table of ["captures", "flags", "cards"]) {
    db.run(
      `INSERT INTO dirty (table_name, row_id, deleted, group_id) SELECT '${table}', x.id, 0, NULL FROM ${table} x JOIN sessions s ON s.id = x.session_id WHERE s.space_id = ?`,
      [spaceId],
    );
  }
  db.run(
    `INSERT INTO dirty (table_name, row_id, deleted, group_id)
     SELECT DISTINCT 'segments', g.session_id || ':' || g.source || ':' || (g.t_start / ${SEGMENT_BUCKET_MS}), 0, NULL
     FROM segments g JOIN sessions s ON s.id = g.session_id WHERE s.space_id = ?`,
    [spaceId],
  );
}

export async function turnOnSync(spaceId: string): Promise<void> {
  const space = getSpace(getDb(), spaceId);
  if (space === null || isSpaceSynced(getDb(), spaceId)) return;
  const groupId = await createGroup("personal", space.name);
  writeDb((db) => {
    db.transaction(() => {
      db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, ?)", [spaceId, groupId]);
      markExisting(db, spaceId);
    });
  });
  if (foreground) void connect(groupId);
  void syncNow(groupId);
}

// The blob key of a capture's file: an existing blob, or a new one made now (the file is locked and uploaded first).
// null: the capture has no file, or the plan does not allow media (the change then goes without its file).
async function mediaKeyFor(captureId: string, user: string, groupId: string, keyVersion: number, generation: number): Promise<string | null> {
  const row = getDb().get<{ blob_id: string | null; file: string }>("SELECT blob_id, file FROM captures WHERE id = ?", [captureId]);
  if (row === null) return null;
  if (row.blob_id !== null) return blobKey(groupId, row.blob_id);
  if (row.file === "" || !new File(Paths.document, row.file).exists) return null;
  const blobId = randomUUID();
  const locked = blobTempPath(`${blobId}-locked`);
  try {
    await lockFile(user, groupId, keyVersion, blobId, row.file, locked);
    await api.uploadBlob(groupId, blobId, await new File(Paths.document, locked).bytes());
  } catch (error) {
    sameNotes(generation);
    if (error instanceof ApiCallError && error.code === "plan_required") {
      writeDb((db) => setSetting(db, SYNC_PLAN_KEY, "1"));
      return null;
    }
    throw error;
  } finally {
    deleteFile(locked);
  }
  sameNotes(generation);
  writeDb((db) => {
    db.run("UPDATE captures SET blob_id = ? WHERE id = ?", [blobId, captureId]); // queues the capture again, with its blob
    deleteSetting(db, SYNC_PLAN_KEY);
  });
  return blobKey(groupId, blobId);
}

// The locked bytes of an entry: the cached ones while they are for the current key version, otherwise a new locking
// under a new Idempotency-Key. Each change is locked under context("change", group, device, kind) (docs/security.md
// section 11); only the locked bytes and the blob key leave the phone.
async function sealEntry(user: string, group: StoredGroup, deviceId: string, entry: Outgoing, relock: boolean): Promise<Sealed> {
  const cached = sealed.get(entry.id);
  if (cached !== undefined && cached.keyVersion === group.keyVersion && !relock) return cached;
  const locking = sealings.get(entry.id) ?? 0;
  sealings.set(entry.id, locking + 1);
  const locked = await lockContent(user, group.id, group.keyVersion, "change", [group.id, deviceId, entry.kind], entry.body);
  const next: Sealed = { keyVersion: group.keyVersion, key: idempotencyKeyFor(entry.id, group.keyVersion, locking), locked };
  sealed.set(entry.id, next);
  return next;
}

// Sends one outbox entry, the same bytes under the same key on a retry. A 409 that says the key was reused for other
// bytes is a bug signal: the cached bytes are dropped and the entry is locked again once, under a new key. A stale key
// version throws: the caller takes the new key, and the next run locks under it. Throws on any failure, so the caller
// stops at it (later entries may be its children).
async function sendEntry(user: string, group: StoredGroup, deviceId: string, entry: Outgoing, generation: number): Promise<void> {
  const blob = entry.blobCaptureId === null ? null : await mediaKeyFor(entry.blobCaptureId, user, group.id, group.keyVersion, generation);
  let relock = false;
  for (;;) {
    const current = await sealEntry(user, group, deviceId, entry, relock);
    try {
      await api.postChange(group.id, { device_id: deviceId, key_version: current.keyVersion, kind: entry.kind, locked_bytes: current.locked, blob_key: blob }, current.key);
    } catch (error) {
      if (!relock && error instanceof ApiCallError && error.status === 409 && error.message === KEY_REUSED_MESSAGE) {
        relock = true;
        continue;
      }
      throw error;
    }
    sameNotes(generation);
    sent(getDb(), entry.id);
    sealed.delete(entry.id);
    sealings.delete(entry.id);
    return;
  }
}

async function sendPending(user: string, group: StoredGroup, deviceId: string, generation: number): Promise<void> {
  for (;;) {
    sameNotes(generation);
    const batch = nextOutgoing(getDb(), 50, group.id);
    if (batch.length === 0) return;
    for (const entry of batch) await sendEntry(user, group, deviceId, entry, generation);
  }
}

// Unlocks and parses one change. A change that does not open, parse, or match its kind is skipped (nothing is logged).
async function openChange(user: string, groupId: string, change: ChangesPage["changes"][number]): Promise<SyncChange | null> {
  try {
    const parsed = SyncChangeSchema.safeParse(JSON.parse(await unlockContent(user, groupId, "change", [groupId, change.device_id, change.kind], change.locked_bytes)));
    return parsed.success && changeKind(parsed.data) === change.kind ? parsed.data : null;
  } catch {
    return null;
  }
}

// GET /v1/groups/:id/changes after the last seq, page by page, until a page is empty. Each page is unlocked first
// (the awaits), then applied and its last seq kept in one synchronous run. Own changes are not skipped.
async function pullAll(user: string, groupId: string, deviceId: string, generation: number): Promise<void> {
  for (;;) {
    sameNotes(generation);
    const page = await api.changes(groupId, lastSeq(getDb(), groupId));
    sameNotes(generation);
    const last = page.changes[page.changes.length - 1];
    if (last === undefined) return;
    // A change sealed under a key this iPhone does not hold yet (a removal, a new device, an invite) is not skipped:
    // the keys are fetched, and this pull stops with last seq where it was.
    const absent = missingKeyVersions(
      page.changes.map((c) => c.key_version),
      heldGroupKeyVersions(user, groupId),
    );
    if (absent.length > 0) {
      await ensureKeys(groupId, { now: true }).catch(() => undefined);
      return;
    }
    const opened: Opened[] = [];
    for (const change of page.changes) {
      const unlocked = await openChange(user, groupId, change);
      if (unlocked !== null) opened.push({ change: unlocked, deviceId: change.device_id });
    }
    sameNotes(generation);
    writeDb((db) => {
      applyPulled(db, groupId, opened, { now: Date.now, newId: randomUUID, deviceId });
      setLastSeq(db, groupId, last.seq, Date.now());
    });
  }
}

// Captures whose file is still on the server: download, unlock into their session's synced folder, then set the file.
// The folder is apart from this iPhone's recordings, so a remote id can never overwrite one (rules.ts).
async function downloadMedia(user: string, groupId: string, c: { id: string; blob_id: string; session_id: string; kind: string }, generation: number): Promise<void> {
  const relative = syncedMediaPath(c.session_id, c.id, c.kind);
  if (relative === null) return;
  const locked = blobTempPath(`${c.blob_id}-in`);
  try {
    await new File(Paths.document, locked).write(await api.blob(c.blob_id));
    new Directory(Paths.document, "sessions", c.session_id, "synced").create({ idempotent: true, intermediates: true });
    await unlockFile(user, groupId, c.blob_id, locked, relative);
    sameNotes(generation);
    writeDb((db) => db.run("UPDATE captures SET file = ? WHERE id = ?", [relative, c.id]));
  } catch {
    // Not here yet: the next pull tries again.
  } finally {
    deleteFile(locked);
  }
}

async function fetchMedia(user: string, groupId: string, generation: number): Promise<void> {
  const waitingFiles = getDb().all<{ id: string; blob_id: string; session_id: string; kind: string }>(
    `SELECT c.id, c.blob_id, c.session_id, c.kind FROM captures c
     JOIN sessions s ON s.id = c.session_id JOIN space_groups g ON g.space_id = s.space_id
     WHERE g.group_id = ? AND c.blob_id IS NOT NULL AND c.file = ''`,
    [groupId],
  );
  for (let i = 0; i < waitingFiles.length; i += MEDIA_AT_ONCE) {
    await Promise.all(waitingFiles.slice(i, i + MEDIA_AT_ONCE).map((c) => downloadMedia(user, groupId, c, generation)));
  }
}

// One send (and, when asked, a pull and the media down). Never throws: a failure waits for the next run. The send and
// the pull fail apart, so a failed send does not hold back the group's incoming changes in the same run.
async function runOnce(groupId: string, pull: boolean): Promise<void> {
  try {
    await runNow(groupId, pull);
  } catch {
    // Nobody is signed in (the notes are closed) or the notes changed: nothing to do, and the queue must go on.
  }
}

async function runNow(groupId: string, pull: boolean): Promise<void> {
  // This run starts now, so a request made from here on queues a run of its own (it may carry newer changes).
  if (pull) pullQueued.delete(groupId);
  const generation = dbGeneration();
  const user = currentUserId();
  const keys = user === null ? null : getDeviceKeys(user);
  const group = getGroup(getDb(), groupId);
  // Only a group mapped to a space syncs: an unmapped one (a push for a group this iPhone has no space for) is left alone.
  if (user === null || keys === null || group === null || group.leftAt !== null || !syncedGroupIds(getDb()).includes(groupId)) return;
  try {
    collectChanges(getDb(), { now: Date.now, newId: randomUUID, deviceId: keys.deviceId });
    // Today's sync is used up (open question 55): changes wait in the outbox; pulls go on.
    if (!sendingPaused(getSetting(getDb(), SYNC_LIMIT_KEY), Date.now())) await sendPending(user, group, keys.deviceId, generation);
  } catch (error) {
    await afterFailure(groupId, error, generation);
  }
  if (!pull) return;
  try {
    await pullAll(user, groupId, keys.deviceId, generation);
    await fetchMedia(user, groupId, generation);
  } catch (error) {
    await afterFailure(groupId, error, generation);
  }
}

// True when `error` says today's sync is used up (open question 55). Sending then waits until the time the server gave,
// and the space screen offers more (the sync-limit sheet). The share screen calls this for a link, too. `generation` is
// dbGeneration() from before the request: if someone else's notes are open by now, nothing is written.
export function syncLimitHit(error: unknown, generation: number): boolean {
  if (!(error instanceof ApiCallError && isSyncLimit(error.status, error.message))) return false;
  const until = limitUntil(Date.now(), error.retryAfter);
  writeDbIf(generation, (db) => setSetting(db, SYNC_LIMIT_KEY, String(until)));
  return true;
}

// The Idempotency-Key of the purchase the sheet is trying. Kept until the purchase is done or the server says this key
// can never buy (extraOutcome), so a tap after buying credits, after a lost reply or while the last one is still running
// never pays twice.
let extraKey: string | null = null;

// The sheet's "Add 1 GB": spends SYNC_EXTRA_CREDITS for more sync today (POST /v1/sync/extra, D5), then sends what
// waited. null when it is bought, by this tap or by an earlier one whose reply was lost. "price_changed" when the server
// charges another price. Otherwise why not: an iPhone that is not approved yet gets the screen that says why, and
// "device" back. The API client already waits and retries "request in progress" and server errors with the same key.
export async function buyMoreSync(): Promise<CloudFailure | "price_changed" | null> {
  if (!requireApprovedDevice()) return { kind: "device" };
  extraKey ??= randomUUID();
  const generation = dbGeneration();
  try {
    await api.buySyncExtra(SYNC_EXTRA_CREDITS, extraKey);
  } catch (error) {
    const outcome = error instanceof ApiCallError ? extraOutcome(error.status, error.message) : "same_key";
    if (outcome !== "bought") {
      if (outcome !== "same_key") extraKey = null;
      return outcome === "price_changed" ? "price_changed" : toFailure(error);
    }
  }
  extraKey = null;
  if (!stillSame(generation)) return null; // signed out meanwhile: the next sign-in finds the limit again
  // Sending starts again now. If today's budget is still used up, the next send finds the limit again.
  writeDb((db) => deleteSetting(db, SYNC_LIMIT_KEY));
  for (const groupId of syncedGroupIds(getDb())) void syncNow(groupId);
  return null;
}

// The group's key moved on (a member was removed): take the new key now; the outbox waits for it.
async function afterFailure(groupId: string, error: unknown, generation: number): Promise<void> {
  if (syncLimitHit(error, generation)) return;
  if (error instanceof ApiCallError && error.status === 409 && error.message === KEY_STALE_MESSAGE) {
    await refreshGroups().catch(() => undefined);
    await ensureKeys(groupId, { now: false }).catch(() => undefined);
  }
}

function enqueue(groupId: string, pull: boolean): Promise<void> {
  waiting.set(groupId, (waiting.get(groupId) ?? 0) + 1);
  const run = (queues.get(groupId) ?? Promise.resolve()).catch(() => undefined).then(() => runOnce(groupId, pull));
  const done = run.finally(() => waiting.set(groupId, (waiting.get(groupId) ?? 1) - 1));
  queues.set(groupId, done);
  return done;
}

// Sends this iPhone's changes for a group, then pulls the group's changes. Resolves when done; never rejects.
export function syncNow(groupId: string): Promise<void> {
  return pullSoon(groupId);
}

// A pull for the group. One that is queued and not yet started already covers this request.
function pullSoon(groupId: string): Promise<void> {
  const queued = pullQueued.get(groupId);
  if (queued !== undefined) return queued;
  const run = enqueue(groupId, true);
  pullQueued.set(groupId, run);
  return run;
}

// Acknowledges what was pulled, as the socket asks (PR 28).
function acknowledge(ws: WebSocket, groupId: string): void {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ack", seq: lastSeq(getDb(), groupId) }));
  } catch {
    // Signed out meanwhile (no notes open): nothing to acknowledge.
  }
}

function linkFor(groupId: string): Link {
  const existing = links.get(groupId);
  if (existing !== undefined) return existing;
  const link: Link = { ws: null, openedAt: null, attempts: 0, timer: null };
  links.set(groupId, link);
  return link;
}

// Tries the socket again later (rules.ts: 2, 5, 15, 30 s; a socket that stayed open 30 s starts the backoff again).
function scheduleConnect(groupId: string, link: Link, closedAt: number): void {
  if (link.timer !== null) return;
  const plan = retryPlan(link.attempts, link.openedAt, closedAt);
  link.attempts = plan.attempts;
  link.openedAt = null;
  link.timer = setTimeout(() => {
    link.timer = null;
    void connect(groupId);
  }, plan.waitMs);
}

// One socket per synced group while the app is active. "changed" with a newer seq pulls; 4003 (membership ended)
// refreshes the groups and does not reconnect; 4000 (replaced by another connection) does not reconnect either.
async function connect(groupId: string): Promise<void> {
  const user = currentUserId();
  const keys = user === null ? null : getDeviceKeys(user);
  const token = await api.token().catch(() => null);
  const link = linkFor(groupId);
  if (!foreground || keys === null || link.ws !== null || link.timer !== null) return;
  if (token === null) {
    scheduleConnect(groupId, link, Date.now()); // signed out, or the token is not there yet: try again later
    return;
  }
  const ws = new SocketWithHeaders(api.syncSocketUrl(groupId, keys.deviceId), undefined, { headers: { Authorization: `Bearer ${token}` } });
  link.ws = ws;
  ws.onopen = () => {
    link.openedAt = Date.now();
    void pullSoon(groupId).then(() => acknowledge(ws, groupId));
  };
  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let message: ReturnType<typeof SyncServerMessageSchema.safeParse>;
    try {
      message = SyncServerMessageSchema.safeParse(JSON.parse(event.data));
    } catch {
      return;
    }
    try {
      if (message.success && message.data.last_seq > lastSeq(getDb(), groupId)) {
        void pullSoon(groupId).then(() => acknowledge(ws, groupId));
      }
    } catch {
      // Signed out meanwhile (no notes open).
    }
  };
  ws.onclose = (event) => {
    if (link.ws === ws) link.ws = null;
    if (!foreground) return;
    if (event.code === 4003) {
      void refreshGroups().catch(() => undefined);
      return;
    }
    if (event.code === 4000) return;
    scheduleConnect(groupId, link, Date.now());
  };
}

function disconnect(): void {
  for (const link of links.values()) {
    if (link.timer !== null) clearTimeout(link.timer);
    link.ws?.close();
  }
  links.clear();
}

// The app came to the front: sockets, a pull for each synced group, and the periodic send. Closed in the background.
function startForeground(): void {
  if (foreground) return;
  foreground = true;
  const groupIds = (): string[] => {
    try {
      return syncedGroupIds(getDb());
    } catch {
      return []; // nobody is signed in
    }
  };
  for (const groupId of groupIds()) {
    void connect(groupId);
    void syncNow(groupId);
  }
  sendTimer = setInterval(() => {
    for (const groupId of groupIds()) if ((waiting.get(groupId) ?? 0) === 0) void enqueue(groupId, false);
  }, SEND_EVERY_MS);
}

function stopForeground(): void {
  foreground = false;
  disconnect();
  if (sendTimer !== null) clearInterval(sendTimer);
  sendTimer = null;
}

// A silent push carries kind and ref at the top level of the APNs payload (apps/api/src/push/messages.ts). Which of
// the task's fields holds them is checked on the device (see the PR's questions); all three places are read.
function groupFromPush(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const top = data as Record<string, unknown>;
  const candidates: Record<string, unknown>[] = [top];
  if (typeof top.data === "object" && top.data !== null) candidates.push(top.data as Record<string, unknown>);
  if (typeof top.dataString === "string") {
    try {
      const parsed: unknown = JSON.parse(top.dataString);
      if (typeof parsed === "object" && parsed !== null) candidates.push(parsed as Record<string, unknown>);
    } catch {
      // Not JSON: nothing to read here.
    }
  }
  for (const candidate of candidates) {
    const action = actionForPush(candidate);
    if (action.kind === "sync") return action.groupId;
  }
  return null;
}

// The person comes from the stored identity (device.ts); when that is not known, or nobody is signed in on this iPhone
// (open question 52: no notes are open), nothing is done. A push for a group only someone else on this iPhone is in
// finds no such group in these notes and does nothing either (runOnce).
TaskManager.defineTask(SYNC_TASK, async ({ data, error }) => {
  if (error !== null) return;
  const groupId = groupFromPush(data);
  if (groupId !== null && dbUser() !== null && restoreApprovedUser() !== null) await syncNow(groupId);
});

// Called once in (tabs)/_layout.tsx: runs the sync while the app is active, and registers the silent push task.
export function useSync(): void {
  const status = useDeviceStatus();
  useEffect(() => {
    if (status !== "approved") return;
    void Notifications.registerTaskAsync(SYNC_TASK).catch(() => undefined);
    // Only "background" closes the sockets: Control Center or an alert ("inactive") leaves the sync running.
    const onState = (state: AppStateStatus) => {
      if (state === "active") startForeground();
      else if (state === "background") stopForeground();
    };
    if (AppState.currentState === "active") startForeground();
    const subscription = AppState.addEventListener("change", onState);
    return () => {
      subscription.remove();
      stopForeground();
    };
  }, [status]);
}
