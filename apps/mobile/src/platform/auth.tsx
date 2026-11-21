import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClerkProvider, useAuth, useSignIn, useSignUp, useUser, type TokenCache } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { resourceCache } from "@clerk/expo/resource-cache";
import { useSignInWithApple } from "@clerk/expo/apple";
import { REQUIRE_SIGN_IN, decideGate, type Gate } from "../core/auth/gate.ts";
import { accountFiles, deleteAccountFailure, notesStep, type DeleteFailure } from "../core/db/users.ts";
import { closeUserDb, dbUser, getDb, openUserDb } from "./db.ts";
import { deleteFile, deleteSessionFiles } from "./files.ts";

const publishableKey: string = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

function secureTokenCache(): TokenCache {
  if (!tokenCache) throw new Error("secure token cache unavailable");
  return tokenCache;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={secureTokenCache()} __experimental_resourceCache={resourceCache}>
      {children}
    </ClerkProvider>
  );
}

export type SendResult = "sign_in" | "sign_up" | "error";
export type VerifyResult = "ok" | "wrong_code" | "error";

// Email code for both new and returning people: try sign-in; an unknown email becomes a sign-up.
export function useEmailCode() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  return {
    async send(emailAddress: string): Promise<SendResult> {
      try {
        const r = await signIn.emailCode.sendCode({ emailAddress });
        if (!r.error) return "sign_in";
        if (r.error.code !== "form_identifier_not_found") return "error";
        const created = await signUp.create({ emailAddress });
        if (created.error) return "error";
        const sent = await signUp.verifications.sendEmailCode();
        return sent.error ? "error" : "sign_up";
      } catch {
        return "error";
      }
    },
    async verify(mode: "sign_in" | "sign_up", code: string): Promise<VerifyResult> {
      try {
        const r = mode === "sign_in" ? await signIn.emailCode.verifyCode({ code }) : await signUp.verifications.verifyEmailCode({ code });
        if (r.error) return r.error.code === "form_code_incorrect" ? "wrong_code" : "error";
        const done = mode === "sign_in" ? signIn.status === "complete" : signUp.status === "complete";
        if (!done) return "error";
        const finished = mode === "sign_in" ? await signIn.finalize() : await signUp.finalize();
        return finished.error ? "error" : "ok";
      } catch {
        return "error";
      }
    },
  };
}

export type AppleResult = "ok" | "cancelled" | "error";

// Native Sign in with Apple. Clerk returns no session when the person cancels, and throws when Apple or Clerk
// refuses or the network is down.
export function useAppleSignIn(): () => Promise<AppleResult> {
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  return async () => {
    try {
      const { createdSessionId, setActive } = await startAppleAuthenticationFlow();
      if (!createdSessionId || !setActive) return "cancelled";
      await setActive({ session: createdSessionId });
      return "ok";
    } catch {
      return "error";
    }
  };
}

// Also decides whose notes are open (open question 52): the person Clerk says is signed in, opened here, before any
// screen reads them. Before Clerk has loaded (offline), the person signed in last time ("signed in before"). When Clerk
// says nobody is signed in, their notes are closed; nothing is deleted.
export function useGate(): Gate {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const notes = notesStep({ clerkLoaded: isLoaded, clerkSignedIn: isSignedIn, clerkUserId: userId });
  let openFailed = false;
  if (notes.kind === "open") {
    try {
      openUserDb(notes.user);
    } catch {
      openFailed = true; // the sign-in screen instead of a crash on every launch; the next render tries again
    }
  }
  const signedInBefore = dbUser() !== null;
  const [waitedMs, setWaitedMs] = useState(0);
  const started = useRef(Date.now());
  const decided = decideGate({ requireSignIn: REQUIRE_SIGN_IN, clerkLoaded: isLoaded, clerkSignedIn: isSignedIn === true, signedInBefore, waitedMs });
  const gate: Gate = openFailed ? "sign_in" : decided;
  const waiting = gate === "wait";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setWaitedMs(Date.now() - started.current), 500);
    return () => clearInterval(timer);
  }, [waiting]);
  // A backstop for a session that ended without useSignOut (it expired, or was ended elsewhere).
  useEffect(() => {
    if (notes.kind === "close") void closeUserDb();
  }, [notes.kind]);
  return gate;
}

export type Profile = { firstName: string; email: string; initial: string; viaApple: boolean };

export function useProfile(): Profile | null {
  const { user } = useUser();
  if (!user) return null;
  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const firstName = user.firstName ?? email.split("@")[0] ?? "";
  return { firstName, email, initial: (firstName[0] ?? "?").toUpperCase(), viaApple: user.externalAccounts.some((a) => a.provider === "apple") };
}

// Signing out never deletes notes (K1: "Signing out doesn't delete your notes."). They are closed right after Clerk's
// sign-out, and the Keychain stops naming this person before this resolves; they open again when this person signs in.
export function useSignOut(): () => Promise<void> {
  const { signOut } = useAuth();
  return async () => {
    await signOut();
    await closeUserDb();
  };
}

// The notes file names the person's own sessions and overview audio, read before Clerk deletes the account. Only the
// open person's notes are read (dbUser), never anyone else's; nothing is read when they cannot be.
function ownNoteFiles(clerkUserId: string): { sessionIds: string[]; overviewFiles: string[] } {
  if (dbUser() !== clerkUserId) return { sessionIds: [], overviewFiles: [] };
  try {
    const db = getDb();
    return {
      sessionIds: db.all<{ id: string }>("SELECT id FROM sessions").map((row) => row.id),
      overviewFiles: db.all<{ file: string }>("SELECT file FROM overviews WHERE file IS NOT NULL").map((row) => row.file),
    };
  } catch {
    return { sessionIds: [], overviewFiles: [] };
  }
}

export type DeleteAccountOutcome = "deleted" | DeleteFailure;

// Deletes the signed-in person's Clerk account (App Store 5.1.1(v)). When Clerk refuses, nothing is signed out or
// deleted here, and the outcome says why. When it succeeds: the session ends, their notes close (nothing else is
// touched), and this person's notes database and their sessions and overview audio are removed from this iPhone.
export function useDeleteAccount(): () => Promise<DeleteAccountOutcome> {
  const { user } = useUser();
  const { signOut } = useAuth();
  return async () => {
    if (!user) return "failed";
    const clerkUserId = user.id;
    const { sessionIds, overviewFiles } = ownNoteFiles(clerkUserId);
    try {
      await user.delete();
    } catch (error) {
      return deleteAccountFailure(error);
    }
    try {
      await signOut();
    } catch {
      // Clerk had already ended the session with the account.
    }
    await closeUserDb();
    const local = accountFiles({ clerkUserId, sessionIds, overviewFiles });
    for (const file of local.files) {
      try {
        deleteFile(file);
      } catch {
        // Already gone, or in use: the rest are still removed.
      }
    }
    for (const id of local.sessionIds) {
      try {
        deleteSessionFiles(id);
      } catch {
        // As above.
      }
    }
    return "deleted";
  };
}
