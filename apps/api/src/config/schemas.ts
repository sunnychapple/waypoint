import { z } from "zod";

export const ConfigCurrentSchema = z.strictObject({
  prices: z.string().min(1),
  routes: z.string().min(1),
});

export const RouterConfigSchema = z.strictObject({
  model: z.string().min(1),
  min_confidence: z.number().gt(0).max(1),
});

export const FlagsSchema = z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.boolean());

export const MinNativeSchema = z.strictObject({
  ios: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export const VoicePackSchema = z.strictObject({
  version: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().min(1),
});
