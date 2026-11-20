import { PostChangeRequestSchema, type ChangeView } from "@waypoint/contracts";
import { contentKeyVersion, fromBase64Url, toBase64Url } from "@waypoint/crypto";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { activeMembership } from "../groups/membership.ts";
import { idempotent } from "../idempotency.ts";
import type { PushMessage } from "../push/messages.ts";
import { ROOM_DEVICE_HEADER, ROOM_UNTIL_HEADER, ROOM_USER_HEADER, type PushTarget } from "../room/sockets.ts";
import type { Change } from "../room/store.ts";
import type { Db } from "../storage.ts";
import { spendSyncBytes } from "./budget.ts";

export const DEFAULT_PAGE = 100;
export const MAX_PAGE = 500;
// Locked bytes per page of GET /changes; one bigger change still comes alone.
export const MAX_PAGE_BYTES = 4 * 1024 * 1024;
// Queues accept at most 100 messages per sendBatch.
const PUSH_BATCH = 100;

// Approved, not removed phones and iPads of the group's active members, except the writer's device.
const TARGETS_SQL = `
  SELECT d.id, d.user_id FROM memberships m JOIN devices d ON d.user_id = m.user_id
  WHERE m.group_id = ? AND m.left_at IS NULL AND (m.ends_at IS NULL OR m.ends_at > ?)
    AND d.kind = 'device' AND d.removed_at IS NULL AND d.approved_at IS NOT NULL AND d.id != ?
  ORDER BY d.id`;

function viewOf(change: Change): ChangeView {
  return { ...change, locked_bytes: toBase64Url(new Uint8Array(change.locked_bytes)) };
}

function intQuery(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d{1,16}$/.test(value)) throw new ApiFailure("bad_request", "invalid request");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new ApiFailure("bad_request", "invalid request");
  return n;
}

async function approvedDevice(db: Db, deviceId: string, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM devices WHERE id = ? AND user_id = ? AND kind = 'device' AND removed_at IS NULL AND approved_at IS NOT NULL")
    .bind(deviceId, userId)
    .first<{ id: string }>();
  return row !== null;
}

export function syncRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .get("/v1/groups/:id/changes", async (c) => {
      const groupId = c.req.param("id");
      const membership = await activeMembership(c.env.DB, groupId, c.get("user").id, deps.now());
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      const after = intQuery(c.req.query("after"), 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = intQuery(c.req.query("limit"), DEFAULT_PAGE, 1, MAX_PAGE);
      const room = c.env.GROUP_ROOM.get(c.env.GROUP_ROOM.idFromName(groupId));
      const page = await room.after(after, limit, { fromAt: membership.history_from, maxBytes: MAX_PAGE_BYTES });
      return c.json({ key_version: membership.key_version, last_seq: page.last_seq, changes: page.changes.map(viewOf) });
    })
    .post("/v1/groups/:id/changes", idempotent(deps), async (c) => {
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = PostChangeRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const groupId = c.req.param("id");
      const membership = await activeMembership(db, groupId, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      if (membership.role === "viewer") throw new ApiFailure("forbidden", "viewers cannot write");
      if (!(await approvedDevice(db, req.device_id, user.id))) throw new ApiFailure("forbidden", "not an approved device of this user");
      // docs/security.md, section 15: nothing is written with a key a removed member knows.
      if (req.key_version !== membership.key_version) throw new ApiFailure("conflict", "key version is not current");
      let bytes: Uint8Array;
      try {
        bytes = fromBase64Url(req.locked_bytes);
        if (contentKeyVersion(bytes) !== req.key_version || bytes.length > 1_048_576) throw new RangeError("bad locked bytes");
      } catch {
        throw new ApiFailure("bad_request", "invalid request");
      }
      if (req.blob_key !== null && !req.blob_key.startsWith(`groups/${groupId}/media/`)) throw new ApiFailure("bad_request", "invalid request");
      await spendSyncBytes(db, user.id, bytes.length, now);

      const targets = (await db.prepare(TARGETS_SQL).bind(groupId, now, req.device_id).all<PushTarget>()).results;
      const room = c.env.GROUP_ROOM.get(c.env.GROUP_ROOM.idFromName(groupId));
      const result = await room.append(
        { device_id: req.device_id, key_version: req.key_version, kind: req.kind, locked_bytes: new Uint8Array(bytes).buffer, blob_key: req.blob_key },
        targets,
      );
      // A lost push is not an error: the change is stored, and the device catches up when it next opens the group.
      try {
        for (let i = 0; i < result.push.length; i += PUSH_BATCH) {
          const messages = result.push.slice(i, i + PUSH_BATCH).map((t): { body: PushMessage } => ({
            body: { user_id: t.user_id, kind: "sync", ref: groupId, device_id: t.id },
          }));
          await c.env.PUSH_QUEUE.sendBatch(messages);
        }
      } catch {
        // see above
      }
      return c.json({ seq: result.seq }, 201);
    })
    .get("/v1/groups/:id/sync", async (c) => {
      if ((c.req.header("Upgrade") ?? "").toLowerCase() !== "websocket") throw new ApiFailure("bad_request", "websocket upgrade required");
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const groupId = c.req.param("id");
      const membership = await activeMembership(db, groupId, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      const deviceId = c.req.query("device") ?? "";
      if (!(await approvedDevice(db, deviceId, user.id))) throw new ApiFailure("not_found", "no such device");
      const room = c.env.GROUP_ROOM.get(c.env.GROUP_ROOM.idFromName(groupId));
      return room.fetch("https://group-room/sync", {
        headers: {
          Upgrade: "websocket",
          [ROOM_USER_HEADER]: user.id,
          [ROOM_DEVICE_HEADER]: deviceId,
          [ROOM_UNTIL_HEADER]: membership.ends_at === null ? "never" : String(membership.ends_at),
        },
      });
    });
}
