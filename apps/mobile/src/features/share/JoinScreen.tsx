import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { toFailure } from "../../platform/tasks.ts";
import { join } from "../../platform/share.ts";
import { BackButton, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";

// The screen for /invite/<token>, opened by an invite link (waypoint://invite/<token>) or by pasting one. The token is
// used once here and is not kept.
export default function JoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"offline" | "invalid" | null>(null);
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
      setFailed(toFailure(error).kind === "offline" ? "offline" : "invalid");
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackButton onPress={close} />
      <Title>Join this shared space?</Title>
      {failed === "offline" ? <Caption>You're offline. Connect to the internet and try again.</Caption> : null}
      {failed === "invalid" ? <Caption>This invite doesn't work anymore. Ask for a new one.</Caption> : null}
      <View style={styles.buttons}>
        <PrimaryButton
          label={failed === "offline" ? "Try again" : "Join"}
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
