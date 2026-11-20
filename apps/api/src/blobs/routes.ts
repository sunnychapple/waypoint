import { BlobIdSchema, GroupIdSchema } from "@waypoint/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { activeMembership } from "../groups/membership.ts";

// Under the 100 MB request body limit of a Free or Pro zone, with room to spare.
export const MAX_BLOB_BYTES = 95_000_000;
// The smallest locked content: 17-byte header and 16-byte tag.
export const MIN_BLOB_BYTES = 33;
export const BYTES_PER_GB = 1024 * 1024 * 1024;
export const DEFAULT_MEDIA_CAP_GB = 3;

export function blobKey(groupId: string, blobId: string): string {
  return `groups/${groupId}/media/${blobId}`;
}

// The parts of R2 these routes use. R2Bucket satisfies this type.
export type BlobBucket = {
  put(key: string, value: ReadableStream, options: { httpMetadata: { contentType: string } }): Promise<{ size: number }>;
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
};

type BlobRow = { group_id: string; user_id: string | null; bytes: number; created_at: number; stored_at: number | null };

export function blobRoutes(deps: { now: () => number }) {
  return new Hono<AppEnv>()
    .post("/v1/blobs", async (c) => {
      const groupParsed = GroupIdSchema.safeParse(c.req.query("group"));
      const idParsed = BlobIdSchema.safeParse(c.req.query("id"));
      const lengthText = c.req.header("Content-Length") ?? "";
      const body = c.req.raw.body;
      if (!groupParsed.success || !idParsed.success || !/^\d{1,10}$/.test(lengthText) || body === null) {
        throw new ApiFailure("bad_request", "invalid request");
      }
      const groupId = groupParsed.data;
      const blobId = idParsed.data;
      const bytes = Number(lengthText);
      if (bytes < MIN_BLOB_BYTES || bytes > MAX_BLOB_BYTES) throw new ApiFailure("bad_request", "file too large or too small");
      const user = c.get("user");
      if (user.plan === "free") throw new ApiFailure("plan_required", "media sync needs a paid plan");
      const db = c.env.DB;
      const now = deps.now();
      const membership = await activeMembership(db, groupId, user.id, now);
      if (membership === null) throw new ApiFailure("not_found", "no such group");
      if (membership.role === "viewer") throw new ApiFailure("forbidden", "viewers cannot write");

      const existing = await db.prepare("SELECT group_id, user_id, bytes, created_at, stored_at FROM blobs WHERE id = ?").bind(blobId).first<BlobRow>();
      if (existing !== null) {
        // The same upload again (a retry): same group, uploader and size. Anything else is another file.
        if (existing.group_id !== groupId || existing.user_id !== user.id || existing.bytes !== bytes) throw new ApiFailure("conflict", "blob id taken");
        if (existing.stored_at !== null) return c.json({ id: blobId, group_id: groupId, bytes });
      } else {
        const cap = await db
          .prepare("SELECT COALESCE(MAX(media_cap_gb), ?) AS gb FROM entitlements WHERE user_id = ? AND ended_at IS NULL")
          .bind(DEFAULT_MEDIA_CAP_GB, user.id)
          .first<{ gb: number }>();
        const capBytes = (cap?.gb ?? DEFAULT_MEDIA_CAP_GB) * BYTES_PER_GB;
        // Reserve the size first, in one statement, so two uploads at once cannot both pass the cap.
        const reserved = await db
          .prepare(
            `INSERT INTO blobs (id, group_id, user_id, bytes, created_at, stored_at)
             SELECT ?, ?, ?, ?, ?, NULL
             WHERE (SELECT COALESCE(SUM(bytes), 0) FROM blobs WHERE user_id = ?) + ? <= ?
             ON CONFLICT (id) DO NOTHING`,
          )
          .bind(blobId, groupId, user.id, bytes, now, user.id, bytes, capBytes)
          .run();
        if (reserved.meta.changes !== 1) {
          const taken = await db.prepare("SELECT id FROM blobs WHERE id = ?").bind(blobId).first<{ id: string }>();
          if (taken !== null) throw new ApiFailure("conflict", "blob id taken");
          throw new ApiFailure("conflict", "media storage is full");
        }
      }

      const bucket: BlobBucket = c.env.BUCKET;
      const key = blobKey(groupId, blobId);
      let stored: { size: number };
      try {
        stored = await bucket.put(key, body, { httpMetadata: { contentType: "application/octet-stream" } });
      } catch (error) {
        await db.prepare("DELETE FROM blobs WHERE id = ? AND stored_at IS NULL").bind(blobId).run();
        throw error;
      }
      if (stored.size !== bytes) {
        await bucket.delete(key);
        await db.prepare("DELETE FROM blobs WHERE id = ? AND stored_at IS NULL").bind(blobId).run();
        throw new ApiFailure("bad_request", "upload incomplete");
      }
      await db.prepare("UPDATE blobs SET stored_at = ? WHERE id = ?").bind(now, blobId).run();
      return c.json({ id: blobId, group_id: groupId, bytes }, 201);
    })
    .get("/v1/blobs/:id", async (c) => {
      const blobId = c.req.param("id");
      const db = c.env.DB;
      const row = await db
        .prepare("SELECT group_id, user_id, bytes, created_at, stored_at FROM blobs WHERE id = ? AND stored_at IS NOT NULL")
        .bind(blobId)
        .first<BlobRow>();
      if (row === null) throw new ApiFailure("not_found", "no such file");
      const membership = await activeMembership(db, row.group_id, c.get("user").id, deps.now());
      if (membership === null || row.created_at < membership.history_from) throw new ApiFailure("not_found", "no such file");
      const bucket: BlobBucket = c.env.BUCKET;
      const object = await bucket.get(blobKey(row.group_id, blobId));
      if (object === null) throw new ApiFailure("not_found", "no such file");
      return new Response(object.body, {
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(object.size), "Cache-Control": "private, no-store" },
      });
    });
}
