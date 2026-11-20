import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClerkProvider, useAuth, useSignIn, useSignUp, useUser, type TokenCache } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { resourceCache } from "@clerk/expo/resource-cache";
import { useSignInWithApple } from "@clerk/expo/apple";
import * as SecureStore from "expo-secure-store";
import { REQUIRE_SIGN_IN, decideGate, type Gate } from "../core/auth/gate.ts";

const publishableKey: string = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const SIGNED_IN_BEFORE = "waypoint.signed_in_before";

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

export function useGate(): Gate {
  const { isLoaded, isSignedIn } = useAuth();
  const [signedInBefore, setSignedInBefore] = useState(false);
  const [waitedMs, setWaitedMs] = useState(0);
  const started = useRef(Date.now());
  const gate = decideGate({ requireSignIn: REQUIRE_SIGN_IN, clerkLoaded: isLoaded, clerkSignedIn: isSignedIn === true, signedInBefore, waitedMs });
  const waiting = gate === "wait";
  useEffect(() => {
    SecureStore.getItemAsync(SIGNED_IN_BEFORE).then((v) => setSignedInBefore(v === "1"), () => setSignedInBefore(false));
  }, []);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setWaitedMs(Date.now() - started.current), 500);
    return () => clearInterval(timer);
  }, [waiting]);
  useEffect(() => {
    if (isLoaded && isSignedIn === true) SecureStore.setItemAsync(SIGNED_IN_BEFORE, "1").catch(() => undefined);
  }, [isLoaded, isSignedIn]);
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

// Signing out never deletes notes (K1: "Signing out doesn't delete your notes.").
export function useSignOut(): () => Promise<void> {
  const { signOut } = useAuth();
  return async () => {
    await SecureStore.deleteItemAsync(SIGNED_IN_BEFORE);
    await signOut();
  };
}
