import { useCallback, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { getMicPermission, requestMicPermission, type MicPermission } from "../../../modules/waypoint-audio/index.ts";
import { Caption, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

function BackButton() {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={() => router.back()}
      style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <SymbolView name="chevron.left" tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

// Permissions (A7 as a settings page). Microphone is read and asked here; speech and camera are asked by
// the system on first use, so their rows say so.
export default function PermissionsScreen() {
  const colors = useColors();
  const [mic, setMic] = useState<MicPermission | null>(null);

  // Refreshes when the screen opens or comes back, since the person may have changed it in iOS Settings.
  useFocusEffect(
    useCallback(() => {
      getMicPermission().then(setMic, () => setMic(null));
    }, []),
  );

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
      <Row title="Microphone" subtitle="Record classes and talks" right={micRight} onPress={() => undefined} />
      <Row
        title="Speech recognition"
        subtitle="Write down recordings on this iPhone"
        right={<Caption>Asked when you first use it</Caption>}
        onPress={() => undefined}
      />
      <Row title="Camera" subtitle="Snap pages" right={<Caption>Asked when you first use it</Caption>} onPress={() => undefined} />
      <Caption style={styles.center}>Change any of these in Settings.</Caption>
    </Screen>
  );
}

const styles = StyleSheet.create({
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 13, fontWeight: "600" },
  denied: { alignItems: "flex-end", gap: 6 },
  allow: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  allowText: { fontSize: 15, fontWeight: "600" },
  center: { textAlign: "center" },
});
