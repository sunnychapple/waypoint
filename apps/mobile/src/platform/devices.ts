import { ApiCallError } from "@waypoint/api-client";
import type { DeviceView } from "@waypoint/contracts";
import { randomUUID } from "expo-crypto";
import {
  certifyDevice,
  deleteDeviceKeys,
  finishAccountRotation,
  getDeviceKeys,
  newPairingNonce,
  pairingCode,
  rotateAccountKey,
} from "../../modules/waypoint-keys/index.ts";
import { approverStep, removalPlan } from "../core/device/devices.ts";
import { api } from "./api.ts";
import { currentUserId, refreshDeviceNow } from "./device.ts";
import { ensureAllKeysNow, envelopesForDevice, refreshGroups, rewrapForNewAccount } from "./groups.ts";

// This iPhone's nonce for each pairing it started, this launch only, keyed by user id and device id.
const approverNonces = new Map<string, string>();
const slot = (user: string, deviceId: string): string => `${user}:${deviceId}`;

export async function listDevices(): Promise<{ userId: string; devices: DeviceView[] }> {
  const list = await api.devices();
  return { userId: list.user_id, devices: list.devices };
}

export type ApprovalView =
  | { kind: "waiting_reveal" }
  | { kind: "code"; code: string }
  | { kind: "mismatch" } // the new device's nonce does not match its commitment: never approve
  | { kind: "taken" }
  | { kind: "expired" }
  | { kind: "lost" } // this iPhone started the pairing but no longer has its nonce (the app restarted)
  | { kind: "gone" }; // approved or removed meanwhile

// One step of approving a waiting device: start it, or work out the code once the new device revealed.
export async function pollApproval(deviceId: string): Promise<ApprovalView> {
  const user = currentUserId();
  const me = user === null ? null : getDeviceKeys(user);
  if (user === null || me === null) return { kind: "gone" };
  let view;
  try {
    view = await api.pairing(deviceId);
  } catch (error) {
    if (error instanceof ApiCallError && error.status === 404) return { kind: "gone" };
    throw error;
  }
  const step = approverStep(view, me.deviceId, Date.now() + api.clockOffset());
  const key = slot(user, deviceId);
  if (step.kind === "start") {
    const nonce = newPairingNonce();
    approverNonces.set(key, nonce);
    try {
      await api.sendPairingNonce(deviceId, nonce);
    } catch (error) {
      if (error instanceof ApiCallError && error.status === 409) return { kind: "taken" };
      throw error;
    }
    return { kind: "waiting_reveal" };
  }
  if (step.kind === "taken" || step.kind === "expired") return { kind: step.kind };
  const nonce = approverNonces.get(key);
  if (nonce === undefined) return { kind: "lost" };
  if (step.kind === "wait_reveal") return { kind: "waiting_reveal" };
  const target = (await api.devices()).devices.find((d) => d.kind === "device" && d.id === deviceId);
  if (target === undefined || target.approved_at !== null) return { kind: "gone" };
  try {
    const code = pairingCode({
      newSignPub: target.sign_pub,
      newBoxPub: target.box_pub,
      commitment: view.commitment,
      approverSignPub: me.signPub,
      approverNonce: nonce,
      newNonce: step.deviceNonce,
    });
    return { kind: "code", code };
  } catch {
    return { kind: "mismatch" };
  }
}

// "They match": certify the new device, give it the account key and the group keys it may hold.
export async function approveWaiting(deviceId: string): Promise<void> {
  const user = currentUserId();
  if (user === null) throw new Error("signed out");
  const target = (await api.devices()).devices.find((d) => d.kind === "device" && d.id === deviceId);
  if (target === undefined) throw new Error("no such device");
  const made = await certifyDevice(user, { id: target.id, signPub: target.sign_pub, boxPub: target.box_pub }, false);
  const send = async (): Promise<void> => {
    const envelopes = await envelopesForDevice(user, {
      id: target.id,
      userId: user,
      kind: "device",
      signPub: target.sign_pub,
      boxPub: target.box_pub,
      cert: made.cert,
    });
    await api.approveDevice(deviceId, { cert: made.cert, account_envelope: made.accountEnvelope, envelopes });
  };
  // A group this iPhone still lists but the server has left (or whose key version moved) makes the server refuse
  // the whole set (409): refresh the local groups, then try once more.
  await refreshGroups();
  try {
    await send();
  } catch (error) {
    if (!(error instanceof ApiCallError && error.status === 409)) throw error;
    await refreshGroups();
    await send();
  }
  approverNonces.delete(slot(user, deviceId));
}

export type RemoveResult = "removed" | "removed_self" | "changed";

// Removes a device (docs/security.md section 12). "changed": the list changed meanwhile; reload and ask again.
export async function removeDevice(targetId: string): Promise<RemoveResult> {
  const user = currentUserId();
  const me = user === null ? null : getDeviceKeys(user);
  if (user === null || me === null) throw new Error("signed out");
  const plan = removalPlan((await api.devices()).devices, targetId);
  if (plan === null) return "removed";
  if (plan.kind === "plain") {
    await api.removeDevice(targetId, {});
  } else {
    const accountId = randomUUID();
    const rotated = await rotateAccountKey(user, accountId, plan.remaining);
    try {
      await api.removeDevice(targetId, {
        account: { id: rotated.account.id, sign_pub: rotated.account.signPub, box_pub: rotated.account.boxPub, self_cert: rotated.account.selfCert },
        devices: rotated.devices.map((d) => ({ id: d.id, cert: d.cert, account_envelope: d.accountEnvelope })),
      });
    } catch (error) {
      if (error instanceof ApiCallError) {
        await finishAccountRotation(user, accountId, false);
        if (error.status === 409) return "changed"; // the list changed (in this request, or the server's own read)
      }
      // A lost reply keeps the pending key; the next refresh adopts our own envelope if the removal went through.
      throw error;
    }
    await finishAccountRotation(user, accountId, true);
    // Removing this iPhone itself: the server has just refused its signature, so the other devices wrap for the new
    // account row instead. Removing another device: the removal went through, so a failed re-wrap is not a failure;
    // the next first set makes the envelopes.
    if (targetId !== me.deviceId) {
      try {
        await rewrapForNewAccount(user, rotated.account);
      } catch {
        // Repaired by the next key set (docs/security.md section 10).
      }
    }
  }
  if (targetId === me.deviceId) {
    await deleteDeviceKeys(user);
    return "removed_self";
  }
  await refreshDeviceNow();
  await ensureAllKeysNow(); // members can write with the new key version at once, not after the random wait
  return "removed";
}
