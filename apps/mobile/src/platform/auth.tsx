import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClerkProvider, useAuth, useSignIn, useSignUp, useUser, type TokenCache } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { resourceCache } from "@clerk/expo/resource-cache";
import { useSignInWithApple } from "@clerk/expo/apple";
import { REQUIRE_SIGN_IN, decideGate, type Gate } from "../core/auth/gate.ts";
import { notesStep } from "../core/db/users.ts";
import { closeUserDb, dbUser, openUserDb } from "./db.ts";

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
  if (notes.kind === "open") openUserDb(notes.user);
  const signedInBefore = dbUser() !== null;
  const [waitedMs, setWaitedMs] = useState(0);
  const started = useRef(Date.now());
  const gate = decideGate({ requireSignIn: REQUIRE_SIGN_IN, clerkLoaded: isLoaded, clerkSignedIn: isSignedIn === true, signedInBefore, waitedMs });
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
