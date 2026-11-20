import { describe, expect, it } from "vitest";
import { OFFLINE_GRACE_MS, decideGate, type GateInput } from "../src/core/auth/gate.ts";

const base: GateInput = { requireSignIn: true, clerkLoaded: false, clerkSignedIn: false, signedInBefore: false, waitedMs: 0 };

describe("decideGate", () => {
  it("opens the app without asking for sign-in when requireSignIn is false", () => {
    expect(decideGate({ ...base, requireSignIn: false })).toBe("app");
  });

  it("opens the app when Clerk is loaded and the person is signed in", () => {
    expect(decideGate({ ...base, clerkLoaded: true, clerkSignedIn: true })).toBe("app");
  });

  it("shows sign-in when Clerk is loaded and the person is not signed in", () => {
    expect(decideGate({ ...base, clerkLoaded: true })).toBe("sign_in");
  });

  it("lets a signed-in result win over waitedMs", () => {
    expect(decideGate({ ...base, clerkLoaded: true, clerkSignedIn: true, waitedMs: 0 })).toBe("app");
  });

  it("opens the app offline after the grace period for a phone that signed in before", () => {
    expect(decideGate({ ...base, signedInBefore: true, waitedMs: 2999 })).toBe("wait");
    expect(decideGate({ ...base, signedInBefore: true, waitedMs: OFFLINE_GRACE_MS })).toBe("app");
  });

  it("shows sign-in after 15 seconds for a phone that has not signed in before", () => {
    expect(decideGate({ ...base, waitedMs: 14999 })).toBe("wait");
    expect(decideGate({ ...base, waitedMs: 15000 })).toBe("sign_in");
  });

  it("waits while Clerk is not loaded and the time limits have not passed", () => {
    expect(decideGate(base)).toBe("wait");
  });

  it("shows sign-in once Clerk has loaded signed out, even for a phone that signed in before and waited", () => {
    expect(decideGate({ ...base, clerkLoaded: true, clerkSignedIn: false, signedInBefore: true, waitedMs: 5000 })).toBe("sign_in");
  });

  it("a signed-in result wins after a long wait on a phone that signed in before", () => {
    expect(decideGate({ ...base, clerkLoaded: true, clerkSignedIn: true, signedInBefore: true, waitedMs: 15000 })).toBe("app");
  });
});
