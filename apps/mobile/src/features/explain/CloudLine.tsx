import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView } from "expo-symbols";
import { useColors } from "../../ui/theme.ts";

// The line under every cloud answer (docs/architecture.md section 6, "What is kept, by route").
export function CloudLine({ retention, onPress }: { retention: "standard" | "zero"; onPress?: () => void }) {
  const colors = useColors();
  const text = retention === "zero" ? "Not stored in the cloud" : "Sent for this task only";
  return (
    <Pressable accessibilityRole={onPress ? "button" : "text"} accessibilityLabel={text} disabled={onPress === undefined} onPress={onPress} style={styles.row}>
      <SymbolView name="cloud" tintColor={colors.cloud} size={14} />
      <Text style={[styles.text, { color: colors.cloudInk }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  text: { fontSize: 13, fontWeight: "500" },
});
