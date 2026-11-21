import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { TimelineItem } from "../../core/capture/timeline.ts";
import { formatClock, formatOffset } from "../../core/format.ts";
import { fileUri } from "../../platform/files.ts";
import { useColors } from "../../ui/theme.ts";

export function photoLabel(at: number): string {
  return `Photo at ${formatOffset(at)}`;
}

export function flagLabel(at: number): string {
  return `Flagged moment at ${formatOffset(at)}, opens Questions for later`;
}

// A gap, flag or photo in a recording's timeline. The live recording screen and the saved session draw them the same way.
// A photo opens the full-screen viewer; a flag opens Questions for later.
// Taps only work where `interactive` is set: the live recorder must not navigate away mid-recording.
export function TimeMarkRow({ item, interactive = false }: { item: Exclude<TimelineItem, { kind: "line" }>; interactive?: boolean }) {
  const colors = useColors();
  switch (item.kind) {
    case "gap":
      return (
        <View style={styles.line}>
          <Text style={[styles.time, { color: colors.ink3 }]}>{formatOffset(item.at)}</Text>
          <Text style={[styles.lineText, { color: colors.ink3 }]}>Gap · {formatClock(item.gapMs)} not captured</Text>
        </View>
      );
    case "flag":
      return (
        <View style={styles.line}>
          <Text style={[styles.time, { color: colors.flagInk }]}>{formatOffset(item.at)}</Text>
          <Pressable
            disabled={!interactive}
            accessibilityRole={interactive ? "button" : undefined}
            accessibilityLabel={interactive ? flagLabel(item.at) : "Flagged moment"}
            hitSlop={8}
            onPress={() => router.push("/later")}
            style={[styles.flagChip, { backgroundColor: colors.flagSoft }]}
          >
            <SymbolView name="flag.fill" tintColor={colors.flag} size={12} />
            <Text style={[styles.flagText, { color: colors.flagInk }]}>Flagged</Text>
          </Pressable>
        </View>
      );
    case "photo":
      return (
        <View style={styles.line}>
          <Text style={[styles.time, { color: colors.ink3 }]}>{formatOffset(item.at)}</Text>
          <Pressable
            disabled={!interactive}
            accessibilityRole={interactive ? "button" : undefined}
            accessibilityLabel={interactive ? photoLabel(item.at) : "Photo"}
            onPress={() => router.push({ pathname: "/photo", params: { file: item.file, t: String(item.at) } })}
          >
            <Image source={{ uri: fileUri(item.file) }} style={styles.thumb} resizeMode="cover" />
          </Pressable>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  time: { fontSize: 13, fontVariant: ["tabular-nums"], minWidth: 44, paddingTop: 2 },
  lineText: { flex: 1, fontSize: 17, lineHeight: 24 },
  flagChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  flagText: { fontSize: 14, fontWeight: "600" },
  thumb: { width: 96, height: 72, borderRadius: 10 },
});
