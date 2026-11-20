import { CreateLinkRequestSchema, LINK_PASSCODE_HEADER, LINK_TURNSTILE_HEADER, LinkIdSchema, LinkPasscodeSchema } from "@waypoint/contracts";
import { bytesEqual, contentKeyVersion, fromBase64Url, linkPasscodeHash } from "@waypoint/crypto";
import { Hono } from "hono";
import { requireDeviceSignature } from "../auth/signature.ts";
import type { AppEnv, Env } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { activeMembership } from "../groups/membership.ts";
import { idempotent } from "../idempotency.ts";
import { isUniqueViolation } from "../keys/envelopes.ts";
import type { FetchLike } from "../push/apns.ts";
import { verifyTurnstile } from "./turnstile.ts";

export const RATE_LIMIT_RETRY_AFTER = 60;

export function linkKey(linkId: string): string {
  return `links/${linkId}/data`;
}

// The parts of R2 these routes use. R2Bucket satisfies this type.
export type LinkBucket = {
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
};

type LinkRow = { id: string; group_id: string; passcode_hash: string | null; expires_at: number | null; revoked_at: number | null; created_by: string | null };

function pepper(env: Env): Uint8Array {
  try {
    const bytes = fromBase64Url(env.LINK_PASSCODE_PEPPER);
    if (bytes.length === 32) return bytes;
  } catch {
    // fall through
  }
  throw new ApiFailure("internal", "link passcodes unavailable");
}

export function linkRoutes(deps: { now: () => number; fetch: FetchLike }) {
  return new Hono<AppEnv>()
    .post("/v1/links", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiFailure("bad_request", "invalid request");
      });
      const parsed = CreateLinkRequestSchema.safeParse(body);
      if (!parsed.success) throw new ApiFailure("bad_request", "invalid request");
      const req = parsed.data;
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const membership = await activeMembership(db, req.group_id, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      if (membership.role === "viewer") throw new ApiFailure("forbidden", "viewers cannot share");
      if (req.expires_at !== null && req.expires_at <= now) throw new ApiFailure("bad_request", "invalid request");
      let data: Uint8Array;
      try {
        data = fromBase64Url(req.data);
        if (contentKeyVersion(data) !== 0) throw new RangeError("link data has key version 0");
      } catch {
        throw new ApiFailure("bad_request", "invalid request");
      }
      const passcodeHash = req.passcode === null ? null : await linkPasscodeHash(pepper(c.env), req.id, req.passcode);
      try {
        await db
          .prepare(
            "INSERT INTO links (id, group_id, blob_key, passcode_hash, expires_at, revoked_at, views, created_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)",
          )
          .bind(req.id, req.group_id, linkKey(req.id), passcodeHash, req.expires_at, user.id, now)
          .run();
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiFailure("conflict", "link id taken");
        throw error;
      }
      const bucket: LinkBucket = c.env.BUCKET;
      try {
        await bucket.put(linkKey(req.id), data, { httpMetadata: { contentType: "application/octet-stream" } });
      } catch (error) {
        await db.prepare("DELETE FROM links WHERE id = ?").bind(req.id).run();
        throw error;
      }
      return c.json({ id: req.id, group_id: req.group_id, has_passcode: passcodeHash !== null, expires_at: req.expires_at, created_at: now }, 201);
    })
    .delete("/v1/links/:id", requireDeviceSignature(deps), idempotent(deps), async (c) => {
      const db = c.env.DB;
      const now = deps.now();
      const user = c.get("user");
      const link = await db
        .prepare("SELECT id, group_id, passcode_hash, expires_at, revoked_at, created_by FROM links WHERE id = ?")
        .bind(c.req.param("id"))
        .first<LinkRow>();
      if (link === null) throw new ApiFailure("not_found", "no such link");
      const membership = await activeMembership(db, link.group_id, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such link");
      if (link.created_by !== user.id && membership.role !== "owner") throw new ApiFailure("forbidden", "only its maker or an owner can revoke a link");
      const revokedAt = link.revoked_at ?? now;
      await db.prepare("UPDATE links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(revokedAt, link.id).run();
      const bucket: LinkBucket = c.env.BUCKET;
      await bucket.delete(linkKey(link.id));
      return c.json({ id: link.id, revoked_at: revokedAt });
    })
    // Public: the web viewer has no session (requireSession lets this path through).
    .get("/v1/links/:id/data", async (c) => {
      const id = LinkIdSchema.safeParse(c.req.param("id"));
      if (!id.success) throw new ApiFailure("not_found", "no such link");
      const linkId = id.data;
      const views = await c.env.LINK_VIEWS.limit({ key: linkId });
      if (!views.success) throw new ApiFailure("rate_limited", "too many requests", RATE_LIMIT_RETRY_AFTER);
      const db = c.env.DB;
      const now = deps.now();
      const link = await db
        .prepare("SELECT id, group_id, passcode_hash, expires_at, revoked_at, created_by FROM links WHERE id = ?")
        .bind(linkId)
        .first<LinkRow>();
      if (link === null) throw new ApiFailure("not_found", "no such link");
      if (link.revoked_at !== null) throw new ApiFailure("not_found", "link revoked");
      if (link.expires_at !== null && link.expires_at <= now) throw new ApiFailure("not_found", "link expired");
      if (link.passcode_hash !== null) {
        const passcode = c.req.header(LINK_PASSCODE_HEADER) ?? "";
        const token = c.req.header(LINK_TURNSTILE_HEADER) ?? "";
        if (passcode === "" || token === "") throw new ApiFailure("unauthorized", "passcode required");
        const ip = c.req.header("CF-Connecting-IP") ?? null;
        const attempts = await c.env.LINK_PASSCODES.limit({ key: `${linkId}:${ip ?? "unknown"}` });
        if (!attempts.success) throw new ApiFailure("rate_limited", "too many attempts", RATE_LIMIT_RETRY_AFTER);
        if (!(await verifyTurnstile(deps.fetch, c.env.TURNSTILE_SECRET_KEY, token, ip))) throw new ApiFailure("forbidden", "challenge failed");
        const wellFormed = LinkPasscodeSchema.safeParse(passcode);
        const given = wellFormed.success ? await linkPasscodeHash(pepper(c.env), linkId, passcode) : "";
        let same = false;
        try {
          same = bytesEqual(fromBase64Url(given), fromBase64Url(link.passcode_hash));
        } catch {
          same = false;
        }
        if (!same) throw new ApiFailure("unauthorized", "wrong passcode");
      }
      const bucket: LinkBucket = c.env.BUCKET;
      const object = await bucket.get(linkKey(linkId));
      if (object === null) throw new ApiFailure("not_found", "no such link");
      await db.prepare("UPDATE links SET views = views + 1 WHERE id = ?").bind(linkId).run();
      return new Response(object.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(object.size),
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    });
}
