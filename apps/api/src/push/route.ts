import { PushTokenRequestSchema, type PushTokenResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";

export const MAX_PUSH_DEVICES = 10;

export function pushTokenRoute(deps: { now: () => number }): Hono<AppEnv> {
  return new Hono<AppEnv>().post("/v1/push-tokens", idempotent(deps), async (c) => {
    const user = c.get("user");
    const body: unknown = await c.req.json().catch(() => {
      throw new ApiFailure("bad_request", "invalid request");
    });
    const parsed = PushTokenRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
    const { device_id, token, environment } = parsed.data;
    const db = c.env.DB;

    const others = await db
      .prepare("SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ? AND device_id <> ?")
      .bind(user.id, device_id)
      .first<{ n: number }>();
    if ((others?.n ?? 0) >= MAX_PUSH_DEVICES) throw new ApiFailure("conflict", "too many devices");

    // A token moves with the app install: whoever registers it last gets its pushes.
    await db
      .prepare("DELETE FROM push_tokens WHERE token = ? AND NOT (user_id = ? AND device_id = ?)")
      .bind(token, user.id, device_id)
      .run();
    await db
      .prepare(
        "INSERT INTO push_tokens (user_id, device_id, token, environment, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, device_id) DO UPDATE SET token = excluded.token, environment = excluded.environment, updated_at = excluded.updated_at",
      )
      .bind(user.id, device_id, token, environment, deps.now())
      .run();
    const reply: PushTokenResponse = { device_id };
    return c.json(reply);
  });
}
