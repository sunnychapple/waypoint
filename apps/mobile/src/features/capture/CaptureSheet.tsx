import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { CancelButton, Caption, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { SavingToPill } from "./SavingToPill.tsx";
import { StartTile } from "./StartTile.tsx";

// The Record tab. Nothing starts until one of the actions is chosen, so a mistap costs nothing.
// Each action replaces the sheet with its screen in one navigation update. react-native-screens then dismisses the
// sheet and presents the next screen from the dismissal's completion, so the full-screen recorder never competes
// with a sheet that is still on screen. (Pushing from the sheet's unmount does not wait for anything: the stack drops
// the route and unmounts it as soon as the dismissal starts, not when it ends.) A swipe down just closes the sheet.
// Going back from the opened screen lands on the tabs, as the sheet is no longer in the stack.
export default function CaptureSheet() {
  const colors = useColors();

  function leave(path: string): void {
    router.replace(path as never);
  }

  return (
    <Screen>
      <CancelButton />
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
