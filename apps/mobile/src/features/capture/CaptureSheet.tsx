import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Caption, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { SavingToPill } from "./SavingToPill.tsx";
import { StartTile } from "./StartTile.tsx";

// The Record tab. Nothing starts until one of the actions is chosen, so a mistap costs nothing.
// Each action dismisses the sheet first and opens its screen only once the sheet has gone: the recorder is a
// full-screen modal, and presenting it while the form sheet is still on screen does not work reliably.
// The screen unmounts when the dismissal finishes, and the unmount is where the pending route is pushed.
export default function CaptureSheet() {
  const colors = useColors();
  const pending = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (pending.current !== null) router.push(pending.current as never);
    },
    [],
  );

  function leave(path: string): void {
    pending.current = path;
    router.back();
  }

  return (
    <Screen>
      <Title>Capture</Title>

      <View style={styles.savingTo}>
        <Caption>Saving to</Caption>
        <SavingToPill />
      </View>

      <View style={styles.starts}>
        <StartTile
          label="Record"
          detail="A class or a talk"
          icon="mic.fill"
          fill={colors.rec}
          ink={colors.onRec}
          onPress={() => leave("/recording")}
        />
        <StartTile
          label="Snap pages"
          detail="Homework, books"
          icon="camera.fill"
          fill={colors.accent}
          ink={colors.onAccent}
          onPress={() => leave("/pages/new")}
        />
      </View>
      <SecondaryButton label="From Photos" onPress={() => leave("/pages/new?from=photos")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  savingTo: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  starts: { flexDirection: "row", gap: 12 },
});
