import { z } from "zod";
import { KeyIdSchema } from "./keys.ts";

// PR 28: sync. Locked bytes are base64url; 44 to 1,398,102 characters is 33 bytes (the smallest locked content:
// 17-byte header and 16-byte tag) to 1,048,576 bytes (the room's limit; bigger content goes to a blob).
export const LockedBytesSchema = z.string().regex(/^[A-Za-z0-9_-]{44,1398102}$/);
export const ChangeKindSchema = z.string().regex(/^[a-z_]{1,32}$/);
export const BlobKeySchema = z.string().regex(/^groups\/[A-Za-z0-9_-]{16,48}\/media\/[A-Za-z0-9_-]{16,64}$/);

export const PostChangeRequestSchema = z.strictObject({
  device_id: KeyIdSchema,
  key_version: z.number().int().min(1),
  kind: ChangeKindSchema,
  locked_bytes: LockedBytesSchema,
  blob_key: BlobKeySchema.nullable(),
});
export const PostChangeResponseSchema = z.strictObject({ seq: z.number().int().min(1) });

export const ChangeViewSchema = z.strictObject({
  seq: z.number().int().min(1),
  device_id: z.string(),
  key_version: z.number().int().min(1),
  kind: z.string(),
  locked_bytes: z.string(),
  blob_key: z.string().nullable(),
  at: z.number().int(),
});
export type ChangeView = z.infer<typeof ChangeViewSchema>;

export const ChangesPageSchema = z.strictObject({
  key_version: z.number().int().min(1),
  last_seq: z.number().int().min(0),
  changes: z.array(ChangeViewSchema),
});

// The socket only says that something changed; the app then calls GET /v1/groups/:id/changes?after=.
export const SyncServerMessageSchema = z.strictObject({ type: z.literal("changed"), last_seq: z.number().int().min(0) });
export const SyncAckMessageSchema = z.strictObject({ type: z.literal("ack"), seq: z.number().int().min(0) });

// Open question 55: each person may send this many bytes of locked changes and shared-link data per UTC day. Over it,
// POST /v1/groups/:id/changes and POST /v1/links answer 429 rate_limited with this message and retry_after = the
// seconds until 00:00 UTC.
export const SYNC_DAILY_BYTES = 200_000_000;
export const SYNC_DAILY_LIMIT_MESSAGE = "daily sync limit reached";

// POST /v1/sync/extra (open question 55): SYNC_EXTRA_CREDITS buys SYNC_EXTRA_BYTES more for the rest of the UTC day.
// The price is not confirmed yet (open question 57). The request names the price the app showed; another price gets
// 409 "price changed" and nothing is charged. extra_bytes in the reply is all the extra bought for today.
export const SYNC_EXTRA_BYTES = 1_000_000_000;
export const SYNC_EXTRA_CREDITS = 100;
export const SyncExtraRequestSchema = z.strictObject({ credits: z.number().int().min(1) });
export const SyncExtraResponseSchema = z.strictObject({ credits: z.number().int().min(1), extra_bytes: z.number().int().min(1) });
export type SyncExtraResponse = z.infer<typeof SyncExtraResponseSchema>;
