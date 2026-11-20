import type { DeviceView, PairingView } from "@waypoint/contracts";

// Settings keys, per server user id.
export const knownDevicesKey = (userId: string): string => `known_devices:${userId}`;
export const pairingApproverKey = (userId: string): string => `pairing_approver:${userId}`;

// id → sign_pub of devices whose certificate verified under an account key this iPhone held (docs/security.md
// section 6). Only these may hand this iPhone a new account key.
export type Known = Record<string, string>;

export function parseKnown(text: string | null): Known {
  if (text === null) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const out: Known = {};
    for (const [id, pub] of Object.entries(value)) if (typeof pub === "string") out[id] = pub;
    return out;
  } catch {
    return {};
  }
}

// The pairing approver this iPhone compared a code with: { id, signPub }, or null.
export function parseApprover(text: string | null): { id: string; signPub: string } | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const { id, signPub } = value as { id?: unknown; signPub?: unknown };
    return typeof id === "string" && typeof signPub === "string" ? { id, signPub } : null;
  } catch {
    return null;
  }
}

export type CertCheck = (c: { accountSignPub: string; cert: string; deviceId: string; signPub: string; boxPub: string }) => boolean;

// Adds every approved device whose certificate verifies under the account key held now. Never removes one.
export function updateKnown(known: Known, devices: DeviceView[], heldSignPub: string, verify: CertCheck): Known {
  const out: Known = { ...known };
  for (const d of devices) {
    if (d.kind !== "device" || d.approved_at === null || d.cert === null) continue;
    if (verify({ accountSignPub: heldSignPub, cert: d.cert, deviceId: d.id, signPub: d.sign_pub, boxPub: d.box_pub })) out[d.id] = d.sign_pub;
  }
  return out;
}

// What this approved iPhone must do about the account key after reading GET /v1/devices.
export type AccountStep =
  | { kind: "none" } // it holds the current one (or is not approved yet)
  | { kind: "adopt"; account: { id: string; signPub: string; boxPub: string }; envelope: string }
  | { kind: "missing" }; // approved, but no account key it can open: it must be removed and added again

export function accountStep(devices: DeviceView[], myId: string, heldAccountId: string | null): AccountStep {
  const account = devices.find((d) => d.kind === "account");
  const mine = devices.find((d) => d.kind === "device" && d.id === myId);
  if (account === undefined || mine === undefined || mine.approved_at === null || heldAccountId === account.id) return { kind: "none" };
  if (mine.account_envelope === null) return { kind: "missing" };
  return { kind: "adopt", account: { id: account.id, signPub: account.sign_pub, boxPub: account.box_pub }, envelope: mine.account_envelope };
}

// The rows of Settings › Devices: this iPhone first, then approved devices, then waiting ones.
export type DeviceRow = { id: string; name: string; mine: boolean; waiting: boolean; addedAt: number };

export function deviceRows(devices: DeviceView[], myId: string | null): DeviceRow[] {
  return devices
    .filter((d) => d.kind === "device")
    .map((d) => ({ id: d.id, name: d.name, mine: d.id === myId, waiting: d.approved_at === null, addedAt: d.added_at }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || Number(a.waiting) - Number(b.waiting) || a.addedAt - b.addedAt);
}

// DELETE /v1/devices/:id (docs/security.md section 12).
export type RemovalPlan =
  | { kind: "plain" } // a waiting device, or the last approved device removing itself: body {}
  | { kind: "rotate"; remaining: { id: string; signPub: string; boxPub: string }[] }; // a new account key for every device that stays

export function removalPlan(devices: DeviceView[], targetId: string): RemovalPlan | null {
  const target = devices.find((d) => d.kind === "device" && d.id === targetId);
  if (target === undefined) return null;
  if (target.approved_at === null) return { kind: "plain" };
  const remaining = devices
    .filter((d) => d.kind === "device" && d.approved_at !== null && d.id !== targetId)
    .map((d) => ({ id: d.id, signPub: d.sign_pub, boxPub: d.box_pub }));
  return remaining.length === 0 ? { kind: "plain" } : { kind: "rotate", remaining };
}

// Pairing, from the new iPhone's side (docs/security.md section 8). Never reveal before the approver's nonce is in.
export type NewDeviceStep =
  | { kind: "wait_approver" }
  | { kind: "reveal"; approver: { id: string; signPub: string }; approverNonce: string }
  | { kind: "wait_approval" } // revealed: the code shows on both screens
  | { kind: "expired" };

export function newDeviceStep(view: PairingView, now: number): NewDeviceStep {
  if (view.expires_at <= now) return { kind: "expired" };
  if (view.device_nonce !== null) return { kind: "wait_approval" };
  if (view.approver === null || view.approver_nonce === null) return { kind: "wait_approver" };
  return { kind: "reveal", approver: { id: view.approver.id, signPub: view.approver.sign_pub }, approverNonce: view.approver_nonce };
}

// Pairing, from the approving iPhone's side.
export type ApproverStep =
  | { kind: "start" } // nobody has started: send our nonce
  | { kind: "taken" } // another device started it
  | { kind: "wait_reveal" }
  | { kind: "compare"; deviceNonce: string }
  | { kind: "expired" };

export function approverStep(view: PairingView, myId: string, now: number): ApproverStep {
  if (view.expires_at <= now) return { kind: "expired" };
  if (view.approver === null) return { kind: "start" };
  if (view.approver.id !== myId) return { kind: "taken" };
  return view.device_nonce === null ? { kind: "wait_reveal" } : { kind: "compare", deviceNonce: view.device_nonce };
}
