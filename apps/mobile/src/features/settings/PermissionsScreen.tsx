import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { getMicPermission, requestMicPermission, type MicPermission } from "../../../modules/waypoint-audio/index.ts";
import { BackButton, Caption, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// Permissions (A7 as a settings page). Microphone and camera are read and asked here. Speech recognition is asked by
// the system on first use, so its row says so.
export default function PermissionsScreen() {
  const colors = useColors();
  const [mic, setMic] = useState<MicPermission | null>(null);
  const [camera, setCamera] = useState<ImagePicker.PermissionStatus | null>(null);

  // Refreshes when the screen opens or comes back, and when the app comes back from iOS Settings
  // (the screen is not blurred while the app is in the background, so focus alone misses that).
  const refresh = useCallback(() => {
    getMicPermission().then(setMic, () => setMic(null));
    ImagePicker.getCameraPermissionsAsync().then(
      ({ status }) => setCamera(status),
      () => setCamera(null),
    );
  }, []);
  useFocusEffect(refresh);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  async function allowMic() {
    if (mic === "undetermined") {
      setMic(await requestMicPermission());
    } else {
      await Linking.openSettings();
    }
  }

  const allow = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Allow"
      onPress={() => void allowMic()}
      style={[styles.allow, { backgroundColor: colors.accent }]}
    >
      <Text style={[styles.allowText, { color: colors.onAccent }]}>Allow</Text>
    </Pressable>
  );

  const cameraRight =
    camera === ImagePicker.PermissionStatus.GRANTED ? (
      <View style={[styles.chip, { backgroundColor: colors.localSoft }]}>
        <Text style={[styles.chipText, { color: colors.localInk }]}>Allowed</Text>
      </View>
    ) : camera === ImagePicker.PermissionStatus.DENIED ? (
      <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={styles.denied}>
        <Caption>Not allowed — tap to open Settings</Caption>
      </Pressable>
    ) : camera === ImagePicker.PermissionStatus.UNDETERMINED ? (
      <Caption>Asked when you first use it</Caption>
    ) : null;

  const micRight =
    mic === "granted" ? (
      <View style={[styles.chip, { backgroundColor: colors.localSoft }]}>
        <Text style={[styles.chipText, { color: colors.localInk }]}>Allowed</Text>
      </View>
    ) : mic === "denied" ? (
      <View style={styles.denied}>
        <Caption>Not allowed</Caption>
        {allow}
      </View>
    ) : mic === "undetermined" ? (
      allow
    ) : null;

  return (
    <Screen>
      <BackButton />
      <Title>Permissions</Title>
      <Row title="Microphone" subtitle="Record classes and talks" right={micRight} />
      <Row title="Speech recognition" subtitle="Write down recordings on this iPhone" right={<Caption>Asked when you first use it</Caption>} />
      <Row title="Camera" subtitle="Snap pages" right={cameraRight} />
      <Caption style={styles.center}>Change any of these in Settings.</Caption>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 13, fontWeight: "600" },
  denied: { alignItems: "flex-end", gap: 6 },
  allow: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  allowText: { fontSize: 15, fontWeight: "600" },
  center: { textAlign: "center" },
});
