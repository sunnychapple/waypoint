import { useState } from "react";
import { Clipboard, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { inviteTokenFromText } from "../../core/share/invite-link.ts";
import { BackButton, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// "Have an invite? Paste it": takes the link, the app link or the bare code. The clipboard is read only when the person
// taps Paste.
export default function PasteInviteScreen() {
  const colors = useColors();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function paste(): Promise<void> {
    try {
      const copied = await Clipboard.getString();
      setText(copied.trim());
      setError(null);
    } catch {
      setError("Couldn't read the clipboard. Paste it in the box instead.");
    }
  }

  function open(): void {
    const token = inviteTokenFromText(text);
    if (token === null) {
      setError("That doesn't look like an invite. Check it and try again.");
      return;
    }
    router.replace(`/invite/${encodeURIComponent(token)}`);
  }

  return (
    <Screen>
      <BackButton onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <Title>Paste an invite</Title>
      <Caption>Paste the link someone sent you.</Caption>
      <TextInput
        accessibilityLabel="Invite link"
        value={text}
        onChangeText={(value) => {
          setText(value);
          setError(null);
        }}
        onSubmitEditing={open}
        placeholder="https://… or the code"
        placeholderTextColor={colors.ink4}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType="go"
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.lineStrong, color: colors.ink }]}
      />
      {error ? <Caption style={{ color: colors.danger }}>{error}</Caption> : null}
      <View style={styles.buttons}>
        <PrimaryButton label="Open the invite" onPress={open} />
        <SecondaryButton label="Paste" icon="doc.on.clipboard" onPress={() => void paste()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 52, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontSize: 17 },
  buttons: { gap: 12 },
});
