import { useEffect } from "react";
import { getIosPushNotificationServiceEnvironmentAsync } from "expo-application";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { PUSH_SENT_KEY, actionForPush, pushEnvironment, pushSentValue, pushTokenRequest } from "../core/push/push.ts";
import { getSetting, setSetting } from "../core/db/settings.ts";
import { getDeviceKeys } from "../../modules/waypoint-keys/index.ts";
import { api } from "./api.ts";
import { dbGeneration, getDb, writeDbIf } from "./db.ts";
import { currentUserId, refreshDeviceNow, useDeviceStatus } from "./device.ts";
import { followJob } from "./jobs.ts";
import { syncNow } from "./sync.ts";

// Alerts show as banners while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Sends this iPhone's APNs token for its devices.id when notifications are allowed. Never asks; never throws.
export async function registerPushToken(): Promise<void> {
  try {
    const userId = currentUserId();
    const generation = dbGeneration();
    const keys = userId === null ? null : getDeviceKeys(userId);
    if (keys === null) return;
    if ((await Notifications.getPermissionsAsync()).status !== "granted") return;
    const environment = pushEnvironment(await getIosPushNotificationServiceEnvironmentAsync());
    if (environment === null) return;
    const token = await Notifications.getDevicePushTokenAsync();
    const request = pushTokenRequest(keys.deviceId, String(token.data), environment);
    if (request === null || getSetting(getDb(), PUSH_SENT_KEY) === pushSentValue(request)) return;
    await api.pushToken(request);
    writeDbIf(generation, (db) => setSetting(db, PUSH_SENT_KEY, pushSentValue(request)));
  } catch {
    // Tried again on the next launch.
  }
}

// Asks once (iOS shows its prompt only the first time), then registers. Returns whether notifications are allowed.
export async function askForPush(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  if (status === "granted") await registerPushToken();
  return status === "granted";
}

// APNs payloads carry kind and ref at the top level (apps/api/src/push/messages.ts); expo-notifications puts only a
// "body" key into content.data for remote notifications, so read the raw payload from the push trigger.
function pushData(response: Notifications.NotificationResponse): Record<string, unknown> {
  const { trigger, content } = response.notification.request;
  if (trigger !== null && typeof trigger === "object" && "type" in trigger && trigger.type === "push") return trigger.payload ?? {};
  return content.data ?? {};
}

function handle(response: Notifications.NotificationResponse | null): void {
  if (response === null) return;
  const action = actionForPush(pushData(response));
  if (action.kind === "refresh_device") void refreshDeviceNow();
  if (action.kind === "approve_device") router.push(`/devices/approve?id=${encodeURIComponent(action.deviceId)}`);
  if (action.kind === "open_job") {
    void followJob(action.jobId);
    router.push(`/job/${encodeURIComponent(action.jobId)}`);
  }
  if (action.kind === "sync") void syncNow(action.groupId);
}

// Called once in (tabs)/_layout.tsx: registers the token once this iPhone has a device row, and handles taps.
export function usePush(): void {
  const status = useDeviceStatus();
  useEffect(() => {
    if (status === "approved" || status === "waiting") void registerPushToken();
  }, [status]);
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then(handle, () => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, []);
}
