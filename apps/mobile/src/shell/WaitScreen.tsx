import { StyleSheet, Text, View } from "react-native";
import { useColors } from "../ui/theme.ts";

// Shown while the sign-in gate is still resolving, so launch never shows a blank screen.
export function WaitScreen() {
  const colors = useColors();
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text style={[styles.wordmark, { color: colors.ink }]}>NotePath</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center" },
  wordmark: { fontSize: 18, fontWeight: "700" },
});
