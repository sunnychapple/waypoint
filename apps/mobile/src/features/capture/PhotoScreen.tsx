import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { momentFromParam } from "../../core/capture/moment.ts";
import { formatOffset } from "../../core/format.ts";
import type { SqlDb } from "../../core/db/sql.ts";
import { useQuery } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";

// Only a photo or page this person's own database knows can be shown; a crafted link's path (../ and the like) matches none.
export function isKnownCapture(db: SqlDb, file: string): boolean {
  if (file.includes("..") || file.startsWith("/")) return false;
  return db.get("SELECT 1 AS ok FROM captures WHERE file = ? AND kind IN ('photo', 'page')", [file]) !== null;
}

// A photo from a recording's timeline, full screen. Pinch to zoom; Close returns to the session.
export default function PhotoScreen() {
  const { file, t } = useLocalSearchParams<{ file?: string; t?: string }>();
  const known = useQuery((db) => (file ? isKnownCapture(db, file) : false), file ?? "");
  const at = momentFromParam(t);
  const time = at === null ? null : formatOffset(at);
  const label = time === null ? "Photo" : `Photo at ${time}`;

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.time}>{time ?? ""}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>
      {file && known ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.fill}
          maximumZoomScale={4}
          minimumZoomScale={1}
          bouncesZoom
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <Image accessibilityLabel={label} source={{ uri: fileUri(file) }} resizeMode="contain" style={styles.fill} />
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12 },
  time: { color: "#fff", fontSize: 15, fontVariant: ["tabular-nums"] },
  close: { color: "#fff", fontSize: 17, fontWeight: "600" },
  fill: { flex: 1 },
});
