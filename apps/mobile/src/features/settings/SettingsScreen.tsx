import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import { SymbolView } from "expo-symbols";
import { downloadSpeechPack, getSpeechStatus, onSpeechPackProgress, type SpeechStatus } from "../../../modules/waypoint-audio/index.ts";
import { getAvailability, type ModelAvailability } from "../../../modules/waypoint-model/index.ts";
import { percentLabel, versionLabel } from "../../core/settings/format.ts";
import { useProfile, useSignOut } from "../../platform/auth.tsx";
import { Caption, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

function appleIntelligenceLabel(availability: ModelAvailability): string {
  switch (availability) {
    case "available":
      return "Ready";
    case "device_not_eligible":
      return "Not on this iPhone";
    case "apple_intelligence_off":
      return "Turned off";
    case "model_not_ready":
      return "Getting ready";
    case "unavailable":
      return "Not available";
  }
}

function speechLabel(speech: SpeechStatus | null, fraction: number | null): string {
  if (speech === null) return "";
  switch (speech.pack) {
    case "installed":
      return `Ready · ${speech.locale}`;
    case "downloading":
      return `Downloading ${percentLabel(fraction ?? 0, 1)}`;
    case "not_installed":
      return "Not downloaded";
    case "unsupported":
      return "Not available for this language";
  }
}

function BackButton() {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={() => router.back()}
      style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <SymbolView name="chevron.left" tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

// Settings (K1): the account, what runs on this iPhone, permissions, storage, the version and sign-out.
export default function SettingsScreen() {
  const colors = useColors();
  const profile = useProfile();
  const signOut = useSignOut();
  const [speech, setSpeech] = useState<SpeechStatus | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);
  const availability = getAvailability();

  useFocusEffect(
    useCallback(() => {
      getSpeechStatus().then(setSpeech, () => setSpeech(null));
    }, []),
  );

  useEffect(() => {
    const subscription = onSpeechPackProgress((e) => setFraction(e.fraction));
    return () => subscription.remove();
  }, []);

  function downloadPack() {
    setFraction(0);
    setSpeech((current) => (current ? { ...current, pack: "downloading" } : current));
    downloadSpeechPack().then(
      (status) => setSpeech(status),
      () => getSpeechStatus().then(setSpeech, () => setSpeech(null)),
    );
  }

  function confirmSignOut() {
    Alert.alert("Sign out of Waypoint?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  }

  return (
    <Screen>
      <BackButton />
      <Title>Settings</Title>

      {profile ? (
        <View style={[styles.account, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={[styles.avatar, { backgroundColor: colors.surface2 }]}>
            <Text style={[styles.avatarText, { color: colors.ink }]}>{profile.initial}</Text>
          </View>
          <View style={styles.accountText}>
            <Text style={[styles.name, { color: colors.ink }]}>{profile.firstName}</Text>
            <Caption>{profile.email}</Caption>
            {profile.viaApple ? (
              <View style={styles.apple}>
                <SymbolView name="apple.logo" tintColor={colors.ink3} size={12} />
                <Caption>Signed in with Apple</Caption>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <Caption style={styles.section}>ON THIS IPHONE</Caption>
      <Row
        title="Speech pack"
        right={<Caption>{speechLabel(speech, fraction)}</Caption>}
        onPress={speech?.pack === "not_installed" ? downloadPack : undefined}
      />
      <Row title="Apple Intelligence" right={<Caption>{appleIntelligenceLabel(availability)}</Caption>} />
      <Link title="Permissions" onPress={() => router.push("/settings-permissions")} />
      <Link title="Storage & search" onPress={() => router.push("/settings-storage")} />

      <Caption style={styles.section}>ABOUT</Caption>
      <Row title={versionLabel(Constants.expoConfig?.version ?? null, Constants.nativeBuildVersion)} />

      <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={confirmSignOut} style={styles.signOut}>
        <Text style={[styles.signOutText, { color: colors.danger }]}>Sign out</Text>
      </Pressable>
      <Caption style={styles.center}>Signing out doesn't delete your notes.</Caption>
    </Screen>
  );
}

function Link({ title, onPress }: { title: string; onPress: () => void }) {
  const colors = useColors();
  return <Row title={title} onPress={onPress} right={<SymbolView name="chevron.right" tintColor={colors.ink3} size={14} />} />;
}

const styles = StyleSheet.create({
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  account: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 24, fontWeight: "600" },
  accountText: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: "700" },
  apple: { flexDirection: "row", alignItems: "center", gap: 4 },
  section: { marginTop: 8, letterSpacing: 0.5 },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16, minHeight: 44 },
  signOutText: { fontSize: 17, fontWeight: "600" },
  center: { textAlign: "center" },
});
