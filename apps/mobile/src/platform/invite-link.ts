import { useEffect, useRef } from "react";
import { Linking } from "react-native";
import { router, usePathname } from "expo-router";
import type { Gate } from "../core/auth/gate.ts";
import { inviteTokenFromText } from "../core/share/invite-link.ts";

// An invite link that arrives while signed out (or before the app knows who is signed in) is held here, in memory,
// and opened once the person is signed in. Only the token is kept, and only until it is opened.
let held: string | null = null;

// Holds an invite link that arrives outside the signed-in app, and opens it when the gate reaches "app". While signed
// in, expo-router opens the link itself, so nothing is held.
export function useHeldInvite(gate: Gate): void {
  const gateRef = useRef(gate);
  gateRef.current = gate;
  const pathname = usePathname();

  useEffect(() => {
    const hold = (url: string | null | undefined): void => {
      if (!url || gateRef.current === "app") return;
      const token = inviteTokenFromText(url);
      if (token !== null) held = token;
    };
    void Linking.getInitialURL().then(hold, () => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) => hold(url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (gate !== "app" || held === null) return;
    const token = held;
    held = null;
    // A link the app already opened by itself (signed in at launch) is on the invite screen: do not stack a second one.
    if (!pathname.startsWith("/invite/")) router.push(`/invite/${encodeURIComponent(token)}`);
  }, [gate, pathname]);
}
