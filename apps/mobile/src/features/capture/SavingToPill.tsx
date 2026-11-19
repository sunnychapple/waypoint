import { Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { getSavingTo } from "../../core/db/spaces.ts";
import { useQuery } from "../../platform/db.ts";
import { useColors } from "../../ui/theme.ts";

export function SavingToPill() {
  const colors = useColors();
  const space = useQuery(getSavingTo);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Saving to ${space.name}`}
      onPress={() => router.push("/space-picker")}
      style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.lineStrong }]}
    >
      <SymbolView name="folder" tintColor={colors.accent} size={18} />
      <Text style={[styles.name, { color: colors.ink }]}>{space.name}</Text>
      <SymbolView name="chevron.down" tintColor={colors.ink3} size={12} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: { fontSize: 17, fontWeight: "600" },
});
