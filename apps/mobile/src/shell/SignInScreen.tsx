import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import { normalizeEmail } from "../core/auth/email.ts";
import { useAppleSignIn, useEmailCode } from "../platform/auth.tsx";
import { useColors } from "../ui/theme.ts";

export default function SignInScreen() {
  const colors = useColors();
  const isDark = useColorScheme() === "dark";
  const router = useRouter();
  const emailCode = useEmailCode();
  const signInWithApple = useAppleSignIn();
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function sendCode() {
    const address = normalizeEmail(email);
    if (!address) {
      setMessage("Enter an email address like name@example.com");
      return;
    }
    setSending(true);
    const result = await emailCode.send(address);
    setSending(false);
    if (result === "error") {
      setMessage("Couldn't send the code. Check your connection and try again.");
      return;
    }
    setMessage(null);
    router.push({ pathname: "/check-email", params: { email: address, mode: result } });
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.top}>
        <Text style={[styles.wordmark, { color: colors.ink }]}>NotePath</Text>
        <Text style={[styles.headline, { color: colors.ink }]}>
          Record the lecture. Ask about anything. <Text style={{ color: colors.accent }}>Remember</Text> it.
        </Text>
        <Text style={[styles.body, { color: colors.ink2 }]}>
          Capture a lecture, follow every tangent, and remember it — on your phone, privately.
        </Text>
      </View>

      <View style={styles.actions}>
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={isDark ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={14}
          style={styles.apple}
          onPress={() => {
            void signInWithApple().then((result) => {
              setMessage(result === "error" ? "Couldn't sign in with Apple. Check your connection and try again." : null);
            });
          }}
        />

        <Pressable
          accessibilityRole="button"
          onPress={() => setShowEmail((open) => !open)}
          style={[styles.secondary, { backgroundColor: colors.surface, borderColor: colors.line }]}
        >
          <Text style={[styles.secondaryLabel, { color: colors.ink }]}>Continue with email</Text>
        </Pressable>

        {showEmail ? (
          <View style={styles.emailBlock}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor={colors.ink4}
              keyboardType="email-address"
              autoComplete="email"
              autoCapitalize="none"
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.ink }]}
            />
            <Pressable
              accessibilityRole="button"
              disabled={sending}
              onPress={() => void sendCode()}
              style={[styles.primary, { backgroundColor: colors.accent, opacity: sending ? 0.6 : 1 }]}
            >
              <Text style={[styles.primaryLabel, { color: colors.onAccent }]}>Send code</Text>
            </Pressable>
          </View>
        ) : null}

        {message ? <Text style={[styles.message, { color: colors.danger }]}>{message}</Text> : null}
      </View>

      <Text style={[styles.footer, { color: colors.ink3 }]}>By continuing you agree to the Terms and Privacy Policy.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16, paddingTop: 96, paddingBottom: 40, justifyContent: "space-between" },
  top: { gap: 16 },
  wordmark: { fontSize: 18, fontWeight: "700" },
  headline: { fontSize: 34, fontWeight: "700", lineHeight: 40 },
  body: { fontSize: 17, lineHeight: 24 },
  actions: { gap: 12 },
  apple: { width: "100%", height: 52 },
  secondary: { height: 52, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  secondaryLabel: { fontSize: 17, fontWeight: "600" },
  emailBlock: { gap: 12 },
  input: { height: 52, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 17 },
  primary: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontSize: 17, fontWeight: "600" },
  message: { fontSize: 15, lineHeight: 20 },
  footer: { fontSize: 13, lineHeight: 18, textAlign: "center" },
});
