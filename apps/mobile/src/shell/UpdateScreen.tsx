import { Linking, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Body, OnDeviceNote, PrimaryButton, Screen, SecondaryButton, Title } from "../ui/kit.tsx";
import { useColors } from "../ui/theme.ts";

const appStoreId = process.env.EXPO_PUBLIC_APP_STORE_ID ?? "";

export default function UpdateScreen() {
  const colors = useColors();
  return (
    <Screen>
      <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
        <SymbolView name="arrow.down.app" tintColor={colors.accent} size={44} />
      </View>
      <Title>Update NotePath</Title>
      <Body>This version of NotePath is too old for the cloud. Update it from the App Store to keep using Explain and credits.</Body>
      <OnDeviceNote text="Everything on this iPhone keeps working: your notes, recording, pages, flashcards and search." />
      {/^\d+$/.test(appStoreId) ? <PrimaryButton label="Open the App Store" onPress={() => void Linking.openURL(`itms-apps://apps.apple.com/app/id${appStoreId}`)} /> : null}
      <SecondaryButton label="Not now" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({ badge: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" } });
