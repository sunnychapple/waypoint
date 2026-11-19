import {
  ZeroRetentionRequestSchema,
  type ActivityItem,
  type ActivityResponse,
  type ZeroRetentionResponse,
} from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";

export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 100;

// Cursor "<at>_<id>": the last item of the page before. Items are newest first, ties broken by id.
function parseCursor(value: string | undefined): { at: number; id: string } | null {
  if (value === undefined) return null;
  const match = /^(\d{1,16})_([A-Za-z0-9_:-]{1,128})$/.exec(value);
  if (match === null) throw new ApiFailure("bad_request", "invalid request");
  return { at: Number(match[1]), id: match[2] ?? "" };
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return ACTIVITY_DEFAULT_LIMIT;
  if (!/^\d{1,3}$/.test(value)) throw new ApiFailure("bad_request", "invalid request");
  const limit = Number(value);
  if (limit < 1 || limit > ACTIVITY_MAX_LIMIT) throw new ApiFailure("bad_request", "invalid request");
  return limit;
}

export function privacyRoutes(deps: { now: () => number }): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .put("/v1/settings/zero-retention", idempotent(deps), async (c) => {
      const user = c.get("user");
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = ZeroRetentionRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const enabled = parsed.data.enabled;
      if (enabled && user.plan !== "plus") throw new ApiFailure("plan_required", "zero retention needs Plus");
      await c.env.DB.prepare("UPDATE users SET zero_retention = ? WHERE id = ?").bind(enabled ? 1 : 0, user.id).run();
      const reply: ZeroRetentionResponse = { zero_retention: enabled };
      return c.json(reply);
    })
    .get("/v1/activity", async (c) => {
      const user = c.get("user");
      const limit = parseLimit(c.req.query("limit"));
      const before = parseCursor(c.req.query("before"));
      const columns = "id, task, bytes_sent, credits, route, retention, at";
      const query =
        before === null
          ? c.env.DB.prepare(`SELECT ${columns} FROM activity WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT ?`).bind(
              user.id,
              limit + 1,
            )
          : c.env.DB.prepare(
              `SELECT ${columns} FROM activity WHERE user_id = ? AND (at < ? OR (at = ? AND id < ?)) ORDER BY at DESC, id DESC LIMIT ?`,
            ).bind(user.id, before.at, before.at, before.id, limit + 1);
      const { results } = await query.all<ActivityItem>();
      const items = results.slice(0, limit);
      const last = items[items.length - 1];
      const reply: ActivityResponse = {
        items,
        next: results.length > limit && last !== undefined ? `${last.at}_${last.id}` : null,
      };
      return c.json(reply);
    });
}
