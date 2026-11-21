import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { router, usePathname } from "expo-router";
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
import { getRecorderStatus } from "../../modules/waypoint-audio/index.ts";
import {
  clearRecoveryPromptShown,
  finishedSessionCount,
  markRecoveryPromptShown,
  recoveryPromptShownAt,
  shouldPromptRecovery,
} from "../core/device/recoveryPrompt.ts";
import { api } from "./api.ts";
import { dbGeneration, getDb, stillSame, useQuery, writeDbIf } from "./db.ts";
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
// when the device is approved, when a session is saved, when the person comes back to a tab screen, and on each return
// to the app. Never over the recorder or any other pushed screen: only while a tab root is showing. Called once in
// (tabs)/_layout.tsx.
const TAB_ROOTS = new Set(["/", "/spaces", "/review", "/search"]);
let checking = false; // one check at a time: the push is never started twice

export function useRecoveryPrompt(): void {
  const status = useDeviceStatus();
  const pathname = usePathname();
  const sessions = useQuery((db) => finishedSessionCount(db));
  const [foreground, setForeground] = useState(0);
  const here = useRef(pathname);
  here.current = pathname;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setForeground((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (status !== "approved" || sessions < 1 || checking || !TAB_ROOTS.has(pathname) || !canMakeRecoveryKey()) return;
    const generation = dbGeneration();
    const user = currentUserId();
    checking = true;
    void loadRecoveryState()
      .then((state) => {
        // Signed out, or someone else signed in, while the server was asked: the answer is not theirs.
        if (!stillSame(generation) || currentUserId() !== user) return;
        if (state === "unknown") return; // the server could not be asked: nothing is shown on a guess
        if (state !== "missing") {
          // Saved. A later removal that deletes the blob is a new situation: it prompts at once, not after the week.
          if (recoveryPromptShownAt(getDb()) !== null) writeDbIf(generation, (db) => clearRecoveryPromptShown(db));
          return;
        }
        // Still on a tab root, and not recording, now that the answer is back.
        if (!TAB_ROOTS.has(here.current) || getRecorderStatus().state !== "idle") return;
        const now = Date.now();
        // Decided on what the notes hold now, then recorded before the screen opens, in one write.
        const recorded = writeDbIf(generation, (db) => {
          const ask = shouldPromptRecovery({
            saved: false,
            sessionCount: finishedSessionCount(db),
            lastShownAt: recoveryPromptShownAt(db),
            now,
          });
          if (ask) markRecoveryPromptShown(db, now);
          return ask;
        });
        if (recorded === true) router.push("/recovery-words");
      })
      .finally(() => {
        checking = false;
      });
  }, [status, sessions, foreground, pathname]);
}
