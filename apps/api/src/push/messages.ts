import { z } from "zod";

export const PUSH_KINDS = ["job_ready", "sync", "device_request", "device_approved"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

// A message on the push queue. ref is an id the app uses to open the right screen (a job id, a group id);
// device_id null means every device of the user. Never note text.
export const PushMessageSchema = z.strictObject({
  user_id: z.string().min(1).max(128),
  kind: z.enum(PUSH_KINDS),
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/).nullable(),
  device_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable(),
});

export type PushMessage = z.infer<typeof PushMessageSchema>;

// The part of the push queue binding producers use. Queue<PushMessage> satisfies this type.
export type PushQueue = { send(message: PushMessage): Promise<unknown> };

// A push only nudges the app, so losing one never fails the request that caused it. A message the consumer would
// drop (an id outside the schema's limits) is not sent.
export async function sendPush(queue: PushQueue, message: PushMessage): Promise<void> {
  if (!PushMessageSchema.safeParse(message).success) return;
  try {
    await queue.send(message);
  } catch {
    // Dropped; the app still sees the change the next time it asks.
  }
}

export type ApnsNotification = {
  pushType: "alert" | "background";
  priority: 10 | 5;
  collapseId: string; // at most 64 bytes
  payload: Record<string, unknown>;
};

// Fixed text per kind. The payload carries only the kind and ref, never anything from a note.
const ALERTS: Readonly<Record<Exclude<PushKind, "sync">, string>> = {
  job_ready: "Your result is ready.",
  device_request: "A new device wants to sign in. Open Waypoint to compare the code.",
  device_approved: "Your new device was approved.",
};

export function notificationFor(message: PushMessage): ApnsNotification {
  const collapseId = `${message.kind}:${message.ref ?? "none"}`;
  if (message.kind === "sync") {
    return {
      pushType: "background",
      priority: 5,
      collapseId,
      payload: { aps: { "content-available": 1 }, kind: message.kind, ref: message.ref },
    };
  }
  return {
    pushType: "alert",
    priority: 10,
    collapseId,
    payload: {
      aps: { alert: { title: "Waypoint", body: ALERTS[message.kind] }, sound: "default" },
      kind: message.kind,
      ref: message.ref,
    },
  };
}
