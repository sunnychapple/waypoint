import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEmailCode } from "../platform/auth.tsx";
import { useColors } from "../ui/theme.ts";

export default function CheckEmailScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ email: string; mode: "sign_in" | "sign_up" }>();
  const emailCode = useEmailCode();
  const [mode, setMode] = useState<"sign_in" | "sign_up">(params.mode);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Six digits submit by themselves.
  async function verify(digits: string) {
    setBusy(true);
    const result = await emailCode.verify(mode, digits);
    setBusy(false);
    if (result === "wrong_code") setMessage("That code didn't work. Check it and try again.");
    else if (result === "error") setMessage("Something went wrong. Check your connection and try again.");
    else setMessage(null);
  }

  async function resend() {
    setBusy(true);
    const result = await emailCode.send(params.email);
    setBusy(false);
    if (result === "error") {
      setMessage("Something went wrong. Check your connection and try again.");
      return;
    }
    setMode(result);
    setCode("");
    setMessage(null);
  }

  function onChangeCode(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Text style={[styles.title, { color: colors.ink }]}>Check your email</Text>
      <Text style={[styles.body, { color: colors.ink2 }]}>We sent a 6-digit code to {params.email}.</Text>

      <TextInput
        value={code}
        onChangeText={onChangeCode}
        editable={!busy}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.ink }]}
      />

      {message ? <Text style={[styles.message, { color: colors.danger }]}>{message}</Text> : null}

      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void resend()} style={styles.link}>
        <Text style={[styles.linkLabel, { color: colors.accent }]}>Send a new code</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.link}>
        <Text style={[styles.linkLabel, { color: colors.accent }]}>Use a different email</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, paddingTop: 96, gap: 16 },
  title: { fontSize: 28, fontWeight: "700" },
  body: { fontSize: 17, lineHeight: 24 },
  input: { height: 56, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 24, letterSpacing: 8, textAlign: "center" },
  message: { fontSize: 15, lineHeight: 20 },
  link: { paddingVertical: 8 },
  linkLabel: { fontSize: 17, fontWeight: "600" },
});
