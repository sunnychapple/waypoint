import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useColors } from "./theme.ts";

export function Screen({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const colors = useColors();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }, style]}>
      {children}
    </Text>
  );
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const colors = useColors();
  return <Text style={[styles.body, { color: colors.ink2 }, style]}>{children}</Text>;
}

export function Caption({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const colors = useColors();
  return <Text style={[styles.caption, { color: colors.ink3 }, style]}>{children}</Text>;
}

// A screen opened from a link or a notification can be the only one in the stack: go home then.
function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

// The round back button at the top left of a pushed screen. Screens that need a different exit pass onPress.
export function BackButton({ onPress }: { onPress?: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress ?? goBack}
      style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <SymbolView name="chevron.left" tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

type ButtonProps = { label: string; onPress: () => void; icon?: SFSymbol; style?: StyleProp<ViewStyle> };

export function PrimaryButton({ label, onPress, icon, style }: ButtonProps) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, { backgroundColor: colors.accent }, style]}
    >
      {icon ? <SymbolView name={icon} tintColor={colors.onAccent} size={18} /> : null}
      <Text style={[styles.buttonText, { color: colors.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, icon, tone = "surface", style }: ButtonProps & { tone?: "surface" | "accent" }) {
  const colors = useColors();
  const fill = tone === "accent" ? colors.accentSoft : colors.surface2;
  const ink = tone === "accent" ? colors.accent : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, { backgroundColor: fill }, style]}
    >
      {icon ? <SymbolView name={icon} tintColor={ink} size={18} /> : null}
      <Text style={[styles.buttonText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

// A row that does something when onPress is given (a button to VoiceOver), or shows information when it is not.
// `selected` marks the chosen row in a list of choices, for VoiceOver.
export function Row({
  title,
  subtitle,
  leading,
  right,
  onPress,
  selected = false,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  right?: ReactNode;
  onPress?: (() => void) | undefined;
  selected?: boolean;
}) {
  const colors = useColors();
  const style = [styles.row, { backgroundColor: colors.surface, borderColor: colors.line }];
  const content = (
    <>
      {leading}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSubtitle, { color: colors.ink3 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </>
  );
  if (onPress === undefined) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={style}
    >
      {content}
    </Pressable>
  );
}

export function OnDeviceNote({ text }: { text: string }) {
  const colors = useColors();
  return (
    <View style={styles.note}>
      <SymbolView name="iphone" tintColor={colors.local} size={14} />
      <Text style={[styles.noteText, { color: colors.local }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: "Georgia", fontSize: 32, fontWeight: "700" },
  body: { fontSize: 17, lineHeight: 24 },
  caption: { fontSize: 13 },
  button: {
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonText: { fontSize: 17, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 17, fontWeight: "600" },
  rowSubtitle: { fontSize: 14 },
  note: { flexDirection: "row", alignItems: "center", gap: 6 },
  noteText: { fontSize: 13, fontWeight: "500" },
});
