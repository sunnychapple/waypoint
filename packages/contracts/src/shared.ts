import { z } from "zod";

// What a shared link unlocks to (V1, M30): one session, as text. Locked with the link key and
// context("link", link id), key version 0 (docs/security.md section 11). No audio, no images in version 1.
export const SHARED_TEXT_MAX_CHARS = 400_000;

export const SharedItemSchema = z.strictObject({
  v: z.literal(1),
  kind: z.literal("session"),
  title: z.string().min(1).max(200),
  created_at: z.number().int().min(0),
  transcript: z.array(z.strictObject({ t: z.number().int().min(0), text: z.string().max(10_000) })).max(20_000),
  pages: z.array(z.strictObject({ text: z.string().max(50_000) })).max(200),
});
export type SharedItem = z.infer<typeof SharedItemSchema>;
