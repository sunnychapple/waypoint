import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useAuth } from "@clerk/expo";
import { randomUUID } from "expo-crypto";
import * as Device from "expo-device";
import { router } from "expo-router";
import { ApiCallError, NetworkError, type DeviceSigner } from "@waypoint/api-client";
import type { DeviceView } from "@waypoint/contracts";
import { accountStep, knownDevicesKey, newDeviceStep, pairingApproverKey, parseApprover, parseKnown, updateKnown } from "../core/device/devices.ts";
import { accountKeyLost, deviceName, planRegistration, statusKey, userIdKey, type DeviceStatus } from "../core/device/registration.ts";
import { deleteSetting, getSetting, setSetting } from "../core/db/settings.ts";
import {
  adoptAccountKey,
  deleteAccountKey,
  deleteDeviceKeys,
  ensureAccountKey,
  ensureDeviceKeys,
  getAccountKey,
  getDeviceKeys,
  revealPairing,
  signRequest,
  startPairing,
  verifyCertificate,
} from "../../modules/waypoint-keys/index.ts";
import { api, setDeviceSigner } from "./api.ts";
import { isUpdateRequired } from "./config.ts";
import { dbUser, getDb, onNotesClosed, writeDb } from "./db.ts";

let status: DeviceStatus = "checking";
let userId: string | null = null;
let clerkId: string | null = null;
let running: { clerkId: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

// The notes of the person these belong to were closed (sign-out, or another person's notes opening): nothing carries over.
onNotesClosed(() => {
  setDeviceSigner(null);
  userId = null;
  clerkId = null;
  running = null;
  accountKeyProblem = false;
  setStatus("signed_out");
});

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

// True when this approved iPhone could not open its account key (M27b-C): Settings › Devices says so.
let accountKeyProblem = false;
export const hasAccountKeyProblem = (): boolean => accountKeyProblem;

// The person this iPhone was last approved for, kept for a silent push that wakes the app with no screen (sync.ts).
export const LAST_USER_KEY = "last_approved_user";

function approve(user: string, deviceId: string): void {
  setDeviceSigner(signerFor(user, deviceId));
  writeDb((db) => {
    setSetting(db, statusKey(user), "approved");
    setSetting(db, LAST_USER_KEY, user);
  });
  setStatus("approved");
}

// Headless (no screen, no React hooks): the approved person and their device signer from the stored identity. null
// when nothing is known, or this iPhone is not approved for that person; the caller then does nothing.
export function restoreApprovedUser(): string | null {
  if (userId !== null) return userId;
  const db = getDb();
  const user = getSetting(db, LAST_USER_KEY);
  if (user === null || getSetting(db, statusKey(user)) !== "approved") return null;
  const keys = getDeviceKeys(user);
  if (keys === null) return null;
  userId = user;
  setDeviceSigner(signerFor(user, keys.deviceId));
  return user;
}

function wait(user: string): void {
  setDeviceSigner(null);
  writeDb((db) => setSetting(db, statusKey(user), "waiting"));
  setStatus("waiting");
}

// Takes a replaced account key, and grows the list of devices this iPhone vouches for (docs/security.md section 6).
async function syncAccountKey(user: string, devices: DeviceView[], myId: string): Promise<void> {
  const db = getDb();
  const keys = getDeviceKeys(user);
  const known = parseKnown(getSetting(db, knownDevicesKey(user)));
  const step = accountStep(devices, myId, getAccountKey(user)?.accountId ?? null);
  accountKeyProblem = step.kind === "missing";
  if (step.kind === "adopt") {
    const approver = parseApprover(getSetting(db, pairingApproverKey(user)));
    const trusted = { ...known };
    if (approver !== null) trusted[approver.id] = approver.signPub;
    if (keys !== null) trusted[keys.deviceId] = keys.signPub; // a removal this iPhone made, whose reply was lost
    try {
      await adoptAccountKey(user, step.account, step.envelope, trusted);
      writeDb((d) => deleteSetting(d, pairingApproverKey(user)));
    } catch {
      accountKeyProblem = true;
    }
  }
  const held = getAccountKey(user);
  if (held === null) return;
  const next = updateKnown(known, devices, held.signPub, (c) => verifyCertificate({ ...c, userId: user }));
  writeDb((d) => setSetting(d, knownDevicesKey(user), JSON.stringify(next)));
}

// One pass of M27a's flow. Safe to run again at any time; every step can be repeated.
async function register(clerkUserId: string, firstTry = true): Promise<void> {
  const list = await api.devices();
  if (clerkId !== clerkUserId) return; // signed out or switched person while the reply was on its way
  userId = list.user_id;
  const user = list.user_id;
  writeDb((db) => setSetting(db, userIdKey(clerkUserId), user));
  const plan = planRegistration(list.devices, getDeviceKeys(user));
  if (plan.kind === "approved") {
    if (clerkId !== clerkUserId) return;
    approve(user, plan.deviceId);
    await syncAccountKey(user, list.devices, plan.deviceId);
    return;
  }
  if (plan.kind === "waiting") {
    if (clerkId !== clerkUserId) return;
    return wait(user);
  }
  if (plan.kind === "start_over") await deleteDeviceKeys(user);
  if (clerkId !== clerkUserId) return;
  const keys = await ensureDeviceKeys(user, randomUUID());
  const registerSigner = signerFor(user, keys.deviceId);
  const base = { id: keys.deviceId, name: deviceName(Device.modelName), platform: "ios" as const, sign_pub: keys.signPub, box_pub: keys.boxPub };
  if (plan.kind === "register_first") {
    const account = await ensureAccountKey(user, randomUUID());
    if (clerkId !== clerkUserId) return;
    try {
      await api.registerDevice(
        { ...base, account: { id: account.accountId, sign_pub: account.signPub, box_pub: account.boxPub, cert: account.cert, self_cert: account.selfCert } },
        registerSigner,
      );
      if (clerkId !== clerkUserId) return;
      return approve(user, keys.deviceId);
    } catch (error) {
      if (!(firstTry && error instanceof ApiCallError && error.status === 409)) throw error;
      // Another device became the first one meanwhile: drop our account key and register as waiting. Any other 409
      // (our own registration still in progress, or already done) keeps it: the account key exists nowhere else.
      if (accountKeyLost((await api.devices()).devices, account.signPub)) await deleteAccountKey(user);
      return register(clerkUserId, false);
    }
  }
  const commitment = await startPairing(user);
  if (clerkId !== clerkUserId) return;
  await api.registerDevice({ ...base, commitment }, registerSigner);
  if (clerkId !== clerkUserId) return;
  wait(user);
}

// Runs the flow unless it is already running. A failure leaves an approved or waiting status in place; while
// still checking it shows offline (no reply) or failed (any other error), so the screen never stays on "Setting up".
function refreshDevice(clerkUserId: string): Promise<void> {
  if (running !== null && running.clerkId === clerkUserId) return running.promise;
  const promise: Promise<void> = register(clerkUserId)
    .catch((error: unknown) => {
      if (clerkId !== clerkUserId) return; // signed out or switched person meanwhile: show nothing
      // A settled iPhone keeps its status; any other failure replaces the last one shown.
      if (status === "approved" || status === "waiting") return;
      if (error instanceof ApiCallError && error.status === 429) setStatus("too_many_waiting");
      else if (error instanceof NetworkError) setStatus("offline");
      else setStatus("failed");
    })
    .finally(() => {
      if (running?.promise === promise) running = null;
    });
  running = { clerkId: clerkUserId, promise };
  return promise;
}

// Checks again now, for the signed-in person (the waiting screen's "Check again", the "approved" push in M20).
export function refreshDeviceNow(): Promise<void> {
  return clerkId === null ? Promise.resolve() : refreshDevice(clerkId);
}

// Before the network answers: if this iPhone was approved last time, sign with its keys straight away.
function restore(clerkUserId: string): void {
  const db = getDb();
  const user = getSetting(db, userIdKey(clerkUserId));
  if (user === null) {
    userId = null; // nothing stored for this person: not the last person's id
    setDeviceSigner(null);
    return;
  }
  userId = user;
  const keys = getDeviceKeys(user);
  if (keys !== null && getSetting(db, statusKey(user)) === "approved") {
    setDeviceSigner(signerFor(user, keys.deviceId));
    writeDb((w) => setSetting(w, LAST_USER_KEY, user)); // approved before this key existed
    setStatus("approved");
  }
}

// Called once in (tabs)/_layout.tsx.
export function useDeviceRegistration(): void {
  const { isLoaded, isSignedIn, userId: clerkUserId } = useAuth();
  useEffect(() => {
    accountKeyProblem = false; // a sign-out or a switch to another person: nothing carries over
    if (isSignedIn !== true || clerkUserId === null || clerkUserId === undefined) {
      setDeviceSigner(null);
      // A headless push does not sync a signed-out person, including one whose session ended while the app was closed.
      // Not while Clerk is still loading (isSignedIn undefined).
      // Only while that person's notes are still open (open question 52: sign-out closes them).
      if (dbUser() !== null && (userId !== null || (isLoaded && isSignedIn === false))) writeDb((db) => deleteSetting(db, LAST_USER_KEY));
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
  }, [isLoaded, isSignedIn, clerkUserId]);
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

export type PairingState = { kind: "none" } | { kind: "wait_approver" } | { kind: "code"; code: string } | { kind: "expired" };

// While the waiting screen is open: polls the pairing every 3 s, reveals once the approver's nonce is in, and shows
// the code (docs/security.md section 8).
export function usePairing(): PairingState {
  const current = useDeviceStatus();
  // The id of the device being approved: a new one after "Start again" restarts the polling.
  const deviceId = current === "waiting" && userId !== null ? (getDeviceKeys(userId)?.deviceId ?? null) : null;
  const [state, setState] = useState<PairingState>({ kind: "none" });
  useEffect(() => {
    setState({ kind: "none" });
    const user = userId;
    const keys = user === null ? null : getDeviceKeys(user);
    if (current !== "waiting" || user === null || keys === null) return;
    let stopped = false;
    const tick = async (): Promise<void> => {
      try {
        const view = await api.pairing(keys.deviceId);
        const step = newDeviceStep(view, Date.now() + api.clockOffset());
        if (stopped) return;
        if (step.kind === "expired" || step.kind === "wait_approver") return setState({ kind: step.kind });
        const approver = view.approver;
        if (approver === null || view.approver_nonce === null) return;
        writeDb((db) => setSetting(db, pairingApproverKey(user), JSON.stringify({ id: approver.id, signPub: approver.sign_pub })));
        const revealed = await revealPairing(user, approver.sign_pub, view.approver_nonce);
        if (step.kind === "reveal") await api.revealPairing(keys.deviceId, revealed.nonce, signerFor(user, keys.deviceId));
        if (!stopped) setState({ kind: "code", code: revealed.code });
      } catch (error) {
        // The pairing is gone (approved, or ended by a wrong reveal): check; still waiting means start again.
        if (error instanceof ApiCallError && (error.status === 404 || error.status === 409)) {
          await refreshDeviceNow();
          if (!stopped && status === "waiting") setState({ kind: "expired" });
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 3_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [current, deviceId]);
  return state;
}

// An expired or failed pairing: forget this iPhone's keys and register again with a new id and commitment.
export async function startPairingAgain(): Promise<void> {
  const user = userId;
  if (user === null) return;
  await deleteDeviceKeys(user);
  writeDb((db) => deleteSetting(db, pairingApproverKey(user)));
  await refreshDeviceNow();
}
