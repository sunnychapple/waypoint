import { z } from "zod";

export const ConfigResponseSchema = z.strictObject({
  prices: z.strictObject({
    version: z.string().min(1),
    credits: z.record(z.string(), z.number().int().min(1)),
  }),
  routes_version: z.string().min(1),
  flags: z.record(z.string(), z.boolean()),
  min_native: z.strictObject({ ios: z.string().min(1) }),
  voice_pack: z.strictObject({
    version: z.string().min(1),
    url: z.string().url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().min(1),
  }),
});

export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;
