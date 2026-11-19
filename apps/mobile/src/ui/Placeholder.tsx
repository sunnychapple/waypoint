import { StyleSheet, Text, View } from "react-native";
import { useColors } from "./theme.ts";

export function Placeholder({ title }: { title: string }) {
  const colors = useColors();
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontWeight: "600" },
});
