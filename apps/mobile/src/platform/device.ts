import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useAuth } from "@clerk/expo";
import { randomUUID } from "expo-crypto";
import * as Device from "expo-device";
import { router } from "expo-router";
import { ApiCallError, NetworkError, type DeviceSigner } from "@waypoint/api-client";
import { deviceName, planRegistration, statusKey, userIdKey, type DeviceStatus } from "../core/device/registration.ts";
import { getSetting, setSetting } from "../core/db/settings.ts";
import {
  deleteAccountKey,
  deleteDeviceKeys,
  ensureAccountKey,
  ensureDeviceKeys,
  getDeviceKeys,
  signRequest,
  startPairing,
} from "../../modules/waypoint-keys/index.ts";
import { api, setDeviceSigner } from "./api.ts";
import { isUpdateRequired } from "./config.ts";
import { getDb, writeDb } from "./db.ts";

let status: DeviceStatus = "checking";
let userId: string | null = null;
let clerkId: string | null = null;
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: DeviceStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

function signerFor(user: string, deviceId: string): DeviceSigner {
  return {
    id: deviceId,
    sign: (input) => signRequest(user, input.method, input.target, input.deviceId, input.timestamp, input.body),
  };
}

function approve(user: string, deviceId: string): void {
  setDeviceSigner(signerFor(user, deviceId));
  writeDb((db) => setSetting(db, statusKey(user), "approved"));
  setStatus("approved");
}

function wait(user: string): void {
  setDeviceSigner(null);
  writeDb((db) => setSetting(db, statusKey(user), "waiting"));
  setStatus("waiting");
}

// One pass of M27a's flow. Safe to run again at any time; every step can be repeated.
async function register(clerkUserId: string, firstTry = true): Promise<void> {
  const list = await api.devices();
  userId = list.user_id;
  const user = list.user_id;
  writeDb((db) => setSetting(db, userIdKey(clerkUserId), user));
  const plan = planRegistration(list.devices, getDeviceKeys(user));
  if (plan.kind === "approved") return approve(user, plan.deviceId);
  if (plan.kind === "waiting") return wait(user);
  if (plan.kind === "start_over") await deleteDeviceKeys(user);
  const keys = await ensureDeviceKeys(user, randomUUID());
  const registerSigner = signerFor(user, keys.deviceId);
  const base = { id: keys.deviceId, name: deviceName(Device.modelName), platform: "ios" as const, sign_pub: keys.signPub, box_pub: keys.boxPub };
  if (plan.kind === "register_first") {
    const account = await ensureAccountKey(user, randomUUID());
    try {
      await api.registerDevice(
        { ...base, account: { id: account.accountId, sign_pub: account.signPub, box_pub: account.boxPub, cert: account.cert } },
        registerSigner,
      );
      return approve(user, keys.deviceId);
    } catch (error) {
      // Another device became the first one meanwhile: drop our account key and register as waiting.
      if (!(firstTry && error instanceof ApiCallError && error.status === 409)) throw error;
      await deleteAccountKey(user);
      return register(clerkUserId, false);
    }
  }
  const commitment = await startPairing(user);
  await api.registerDevice({ ...base, commitment }, registerSigner);
  wait(user);
}

// Runs the flow unless it is already running. A failure leaves an approved or waiting status in place; while
// still checking it shows offline (no reply) or failed (any other error), so the screen never stays on "Setting up".
function refreshDevice(clerkUserId: string): Promise<void> {
  if (running !== null) return running;
  running = register(clerkUserId)
    .catch((error: unknown) => {
      // A settled iPhone keeps its status; any other failure replaces the last one shown.
      if (status === "approved" || status === "waiting") return;
      if (error instanceof ApiCallError && error.status === 429) setStatus("too_many_waiting");
      else if (error instanceof NetworkError) setStatus("offline");
      else setStatus("failed");
    })
    .finally(() => {
      running = null;
    });
  return running;
}

// Checks again now, for the signed-in person (the waiting screen's "Check again", the "approved" push in M20).
export function refreshDeviceNow(): Promise<void> {
  return clerkId === null ? Promise.resolve() : refreshDevice(clerkId);
}

// Before the network answers: if this iPhone was approved last time, sign with its keys straight away.
function restore(clerkUserId: string): void {
  const db = getDb();
  const user = getSetting(db, userIdKey(clerkUserId));
  if (user === null) return;
  userId = user;
  const keys = getDeviceKeys(user);
  if (keys !== null && getSetting(db, statusKey(user)) === "approved") {
    setDeviceSigner(signerFor(user, keys.deviceId));
    setStatus("approved");
  }
}

// Called once in (tabs)/_layout.tsx.
export function useDeviceRegistration(): void {
  const { isSignedIn, userId: clerkUserId } = useAuth();
  useEffect(() => {
    if (isSignedIn !== true || clerkUserId === null || clerkUserId === undefined) {
      setDeviceSigner(null);
      userId = null;
      clerkId = null;
      setStatus("signed_out");
      return;
    }
    clerkId = clerkUserId;
    setStatus("checking");
    restore(clerkUserId);
    void refreshDevice(clerkUserId);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && status !== "approved") void refreshDevice(clerkUserId);
    });
    return () => sub.remove();
  }, [isSignedIn, clerkUserId]);
}

export function useDeviceStatus(): DeviceStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => status,
  );
}

// The server's id for the signed-in person (StoreKit's appAccountToken, M14), once known.
export function currentUserId(): string | null {
  return userId;
}

// Every paid action calls this first. false: it opened the screen that explains why, and the action must stop.
export function requireApprovedDevice(): boolean {
  if (isUpdateRequired()) {
    router.push("/update");
    return false;
  }
  if (status === "approved") return true;
  router.push("/device-waiting");
  return false;
}
