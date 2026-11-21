import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { DeviceStatus } from "../core/device/registration.ts";
import { refreshDeviceNow, startPairingAgain, useDeviceStatus, usePairing } from "../platform/device.ts";
import { askForPush } from "../platform/push.ts";
import { Body, Caption, OnDeviceNote, PrimaryButton, Screen, SecondaryButton, Title } from "../ui/kit.tsx";
import { useColors } from "../ui/theme.ts";

// Shown when a paid action needs an approved device and this iPhone is not one (yet).
export default function DeviceWaitingScreen() {
  const colors = useColors();
  const status = useDeviceStatus();
  const pairing = usePairing();
  const [checking, setChecking] = useState(false);
  const [notify, setNotify] = useState<"ask" | "on" | "off">("ask");
  const restart = status === "waiting" && pairing.kind === "expired";

  async function checkAgain(): Promise<void> {
    setChecking(true);
    await (restart ? startPairingAgain() : refreshDeviceNow());
    setChecking(false);
  }

  const copy = COPY[status];
  const body =
    status !== "waiting" ? copy.body : restart ? "This request ran out of time." : "Open NotePath on your other iPhone or iPad, go to Settings › Devices, and approve this one.";
  return (
    <Screen>
      <View style={[styles.badge, { backgroundColor: colors.accentSoft }]}>
        <SymbolView name={status === "approved" ? "checkmark.shield.fill" : "lock.shield"} tintColor={colors.accent} size={40} />
      </View>
      <Title>{copy.title}</Title>
      <Body>{body}</Body>
      {status === "waiting" && pairing.kind === "code" ? (
        <View style={styles.codeBlock}>
          <Caption>Your code</Caption>
          <Text style={[styles.code, { color: colors.ink }]}>
            {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
          </Text>
          <Caption>Check that your other device shows the same code.</Caption>
        </View>
      ) : null}
      {copy.caption !== "" ? <Caption>{copy.caption}</Caption> : null}
      <OnDeviceNote text="Everything on this iPhone keeps working: recording, pages, flashcards and search." />
      <View style={styles.actions}>
        {status === "approved" ? (
          <PrimaryButton label="Done" onPress={() => router.back()} />
        ) : (
          <PrimaryButton label={checking ? "Checking…" : restart ? "Start again" : "Check again"} onPress={() => void checkAgain()} />
        )}
        {status === "waiting" ? <SecondaryButton label="Use my recovery words" icon="key" onPress={() => router.push("/recover")} /> : null}
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
    title: "Approve this iPhone",
    body: "Your NotePath account is already set up on another iPhone or iPad. That device needs to approve this one before it can use credits.",
    caption: "No other device? Use your recovery words.",
  },
  checking: { title: "Approving this iPhone", body: "NotePath is getting this iPhone ready to use credits.", caption: "" },
  offline: { title: "You're offline", body: "Connect to the internet so NotePath can set up this iPhone for credits.", caption: "" },
  failed: { title: "Couldn't approve this iPhone", body: "Something went wrong while getting this iPhone ready for credits.", caption: "Tap Check again to try once more." },
  too_many_waiting: { title: "Too many devices waiting", body: "Three devices are already waiting for approval. Try again in 10 minutes.", caption: "" },
  signed_out: { title: "Sign in to use credits", body: "Credits belong to your NotePath account.", caption: "" },
  approved: { title: "This iPhone is ready", body: "It can use credits now.", caption: "" },
};

const styles = StyleSheet.create({
  badge: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  actions: { gap: 12, marginTop: 24 },
  codeBlock: { gap: 8, marginTop: 16 },
  code: { fontSize: 48, fontWeight: "700", letterSpacing: 2, textAlign: "center", fontVariant: ["tabular-nums"] },
});
