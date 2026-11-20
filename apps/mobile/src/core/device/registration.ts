import type { DeviceView } from "@waypoint/contracts";

// This iPhone's keys for the signed-in person, as the keys module reports them (M26b).
export type LocalKeys = { deviceId: string; signPub: string; boxPub: string };

// What to do after sign-in, from the server's device list and the keys on this iPhone (docs/security.md section 8).
export type Plan =
  | { kind: "approved"; deviceId: string } // registered and approved: it can sign paid requests
  | { kind: "waiting"; deviceId: string } // registered, waiting for another device to approve it
  | { kind: "register_first" } // the account has no account key yet: this iPhone becomes the first device
  | { kind: "register_waiting" } // the account already has a device: register this one as waiting
  | { kind: "start_over" }; // the server does not know our keys (removed, or never sent): forget them, then register as waiting

export function planRegistration(devices: DeviceView[], local: LocalKeys | null): Plan {
  const hasAccount = devices.some((d) => d.kind === "account");
  if (local !== null) {
    const mine = devices.find((d) => d.kind === "device" && d.id === local.deviceId);
    if (mine !== undefined) {
      if (mine.sign_pub !== local.signPub || mine.box_pub !== local.boxPub) return { kind: "start_over" };
      return mine.approved_at === null ? { kind: "waiting", deviceId: mine.id } : { kind: "approved", deviceId: mine.id };
    }
  }
  if (!hasAccount) return { kind: "register_first" };
  return local === null ? { kind: "register_waiting" } : { kind: "start_over" };
}

// The name the server stores: the model, never the person's name (docs/security.md section 16).
export function deviceName(modelName: string | null): string {
  const name = (modelName ?? "").trim();
  return name === "" ? "iPhone" : name.slice(0, 64);
}

export type DeviceStatus = "checking" | "approved" | "waiting" | "too_many_waiting" | "offline" | "failed" | "signed_out";

// Settings keys. The server user id is kept per Clerk user so the app can sign offline.
export const userIdKey = (clerkUserId: string): string => `server_user_id:${clerkUserId}`;
export const statusKey = (userId: string): string => `device_status:${userId}`;
