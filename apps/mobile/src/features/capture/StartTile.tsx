import { Pressable, StyleSheet, Text } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";

// A big colored start button: Record, Snap pages. Home and the capture sheet both use it.
export function StartTile({
  label,
  detail,
  icon,
  fill,
  ink,
  onPress,
}: {
  label: string;
  detail: string;
  icon: SFSymbol;
  fill: string;
  ink: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.tile, { backgroundColor: fill }]}>
      <SymbolView name={icon} tintColor={ink} size={28} />
      <Text style={[styles.tileTitle, { color: ink }]}>{label}</Text>
      <Text style={[styles.tileDetail, { color: ink }]}>{detail}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minHeight: 130, borderRadius: 20, padding: 16, justifyContent: "space-between" },
  tileTitle: { fontSize: 20, fontWeight: "700" },
  tileDetail: { fontSize: 14, opacity: 0.85 },
});
