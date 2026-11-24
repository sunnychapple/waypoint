import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useColors } from "../../ui/theme.ts";

// The Edit switch (note 12): the whole transcript becomes typeable, while recording and after class.
export function EditSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const colors = useColors();
  return (
    <View style={styles.switch}>
      <Text style={[styles.switchLabel, { color: colors.ink }]}>Edit</Text>
      <Switch accessibilityLabel="Edit transcript" value={on} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.surface3 }} />
    </View>
  );
}

// Shown while Edit is on (S4, S13).
export function EditingBar({ hint, onDone }: { hint: string; onDone: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.bar, { backgroundColor: colors.accentSoft }]}>
      <SymbolView name="pencil" tintColor={colors.accent} size={16} />
      <View style={styles.flex}>
        <Text style={[styles.title, { color: colors.ink }]}>Editing transcript</Text>
        <Text style={[styles.body, { color: colors.ink2 }]}>{hint}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Done editing" hitSlop={8} onPress={onDone} style={styles.done}>
        <Text style={[styles.doneText, { color: colors.accent }]}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  switchLabel: { fontSize: 16, fontWeight: "600" },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14 },
  flex: { flex: 1 },
  title: { fontSize: 15, fontWeight: "700" },
  body: { fontSize: 14, lineHeight: 19 },
  done: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  doneText: { fontSize: 16, fontWeight: "600" },
});
