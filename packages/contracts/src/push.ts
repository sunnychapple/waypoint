import { z } from "zod";

// The device's id (devices.id, registered with POST /v1/devices), the APNs device token as lowercase hex, and which APNs server issued it
// (sandbox for development and TestFlight-from-Xcode builds, production for App Store and TestFlight builds).
export const PushTokenRequestSchema = z.strictObject({
  device_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  token: z.string().regex(/^[0-9a-f]{64,200}$/),
  environment: z.enum(["sandbox", "production"]),
});

export const PushTokenResponseSchema = z.strictObject({ device_id: z.string().min(1) });

export type PushTokenRequest = z.infer<typeof PushTokenRequestSchema>;
export type PushTokenResponse = z.infer<typeof PushTokenResponseSchema>;
