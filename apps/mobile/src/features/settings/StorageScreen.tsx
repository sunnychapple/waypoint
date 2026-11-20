import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { indexStatus } from "../../core/search/indexer.ts";
import { bytesLabel, percentLabel } from "../../core/settings/format.ts";
import { getModel } from "../../../modules/waypoint-embed/index.ts";
import { useQuery, writeDb } from "../../platform/db.ts";
import { sessionsBytes } from "../../platform/files.ts";
import { Caption, OnDeviceNote, Screen, Title } from "../../ui/kit.tsx";
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

// Storage & search (K5, cut down): what the recordings and pages take, and the search index.
export default function StorageScreen() {
  const colors = useColors();
  const index = useQuery((db) => indexStatus(db, getModel().modelVersion));
  const bytes = sessionsBytes();

  function confirmRebuild() {
    Alert.alert("Rebuild search?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Rebuild",
        onPress: () => writeDb((db) => db.run("UPDATE sessions SET indexed_at = NULL")),
      },
    ]);
  }

  return (
    <Screen>
      <BackButton />
      <Title>Storage & search</Title>

      <Caption>Recordings and pages {bytesLabel(bytes)}</Caption>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>Searchable</Text>
        <Text style={[styles.percent, { color: colors.ink }]}>{percentLabel(index.indexed, index.sessions)}</Text>
        <Caption>
          {index.chunks} {index.chunks === 1 ? "piece" : "pieces"} of text · model {getModel().modelVersion}
        </Caption>
        <Pressable accessibilityRole="button" accessibilityLabel="Rebuild search" onPress={confirmRebuild} style={styles.rebuild}>
          <Text style={[styles.rebuildText, { color: colors.accent }]}>Rebuild search</Text>
        </Pressable>
      </View>

      <OnDeviceNote text="Your search index never leaves this iPhone." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  card: { padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  cardTitle: { fontSize: 17, fontWeight: "600" },
  percent: { fontSize: 34, fontWeight: "700" },
  rebuild: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  rebuildText: { fontSize: 17, fontWeight: "600" },
});
