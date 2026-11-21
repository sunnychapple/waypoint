import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { router } from "expo-router";
import { ApiCallError, NetworkError } from "@waypoint/api-client";
import {
  certifyDevice,
  getAccountKey,
  getDeviceKeys,
  makeRecoveryKey,
  recoverAccountKey,
  signRequestAsAccount,
  type MadeRecoveryKey,
} from "../../modules/waypoint-keys/index.ts";
import { cleanPhrase, recoveryState, type RecoveryState } from "../core/device/recovery.ts";
import {
  finishedSessionCount,
  markRecoveryPromptShown,
  recoveryPromptShownAt,
  shouldPromptRecovery,
} from "../core/device/recoveryPrompt.ts";
import { api } from "./api.ts";
import { dbGeneration, useQuery, writeDbIf } from "./db.ts";
import { currentUserId, refreshDeviceNow, useDeviceStatus } from "./device.ts";
import { recoverGroupKeys } from "./groups.ts";

const notFound = (error: unknown): boolean => error instanceof ApiCallError && error.status === 404;

export async function loadRecoveryState(): Promise<RecoveryState> {
  try {
    return recoveryState(await api.recovery(), false);
  } catch (error) {
    return recoveryState(null, !notFound(error));
  }
}

// True when this iPhone can make a recovery key: it is signed in and holds the account key.
export function canMakeRecoveryKey(): boolean {
  const user = currentUserId();
  return user !== null && getAccountKey(user) !== null;
}

export async function newRecoveryKey(): Promise<MadeRecoveryKey> {
  const user = currentUserId();
  if (user === null) throw new Error("signed out");
  return makeRecoveryKey(user);
}

// Stores the blob once the person typed 3 words back. "changed": the account key was replaced meanwhile (another
// device removed one): make new words.
export async function saveRecoveryKey(made: MadeRecoveryKey): Promise<"saved" | "changed" | "offline" | "failed"> {
  try {
    await api.putRecovery({ account_device_id: made.accountId, wrapped_account_key: made.blob, verified: true });
    return "saved";
  } catch (error) {
    if (error instanceof ApiCallError && error.status === 409) {
      void refreshDeviceNow();
      return "changed";
    }
    return error instanceof NetworkError ? "offline" : "failed";
  }
}

export type RecoverResult = "approved" | "wrong_words" | "no_recovery" | "offline" | "failed";

// A waiting iPhone approves itself with the recovery words (docs/security.md section 8, "Without another device").
export async function recoverWithWords(words: string): Promise<RecoverResult> {
  const user = currentUserId();
  const keys = user === null ? null : getDeviceKeys(user);
  if (user === null || keys === null) return "failed";
  try {
    const found = await api.recovery();
    try {
      await recoverAccountKey(user, cleanPhrase(words), {
        id: found.account_device_id,
        blob: found.wrapped_account_key,
        signPub: found.sign_pub,
        boxPub: found.box_pub,
      });
    } catch {
      return "wrong_words";
    }
    const made = await certifyDevice(user, { id: keys.deviceId, signPub: keys.signPub, boxPub: keys.boxPub }, true);
    const account = {
      id: found.account_device_id,
      sign: (input: { method: string; target: string; timestamp: number; body: string }) =>
        signRequestAsAccount(user, input.method, input.target, input.timestamp, input.body),
    };
    try {
      await api.approveDevice(keys.deviceId, { cert: made.cert, account_envelope: made.accountEnvelope, envelopes: [] }, account);
    } catch (error) {
      // Approved meanwhile by another device: fine, the refresh below shows it.
      if (!(error instanceof ApiCallError && error.status === 409)) throw error;
    }
    await refreshDeviceNow();
    // The group keys come back through the account row. A failure here is not a failed recovery: syncGroups reads the
    // account row's envelopes again for any group this iPhone still has no key for.
    await recoverGroupKeys(user, found.account_device_id).catch(() => undefined);
    return "approved";
  } catch (error) {
    if (notFound(error)) return "no_recovery";
    return error instanceof NetworkError ? "offline" : "failed";
  }
}

// The words screen is a reminder, not a gate. It opens for an approved iPhone holding the account key, with no recovery
// key on the server, once the person has a finished session, and at most once a week (shouldPromptRecovery). Checked
// when the device is approved, when a session count changes (a session is saved), and on each return to the app.
// Called once in (tabs)/_layout.tsx.
export function useRecoveryPrompt(): void {
  const status = useDeviceStatus();
  const sessions = useQuery((db) => finishedSessionCount(db));
  const lastShownAt = useQuery((db) => recoveryPromptShownAt(db));
  const [foreground, setForeground] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setForeground((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (status !== "approved" || !canMakeRecoveryKey()) return;
    // A check still waiting on the server when the inputs change is dropped; the new run decides with fresh inputs.
    let cancelled = false;
    const generation = dbGeneration();
    void loadRecoveryState().then((state) => {
      if (cancelled) return;
      const now = Date.now();
      // "unknown" (the server could not be asked) counts as saved: nothing is shown on a guess.
      const ask = shouldPromptRecovery({ saved: state !== "missing", sessionCount: sessions, lastShownAt, now });
      if (!ask) return;
      // Recorded before the screen opens, so a later check does not open it again within the week.
      const recorded = writeDbIf(generation, (db) => {
        markRecoveryPromptShown(db, now);
        return true;
      });
      if (recorded !== true) return;
      router.push("/recovery-words");
    });
    return () => {
      cancelled = true;
    };
  }, [status, sessions, lastShownAt, foreground]);
}
