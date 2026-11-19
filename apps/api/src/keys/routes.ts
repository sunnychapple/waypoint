import { GroupKeysRequestSchema } from "@waypoint/contracts";
import { fromBase64Url, parseEnvelope } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { currentMember, storeGroupKeys, TARGETS_SQL, type TargetRow } from "./groups.ts";

export function groupKeyRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .get("/v1/groups/:id/devices", async (c) => {
      const db = c.env.DB;
      const groupId = c.req.param("id");
      const group = await currentMember(db, groupId, c.get("user").id);
      if (group === null) throw new ApiFailure("not_found", "no such group");
      const targets = (await db.prepare(TARGETS_SQL).bind(groupId).all<TargetRow>()).results;
      const holders = (
        await db.prepare("SELECT device_id FROM key_envelopes WHERE group_id = ? AND key_version = ?").bind(groupId, group.key_version).all<{ device_id: string }>()
      ).results;
      const has = new Set(holders.map((h) => h.device_id));
      return c.json({
        key_version: group.key_version,
        devices: targets.map((t) => ({
          id: t.id, user_id: t.user_id, kind: t.kind, role: t.role, sign_pub: t.sign_pub, box_pub: t.box_pub, cert: t.cert, has_current_key: has.has(t.id),
        })),
      });
    })
    .get("/v1/groups/:id/keys", async (c) => {
      const db = c.env.DB;
      const user = c.get("user");
      const groupId = c.req.param("id");
      const deviceId = c.req.query("device") ?? "";
      const group = await currentMember(db, groupId, user.id);
      if (group === null) throw new ApiFailure("not_found", "no such group");
      const device = await db
        .prepare("SELECT id FROM devices WHERE id = ? AND user_id = ? AND removed_at IS NULL AND approved_at IS NOT NULL")
        .bind(deviceId, user.id)
        .first<{ id: string }>();
      if (device === null) throw new ApiFailure("not_found", "no such device");
      const envelopes = (
        await db
          .prepare("SELECT key_version, wrapped_key FROM key_envelopes WHERE group_id = ? AND device_id = ? ORDER BY key_version")
          .bind(groupId, device.id)
          .all<{ key_version: number; wrapped_key: string }>()
      ).results;
      const signerIds = [...new Set(envelopes.map((e) => parseEnvelope(fromBase64Url(e.wrapped_key)).signerId))].sort();
      const signers = [];
      for (const id of signerIds) {
        const row = await db
          .prepare("SELECT id, user_id, kind, sign_pub, cert FROM devices WHERE id = ?")
          .bind(id)
          .first<{ id: string; user_id: string; kind: "device" | "account"; sign_pub: string; cert: string | null }>();
        if (row !== null) signers.push(row);
      }
      return c.json({ key_version: group.key_version, envelopes, signers });
    })
    .post("/v1/groups/:id/keys", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = GroupKeysRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const { first } = await storeGroupKeys(c.env.DB, {
        groupId: c.req.param("id"),
        userId: c.get("user").id,
        signerId: c.get("device").id,
        keyVersion: parsed.data.key_version,
        envelopes: parsed.data.envelopes,
      });
      return c.json({ key_version: parsed.data.key_version, first }, 201);
    });
}
