import { z } from "zod";

// The second transcript's audio goes up as the app's recording parts (AAC in .m4a, at most 5 minutes each):
// PUT /v1/jobs/:id/audio/:n for n = 0 .. chunks - 1, then POST /v1/jobs/:id/audio/done.
export const MAX_AUDIO_CHUNKS = 200;
export const MAX_AUDIO_CHUNK_BYTES = 4 * 1024 * 1024;
export const AUDIO_CHUNK_CONTENT_TYPE = "audio/mp4";

export const AudioChunkResponseSchema = z.strictObject({ chunk: z.number().int().min(0), bytes: z.number().int().min(1) });
export const AudioDoneRequestSchema = z.strictObject({ chunks: z.number().int().min(1).max(MAX_AUDIO_CHUNKS) });
export const AudioDoneResponseSchema = z.strictObject({ chunks: z.number().int().min(1), bytes: z.number().int().min(1) });

// The sealed result of a retranscribe job. Times are seconds from the start of that chunk; the app adds each part's
// own start time. duration is null when Whisper did not report it. truncated: chunks after the quoted minutes were skipped.
export const RetranscribeResultSchema = z.strictObject({
  v: z.literal(1),
  truncated: z.boolean(),
  chunks: z.array(
    z.strictObject({
      n: z.number().int().min(0),
      duration: z.number().min(0).nullable(),
      text: z.string(),
      segments: z.array(z.strictObject({ start: z.number().min(0), end: z.number().min(0), text: z.string() })),
    }),
  ),
});

export type AudioChunkResponse = z.infer<typeof AudioChunkResponseSchema>;
export type AudioDoneRequest = z.infer<typeof AudioDoneRequestSchema>;
export type AudioDoneResponse = z.infer<typeof AudioDoneResponseSchema>;
export type RetranscribeResult = z.infer<typeof RetranscribeResultSchema>;
