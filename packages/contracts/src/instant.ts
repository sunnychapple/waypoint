import { z } from "zod";

// Limits on the text an instant task may send. About 54 s of speech is under 1,000 characters,
// so 4,000 leaves room without letting a whole lecture through.
export const WORD_MAX_CHARS = 100;
export const TRANSCRIPT_MAX_CHARS = 4000;

export const ExplainRequestSchema = z.strictObject({
  word: z.string().trim().min(1).max(WORD_MAX_CHARS),
  transcript: z.string().trim().min(1).max(TRANSCRIPT_MAX_CHARS),
});

export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;

// A streamed task answers with server-sent events: any number of "delta" events, then exactly one
// "done" or one "error" event, then the stream ends.
export const StreamDeltaSchema = z.strictObject({ text: z.string().min(1) });

export const StreamDoneSchema = z.strictObject({
  credits: z.number().int().min(0),
  tier: z.enum(["light", "standard", "strong"]),
  retention: z.enum(["standard", "zero"]),
  offer_research: z.boolean(),
});

export type StreamDelta = z.infer<typeof StreamDeltaSchema>;
export type StreamDone = z.infer<typeof StreamDoneSchema>;

// More detail and double-check also send the explanation the app already shows.
export const ANSWER_MAX_CHARS = 4000;

export const FollowUpRequestSchema = ExplainRequestSchema.extend({
  answer: z.string().trim().min(1).max(ANSWER_MAX_CHARS),
});

export type FollowUpRequest = z.infer<typeof FollowUpRequestSchema>;

export const DoubleCheckResponseSchema = z.strictObject({
  text: z.string().min(1),
  credits: z.number().int().min(0),
  tier: z.enum(["light", "standard", "strong"]),
  retention: z.enum(["standard", "zero"]),
});

export type DoubleCheckResponse = z.infer<typeof DoubleCheckResponseSchema>;
