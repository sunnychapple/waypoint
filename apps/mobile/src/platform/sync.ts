import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { ApiCallError, type ChangesPage } from "@waypoint/api-client";
import { SyncServerMessageSchema } from "@waypoint/contracts";
import { deleteSetting, setSetting } from "../core/db/settings.ts";
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
import { getDeviceKeys, lockContent, lockFile, unlockContent, unlockFile } from "../../modules/waypoint-keys/index.ts";
import { api } from "./api.ts";
import { deleteFile, blobTempPath } from "./files.ts";
import { getDb, writeDb } from "./db.ts";
import { currentUserId, useDeviceStatus } from "./device.ts";
import { createGroup, ensureKeys, refreshGroups } from "./groups.ts";

// The background task for silent "sync" pushes (defined at module scope, as expo-task-manager requires).
export const SYNC_TASK = "waypoint-sync";
// Set (to "1") when the server refused a file for a free plan (plan_required); the space screen says so.
export const SYNC_PLAN_KEY = "sync_plan_required";
const MEDIA_AT_ONCE = 3;
const RECONNECT_MS = [2_000, 5_000, 15_000, 30_000] as const;
// While the app is open, locally made changes are sent this often (no pull: the socket says when there is more).
const SEND_EVERY_MS = 5_000;
const KEY_STALE = "key version is not current";
// React Native's WebSocket takes a third argument with the headers (the DOM typings declare two).
const SocketWithHeaders: new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket = WebSocket;

type Opened = { change: SyncChange; deviceId: string };
type Link = { ws: WebSocket | null; attempts: number; timer: ReturnType<typeof setTimeout> | null };

let foreground = false;
let sendTimer: ReturnType<typeof setInterval> | null = null;
const links = new Map<string, Link>();
// One run per group at a time: a later request waits for the one running, so no change is dropped.
const queues = new Map<string, Promise<void>>();
const waiting = new Map<string, number>();

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
async function mediaKeyFor(captureId: string, user: string, groupId: string, keyVersion: number): Promise<string | null> {
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
    if (error instanceof ApiCallError && error.code === "plan_required") {
      writeDb((db) => setSetting(db, SYNC_PLAN_KEY, "1"));
      return null;
    }
    throw error;
  } finally {
    deleteFile(locked);
  }
  writeDb((db) => {
    db.run("UPDATE captures SET blob_id = ? WHERE id = ?", [blobId, captureId]); // queues the capture again, with its blob
    deleteSetting(db, SYNC_PLAN_KEY);
  });
  return blobKey(groupId, blobId);
}

// Sends one outbox entry. Each change is locked with the group key under context("change", group, device, kind)
// (docs/security.md section 11); only the locked bytes and the blob key leave the phone. Throws on any failure, so
// the caller stops at it (later entries may be its children).
async function sendEntry(user: string, group: StoredGroup, deviceId: string, entry: Outgoing): Promise<void> {
  const blob = entry.blobCaptureId === null ? null : await mediaKeyFor(entry.blobCaptureId, user, group.id, group.keyVersion);
  const locked = await lockContent(user, group.id, group.keyVersion, "change", [group.id, deviceId, entry.kind], entry.body);
  await api.postChange(group.id, { device_id: deviceId, key_version: group.keyVersion, kind: entry.kind, locked_bytes: locked, blob_key: blob }, entry.id);
  sent(getDb(), entry.id);
}

