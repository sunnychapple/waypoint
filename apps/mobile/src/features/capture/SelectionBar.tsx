import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useColors } from "../../ui/theme.ts";

// S2: one bar for the selected words, while recording and after. It has Explain, Highlight and Note, and More for
// who's talking and hiding lines. It is shown only to people who can change the transcript (not to a viewer of a shared
// space). The recording keeps running under it.
// `inset`: the bar sits at the bottom of the screen and keeps clear of the home indicator.
export function SelectionBar({
  text,
  single,
  canExplain,
  highlighted,
  inset = true,
  onExplain,
  onHighlight,
  onNote,
  onMore,
  onClose,
}: {
  text: string;
  single: boolean;
  canExplain: boolean;
  highlighted: boolean;
  inset?: boolean;
  onExplain: () => void;
  onHighlight: () => void;
  onNote: () => void;
  onMore: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderColor: colors.line, marginHorizontal: inset ? 12 : 0, paddingBottom: 10 + (inset ? insets.bottom : 0) },
      ]}
    >
      <View style={styles.head}>
        <Text numberOfLines={2} style={[styles.quote, { color: colors.ink2 }]}>{`“${text}”`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Clear selection" onPress={onClose} style={styles.close}>
          <SymbolView name="xmark" tintColor={colors.ink3} size={16} />
        </Pressable>
      </View>
      {single ? <Text style={[styles.hint, { color: colors.ink3 }]}>Tap another word to select up to it.</Text> : null}
      {canExplain ? null : <Text style={[styles.hint, { color: colors.ink3 }]}>Select fewer words to explain.</Text>}
      <View style={styles.actions}>
        <BarButton label="Explain" icon="lightbulb" disabled={!canExplain} onPress={onExplain} />
        <BarButton label={highlighted ? "Unhighlight" : "Highlight"} icon="highlighter" onPress={onHighlight} />
        <BarButton label="Note" icon="note.text" onPress={onNote} />
        <BarButton label="More" icon="ellipsis" onPress={onMore} />
      </View>
    </View>
  );
}

function BarButton({ label, icon, disabled = false, onPress }: { label: string; icon: SFSymbol; disabled?: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { opacity: disabled ? 0.4 : 1 }]}
    >
      <SymbolView name={icon} tintColor={colors.accent} size={20} />
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 6, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  quote: { flex: 1, fontSize: 15, fontStyle: "italic" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 13 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around" },
  button: { minWidth: 64, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 4 },
  label: { fontSize: 13, fontWeight: "600" },
});
