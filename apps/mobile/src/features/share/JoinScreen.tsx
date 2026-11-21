import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiCallError } from "@waypoint/api-client";
import { toFailure } from "../../platform/tasks.ts";
import { join } from "../../platform/share.ts";
import { BackButton, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";

// Offline and server trouble can be retried; a dead invite (the server answers 404 for unknown, used and expired ones)
// and a refused join (409: full, already a member, too many spaces) cannot.
function joinFailure(error: unknown): "offline" | "invalid" | "blocked" | "failed" {
  if (error instanceof ApiCallError && (error.status === 404 || error.status === 410)) return "invalid";
  if (error instanceof ApiCallError && error.status === 409) return "blocked";
  return toFailure(error).kind === "offline" ? "offline" : "failed";
}

// The screen for /invite/<token>, opened by an invite link (waypoint://invite/<token>) or by pasting one. The token is
// used once here and is not kept.
export default function JoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"offline" | "invalid" | "blocked" | "failed" | null>(null);
  const inFlight = useRef(false); // a second tap before the first request ends is ignored

  function close(): void {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  async function joinSpace(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(null);
    try {
      const groupId = await join(token);
      router.replace(`/shared/${encodeURIComponent(groupId)}`);
    } catch (error) {
      inFlight.current = false;
      setFailed(joinFailure(error));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackButton onPress={close} />
      <Title>Join this shared space?</Title>
      {failed === "offline" ? <Caption>You're offline. Connect to the internet and try again.</Caption> : null}
      {failed === "blocked" ? <Caption>You can't join this space. It may be full, or you may already be in it.</Caption> : null}
      {failed === "failed" ? <Caption>Couldn't join just now. Try again in a moment.</Caption> : null}
      {failed === "invalid" ? <Caption>This invite doesn't work anymore. Ask for a new one.</Caption> : null}
      <View style={styles.buttons}>
        <PrimaryButton
          label={failed === "offline" || failed === "failed" ? "Try again" : "Join"}
          onPress={() => void joinSpace()}
          style={busy ? styles.busy : undefined}
        />
        <SecondaryButton label="Not now" onPress={close} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 12 },
  busy: { opacity: 0.5 },
});
