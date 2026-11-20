import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { DeviceStatus } from "../core/device/registration.ts";
import { refreshDeviceNow, useDeviceStatus } from "../platform/device.ts";
import { askForPush } from "../platform/push.ts";
import { Body, Caption, OnDeviceNote, PrimaryButton, Screen, SecondaryButton, Title } from "../ui/kit.tsx";
import { useColors } from "../ui/theme.ts";

// Shown when a paid action needs an approved device and this iPhone is not one (yet).
export default function DeviceWaitingScreen() {
  const colors = useColors();
  const status = useDeviceStatus();
  const [checking, setChecking] = useState(false);
  const [notify, setNotify] = useState<"ask" | "on" | "off">("ask");

  async function checkAgain(): Promise<void> {
    setChecking(true);
    await refreshDeviceNow();
    setChecking(false);
  }

  const copy = COPY[status];
  return (
    <Screen>
      <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
        <SymbolView name={status === "approved" ? "checkmark.shield.fill" : "lock.shield"} tintColor={colors.accent} size={40} />
      </View>
      <Title>{copy.title}</Title>
      <Body>{copy.body}</Body>
      {copy.caption !== "" ? <Caption>{copy.caption}</Caption> : null}
      <OnDeviceNote text="Everything on this iPhone keeps working: recording, pages, flashcards and search." />
      <View style={styles.actions}>
        {status === "approved" ? (
          <PrimaryButton label="Done" onPress={() => router.back()} />
        ) : (
          <PrimaryButton label={checking ? "Checking…" : "Check again"} onPress={() => void checkAgain()} />
        )}
        {status === "waiting" && notify === "ask" ? (
          <SecondaryButton label="Notify me when it's approved" icon="bell" onPress={() => void askForPush().then((ok) => setNotify(ok ? "on" : "off"))} />
        ) : null}
        {status === "waiting" && notify === "on" ? <Caption>We'll let you know.</Caption> : null}
        {status === "waiting" && notify === "off" ? <Caption>Notifications are off. Turn them on in Settings to hear when it's approved.</Caption> : null}
        {status === "approved" ? null : <SecondaryButton label="Close" onPress={() => router.back()} />}
      </View>
    </Screen>
  );
}

const COPY: Record<DeviceStatus, { title: string; body: string; caption: string }> = {
  waiting: {
    title: "This iPhone needs approval",
    body: "Your Waypoint account is already set up on another iPhone or iPad. That device needs to approve this one before it can use credits.",
    caption: "Approving from your other device comes in a later update.",
  },
  checking: { title: "Setting up this iPhone", body: "Waypoint is getting this iPhone ready to use credits.", caption: "" },
  offline: { title: "You're offline", body: "Connect to the internet so Waypoint can set up this iPhone for credits.", caption: "" },
  too_many_waiting: { title: "Too many devices waiting", body: "Three devices are already waiting for approval. Try again in 10 minutes.", caption: "" },
  signed_out: { title: "Sign in to use credits", body: "Credits belong to your Waypoint account.", caption: "" },
  approved: { title: "This iPhone is ready", body: "It can use credits now.", caption: "" },
};

const styles = StyleSheet.create({
  badge: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  actions: { gap: 12, marginTop: 24 },
});
