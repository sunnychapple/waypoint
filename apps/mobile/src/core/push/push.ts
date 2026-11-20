import { PushTokenRequestSchema, type PushTokenRequest } from "@waypoint/contracts";

// expo-application's getIosPushNotificationServiceEnvironmentAsync() → the server's environment name. null (the
// Simulator, or no aps-environment) means: do not register.
export function pushEnvironment(env: "development" | "production" | null): "sandbox" | "production" | null {
  return env === "development" ? "sandbox" : env === "production" ? "production" : null;
}

// The body of POST /v1/push-tokens, or null when anything does not fit the contract.
export function pushTokenRequest(deviceId: string, token: string, environment: "sandbox" | "production"): PushTokenRequest | null {
  const parsed = PushTokenRequestSchema.safeParse({ device_id: deviceId, token: token.toLowerCase(), environment });
  return parsed.success ? parsed.data : null;
}

// Kept in settings after a successful POST, so the same token is not sent on every launch.
export function pushSentValue(request: PushTokenRequest): string {
  return `${request.device_id}:${request.environment}:${request.token}`;
}
export const PUSH_SENT_KEY = "push_token_sent";

// What a tapped notification should do. Payloads carry only kind and ref (apps/api/src/push/messages.ts).
export type PushAction = { kind: "refresh_device" } | { kind: "approve_device"; deviceId: string } | { kind: "open_job"; jobId: string } | { kind: "none" };

export function actionForPush(data: Record<string, unknown>): PushAction {
  if (data.kind === "device_approved") return { kind: "refresh_device" };
  if (data.kind === "job_ready" && typeof data.ref === "string") return { kind: "open_job", jobId: data.ref };
  if (data.kind === "device_request" && typeof data.ref === "string") return { kind: "approve_device", deviceId: data.ref };
  // sync is M28.
  return { kind: "none" };
}
