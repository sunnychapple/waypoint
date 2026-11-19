export const REQUIRE_SIGN_IN = true;
export const OFFLINE_GRACE_MS = 3000;
export type GateInput = { requireSignIn: boolean; clerkLoaded: boolean; clerkSignedIn: boolean; signedInBefore: boolean; waitedMs: number };
export type Gate = "wait" | "app" | "sign_in";

const NEW_PHONE_TIMEOUT_MS = 15000;

// Rules are checked in order. The first one that matches decides.
export function decideGate(input: GateInput): Gate {
  if (!input.requireSignIn) return "app";
  if (input.clerkLoaded && input.clerkSignedIn) return "app";
  if (input.clerkLoaded) return "sign_in";
  if (input.signedInBefore && input.waitedMs >= OFFLINE_GRACE_MS) return "app";
  if (!input.signedInBefore && input.waitedMs >= NEW_PHONE_TIMEOUT_MS) return "sign_in";
  return "wait";
}
