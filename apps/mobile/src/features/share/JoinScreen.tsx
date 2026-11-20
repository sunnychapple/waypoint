import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { join } from "../../platform/share.ts";
import { Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";

// The screen for waypoint://invite/<token>. The token is used once here and is not kept.
export default function JoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false); // a second tap before the first request ends is ignored

  function close(): void {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  async function joinSpace(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const groupId = await join(token);
      router.replace(`/shared/${encodeURIComponent(groupId)}`);
    } catch {
      inFlight.current = false;
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Join this shared space?</Title>
      {failed ? <Caption>This invite doesn't work. Ask for a new link.</Caption> : null}
      <View style={styles.buttons}>
        <PrimaryButton label="Join" onPress={() => void joinSpace()} style={busy ? styles.busy : undefined} />
        <SecondaryButton label="Not now" onPress={close} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 12 },
  busy: { opacity: 0.5 },
});
