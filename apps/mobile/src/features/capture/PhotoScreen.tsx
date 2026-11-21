import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { momentFromParam } from "../../core/capture/moment.ts";
import { formatOffset } from "../../core/format.ts";
import { fileUri } from "../../platform/files.ts";

// A photo from a recording's timeline, full screen. Pinch to zoom; Close returns to the session.
export default function PhotoScreen() {
  const { file, t } = useLocalSearchParams<{ file?: string; t?: string }>();
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
      {file ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.fill}
          maximumZoomScale={4}
          minimumZoomScale={1}
          bouncesZoom
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
