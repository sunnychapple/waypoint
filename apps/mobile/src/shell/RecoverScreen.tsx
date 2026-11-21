import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { wordCount } from "../core/device/recovery.ts";
import { recoverWithWords, type RecoverResult } from "../platform/recovery.ts";
import { Body, Caption, PrimaryButton, Screen, Title } from "../ui/kit.tsx";
import { useColors } from "../ui/theme.ts";

const MESSAGE: Record<Exclude<RecoverResult, "approved">, string> = {
  wrong_words: "Those words don't match your recovery words. Check each word and try again.",
  no_recovery: "There are no recovery words for this account. Approve this iPhone from your other device instead.",
  offline: "You're offline. Connect and try again.",
  failed: "Something went wrong. Try again.",
};

// Shown from the waiting screen: this iPhone approves itself with the 12 words.
export default function RecoverScreen() {
  const colors = useColors();
  const [text, setText] = useState("");
  const [result, setResult] = useState<RecoverResult | null>(null);
  const [busy, setBusy] = useState(false);
  const count = wordCount(text);

  async function recover(): Promise<void> {
    if (count !== 12 || busy) return;
    setBusy(true);
    setResult(await recoverWithWords(text));
    setBusy(false);
  }

  if (result === "approved") {
    return (
      <Screen>
        <Title>This iPhone is ready</Title>
        <Body>If you lost your other device, remove it in Settings › Devices so it can't open new notes.</Body>
        <View style={styles.actions}>
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Use your recovery words</Title>
      <Body>Type your 12 recovery words, with spaces between them.</Body>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        accessibilityLabel="Your 12 recovery words"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        textContentType="none"
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.ink }]}
      />
      <Caption>{`${count} of 12 recovery words`}</Caption>
      {result !== null ? <Caption>{MESSAGE[result]}</Caption> : null}
      <View style={styles.actions}>
        <PrimaryButton label={busy ? "Checking…" : "Recover"} onPress={() => void recover()} style={count === 12 ? undefined : styles.dim} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 140, borderRadius: 14, borderWidth: 1, padding: 16, fontSize: 17, marginTop: 16 },
  dim: { opacity: 0.4 },
  actions: { gap: 12, marginTop: 24 },
});
