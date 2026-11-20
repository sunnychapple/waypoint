import { CreateGroupRequestSchema, CreateInviteRequestSchema, InviteTokenSchema } from "@waypoint/contracts";
import { sha256, toHex, utf8 } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { isUniqueViolation } from "../keys/envelopes.ts";
import { activeMembership, groupViews } from "./membership.ts";

export const MAX_GROUPS_PER_USER = 100;
export const MAX_MEMBERS = 50;
export const MAX_OPEN_INVITES = 20;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => {
    throw new ApiFailure("bad_request", "invalid request");
  });
}

async function countGroups(db: AppEnv["Bindings"]["DB"], userId: string): Promise<number> {
  const row = await db.prepare("SELECT count(*) AS n FROM memberships WHERE user_id = ? AND left_at IS NULL").bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

export function groupRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .post("/v1/groups", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const parsed = CreateGroupRequestSchema.safeParse(await readJson(c));
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      const db = c.env.DB;
      const user = c.get("user");
      const now = deps.now();
      if ((await countGroups(db, user.id)) >= MAX_GROUPS_PER_USER) throw new ApiFailure("conflict", "too many groups");
      try {
        await db.batch([
          db.prepare("INSERT INTO groups (id, kind, name_locked, key_version, created_by) VALUES (?, ?, ?, 1, ?)").bind(req.id, req.kind, req.name_locked, user.id),
          db
            .prepare("INSERT INTO memberships (group_id, user_id, role, starts_at, ends_at, history_from, left_at) VALUES (?, ?, 'owner', ?, NULL, 0, NULL)")
            .bind(req.id, user.id, now),
        ]);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "group id taken");
        throw error;
      }
      const [view] = await groupViews(db, user.id, now, req.id);
      return c.json(view, 201);
    })
    .get("/v1/groups", async (c) => {
      return c.json({ groups: await groupViews(c.env.DB, c.get("user").id, deps.now()) });
    })
    .post("/v1/groups/:id/invites", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const parsed = CreateInviteRequestSchema.safeParse(await readJson(c));
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const groupId = c.req.param("id");
      const membership = await activeMembership(db, groupId, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      if (membership.role !== "owner") throw new ApiFailure("forbidden", "only an owner can invite");
      if (membership.kind === "personal") throw new ApiFailure("conflict", "personal groups have no invites");
      if (req.ends_at !== null && (req.role === "owner" || req.ends_at <= now)) throw new ApiFailure("bad_request", "invalid request");
      const open = await db
        .prepare("SELECT count(*) AS n FROM invites WHERE group_id = ? AND accepted_by IS NULL AND expires_at > ?")
        .bind(groupId, now)
        .first<{ n: number }>();
      if ((open?.n ?? 0) >= MAX_OPEN_INVITES) throw new ApiFailure("conflict", "too many open invites");
      const historyFrom = Math.min(req.history_from, now);
      const expiresAt = now + INVITE_TTL_MS;
      try {
        await db
          .prepare("INSERT INTO invites (token_hash, group_id, role, expires_at, accepted_by, created_by, history_from, ends_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)")
          .bind(req.token_hash, groupId, req.role, expiresAt, user.id, historyFrom, req.ends_at)
          .run();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "invite token taken");
        throw error;
      }
      return c.json({ group_id: groupId, role: req.role, history_from: historyFrom, ends_at: req.ends_at, expires_at: expiresAt }, 201);
    })
    .post("/v1/invites/:token/accept", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const token = InviteTokenSchema.safeParse(c.req.param("token"));
      if (!token.success) throw new ApiFailure("not_found", "no such invite");
      const tokenHash = toHex(await sha256(utf8(token.data)));
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const invite = await db
        .prepare(
          `SELECT i.group_id FROM invites i JOIN groups g ON g.id = i.group_id
           WHERE i.token_hash = ? AND i.accepted_by IS NULL AND i.expires_at > ? AND (i.ends_at IS NULL OR i.ends_at > ?) AND g.kind = 'shared'`,
        )
        .bind(tokenHash, now, now)
        .first<{ group_id: string }>();
      if (invite === null) throw new ApiFailure("not_found", "no such invite");
      if ((await activeMembership(db, invite.group_id, user.id, now)) !== null) throw new ApiFailure("conflict", "already a member");
      const members = await db
        .prepare("SELECT count(*) AS n FROM memberships WHERE group_id = ? AND left_at IS NULL")
        .bind(invite.group_id)
        .first<{ n: number }>();
      if ((members?.n ?? 0) >= MAX_MEMBERS) throw new ApiFailure("conflict", "group is full");
      if ((await countGroups(db, user.id)) >= MAX_GROUPS_PER_USER) throw new ApiFailure("conflict", "too many groups");
      // One batch: the membership is written only while the invite is still open, then the invite is used up. A user
      // who was a member before gets their old row back with the invite's terms.
      await db.batch([
        db
          .prepare(
            `INSERT INTO memberships (group_id, user_id, role, starts_at, ends_at, history_from, left_at)
             SELECT group_id, ?, role, ?, ends_at, history_from, NULL FROM invites
             WHERE token_hash = ? AND accepted_by IS NULL AND expires_at > ?
             ON CONFLICT (group_id, user_id) DO UPDATE SET role = excluded.role, starts_at = excluded.starts_at,
               ends_at = excluded.ends_at, history_from = excluded.history_from, left_at = NULL
             WHERE memberships.left_at IS NOT NULL OR memberships.ends_at <= ?`,
          )
          .bind(user.id, now, tokenHash, now, now),
        db.prepare("UPDATE invites SET accepted_by = ? WHERE token_hash = ? AND accepted_by IS NULL AND expires_at > ?").bind(user.id, tokenHash, now),
      ]);
      const used = await db.prepare("SELECT accepted_by FROM invites WHERE token_hash = ?").bind(tokenHash).first<{ accepted_by: string | null }>();
      if (used?.accepted_by !== user.id) throw new ApiFailure("not_found", "no such invite");
      const [view] = await groupViews(db, user.id, now, invite.group_id);
      if (view === undefined) throw new ApiFailure("not_found", "no such invite");
      return c.json(view);
    });
}