async function sendPending(user: string, group: StoredGroup, deviceId: string): Promise<void> {
  for (;;) {
    const batch = nextOutgoing(getDb(), 50).filter((e) => e.groupId === group.id);
    if (batch.length === 0) return;
    for (const entry of batch) await sendEntry(user, group, deviceId, entry);
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
async function pullAll(user: string, groupId: string, deviceId: string): Promise<void> {
  for (;;) {
    const page = await api.changes(groupId, lastSeq(getDb(), groupId));
    const last = page.changes[page.changes.length - 1];
    if (last === undefined) return;
    const opened: Opened[] = [];
    for (const change of page.changes) {
      const unlocked = await openChange(user, groupId, change);
      if (unlocked !== null) opened.push({ change: unlocked, deviceId: change.device_id });
    }
    writeDb((db) => {
      applyPulled(db, groupId, opened, { now: Date.now, newId: randomUUID, deviceId });
      setLastSeq(db, groupId, last.seq, Date.now());
    });
  }
}

// Captures whose file is still on the server: download, unlock into their session folder, then set the file.
async function downloadMedia(user: string, groupId: string, c: { id: string; blob_id: string; session_id: string; kind: string }): Promise<void> {
  const relative = `sessions/${c.session_id}/${c.id}.${c.kind === "audio" ? "m4a" : "jpg"}`;
  const locked = blobTempPath(`${c.blob_id}-in`);
  try {
    await new File(Paths.document, locked).write(await api.blob(c.blob_id));
    new Directory(Paths.document, "sessions", c.session_id).create({ idempotent: true, intermediates: true });
    await unlockFile(user, groupId, c.blob_id, locked, relative);
    writeDb((db) => db.run("UPDATE captures SET file = ? WHERE id = ?", [relative, c.id]));
  } catch {
    // Not here yet: the next pull tries again.
  } finally {
    deleteFile(locked);
  }
}

async function fetchMedia(user: string, groupId: string): Promise<void> {
  const waitingFiles = getDb().all<{ id: string; blob_id: string; session_id: string; kind: string }>(
    `SELECT c.id, c.blob_id, c.session_id, c.kind FROM captures c
     JOIN sessions s ON s.id = c.session_id JOIN space_groups g ON g.space_id = s.space_id
     WHERE g.group_id = ? AND c.blob_id IS NOT NULL AND c.file = ''`,
    [groupId],
  );
  for (let i = 0; i < waitingFiles.length; i += MEDIA_AT_ONCE) {
    await Promise.all(waitingFiles.slice(i, i + MEDIA_AT_ONCE).map((c) => downloadMedia(user, groupId, c)));
  }
}

// One send (and, when asked, a pull and the media down). Never throws: a failure waits for the next run.
async function runOnce(groupId: string, pull: boolean): Promise<void> {
  try {
    const user = currentUserId();
    const keys = user === null ? null : getDeviceKeys(user);
    const group = getGroup(getDb(), groupId);
    if (user === null || keys === null || group === null || group.leftAt !== null) return;
    collectChanges(getDb(), { now: Date.now, newId: randomUUID, deviceId: keys.deviceId });
    await sendPending(user, group, keys.deviceId);
    if (!pull) return;
    await pullAll(user, groupId, keys.deviceId);
    await fetchMedia(user, groupId);
  } catch (error) {
    // The group's key moved on (a member was removed): take the new key now; the outbox waits for it.
    if (error instanceof ApiCallError && error.status === 409 && error.message === KEY_STALE) {
      await refreshGroups().catch(() => undefined);
      await ensureKeys(groupId, { now: false }).catch(() => undefined);
    }
  }
}

function enqueue(groupId: string, pull: boolean): Promise<void> {
  waiting.set(groupId, (waiting.get(groupId) ?? 0) + 1);
  const run = (queues.get(groupId) ?? Promise.resolve()).then(() => runOnce(groupId, pull));
  const done = run.finally(() => waiting.set(groupId, (waiting.get(groupId) ?? 1) - 1));
  queues.set(groupId, done);
  return done;
}

// Sends this iPhone's changes for a group, then pulls the group's changes. Resolves when done; never rejects.
export function syncNow(groupId: string): Promise<void> {
  return enqueue(groupId, true);
}

// Acknowledges what was pulled, as the socket asks (PR 28).
function acknowledge(ws: WebSocket, groupId: string): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ack", seq: lastSeq(getDb(), groupId) }));
}

function linkFor(groupId: string): Link {
  const existing = links.get(groupId);
  if (existing !== undefined) return existing;
  const link: Link = { ws: null, attempts: 0, timer: null };
  links.set(groupId, link);
  return link;
}

// One socket per synced group while the app is active. "changed" with a newer seq pulls; 4003 (membership ended)
// refreshes the groups and does not reconnect; 4000 (replaced by another connection) does not reconnect either.
async function connect(groupId: string): Promise<void> {
  const user = currentUserId();
  const keys = user === null ? null : getDeviceKeys(user);
  const token = await api.token().catch(() => null);
  const link = linkFor(groupId);
  if (!foreground || keys === null || token === null || link.ws !== null) return;
  const ws = new SocketWithHeaders(api.syncSocketUrl(groupId, keys.deviceId), undefined, { headers: { Authorization: `Bearer ${token}` } });
  link.ws = ws;
  ws.onopen = () => {
    link.attempts = 0;
    void enqueue(groupId, true).then(() => acknowledge(ws, groupId));
  };
  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let message: ReturnType<typeof SyncServerMessageSchema.safeParse>;
    try {
      message = SyncServerMessageSchema.safeParse(JSON.parse(event.data));
    } catch {
      return;
    }
    if (message.success && message.data.last_seq > lastSeq(getDb(), groupId)) {
      void enqueue(groupId, true).then(() => acknowledge(ws, groupId));
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
    const wait = RECONNECT_MS[Math.min(link.attempts, RECONNECT_MS.length - 1)];
    link.attempts += 1;
    link.timer = setTimeout(() => {
      link.timer = null;
      void connect(groupId);
    }, wait);
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
  const db = getDb();
  for (const groupId of syncedGroupIds(db)) {
    void connect(groupId);
    void syncNow(groupId);
  }
  sendTimer = setInterval(() => {
    for (const groupId of syncedGroupIds(getDb())) if ((waiting.get(groupId) ?? 0) === 0) void enqueue(groupId, false);
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

TaskManager.defineTask(SYNC_TASK, async ({ data, error }) => {
  if (error !== null) return;
  const groupId = groupFromPush(data);
  if (groupId !== null) await syncNow(groupId);
});

// Called once in (tabs)/_layout.tsx: runs the sync while the app is active, and registers the silent push task.
export function useSync(): void {
  const status = useDeviceStatus();
  useEffect(() => {
    if (status !== "approved") return;
    void Notifications.registerTaskAsync(SYNC_TASK).catch(() => undefined);
    const onState = (state: AppStateStatus) => {
      if (state === "active") startForeground();
      else stopForeground();
    };
    if (AppState.currentState === "active") startForeground();
    const subscription = AppState.addEventListener("change", onState);
    return () => {
      subscription.remove();
      stopForeground();
    };
  }, [status]);
}
