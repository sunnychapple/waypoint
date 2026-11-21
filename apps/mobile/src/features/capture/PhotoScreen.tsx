import { useState } from "react";
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

// "reading" while the app has not read the photo yet (found_text is NULL); otherwise the text it read, trimmed. Empty text means no text.
export type FoundText = { state: "reading" } | { state: "read"; text: string };

// The photo's read text, or null when this person's database does not know the file (the same check as isKnownCapture).
export function photoFoundText(db: SqlDb, file: string): FoundText | null {
  if (!isKnownCapture(db, file)) return null;
  const row = db.get<{ found_text: string | null }>(
    "SELECT found_text FROM captures WHERE file = ? AND kind IN ('photo', 'page')",
    [file],
  );
  if (row === null) return null;
  return row.found_text === null ? { state: "reading" } : { state: "read", text: row.found_text.trim() };
}

// A photo from a recording's timeline, full screen. Pinch to zoom; Close returns to the session. The text the app read is under the photo.
export default function PhotoScreen() {
  const { file, t } = useLocalSearchParams<{ file?: string; t?: string }>();
  const found = useQuery((db) => (file ? photoFoundText(db, file) : null), file ?? "");
  const known = found !== null;
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
      {file && found ? <PhotoText found={found} /> : null}
    </SafeAreaView>
  );
}

// Under the photo. Hidden text is one tap away; the shown text can be selected and copied.
function PhotoText({ found }: { found: FoundText }) {
  const [showing, setShowing] = useState(false);
  if (found.state === "reading") {
    return <Text style={styles.reading}>Reading this photo…</Text>;
  }
  if (found.text === "") return null;
  return (
    <View style={styles.textPanel}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={showing ? "Hide the text" : "Show the text"}
        accessibilityState={{ expanded: showing }}
        onPress={() => setShowing(!showing)}
        style={styles.toggleRow}
      >
        <Text style={styles.toggle}>{showing ? "Hide the text" : "Show the text"}</Text>
      </Pressable>
      {showing ? (
        <ScrollView style={styles.textScroll}>
          <Text selectable style={styles.text}>
            {found.text}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12 },
  time: { color: "#fff", fontSize: 15, fontVariant: ["tabular-nums"] },
  close: { color: "#fff", fontSize: 17, fontWeight: "600" },
  fill: { flex: 1 },
  reading: { color: "#fff", fontSize: 15, paddingHorizontal: 20, paddingVertical: 12 },
  textPanel: { paddingHorizontal: 20, paddingBottom: 8 },
  toggleRow: { minHeight: 44, justifyContent: "center" },
  toggle: { color: "#fff", fontSize: 17, fontWeight: "600" },
  textScroll: { maxHeight: 240 },
  text: { color: "#fff", fontSize: 15, lineHeight: 21, paddingBottom: 12 },
});
