import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { approveWaiting, pollApproval, removeDevice, type ApprovalView } from "../../platform/devices.ts";
import { BackButton, Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// Approve a new device (docs/security.md section 8). Both screens show the same code; the person compares them.
export default function ApproveDeviceScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [view, setView] = useState<ApprovalView | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "removed" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Checks at once and every 2 s while the screen is open, until the request has an answer to show.
  useFocusEffect(
    useCallback(() => {
      let stopped = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const stop = (): void => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
      };
      const tick = async (): Promise<void> => {
        try {
          const next = await pollApproval(id);
          if (stopped) return;
          setView(next);
          if (next.kind !== "waiting_reveal") stop();
        } catch {
          // Tried again in 2 s.
        }
      };
      void tick();
      timer = setInterval(() => void tick(), 2_000);
      return () => {
        stopped = true;
        stop();
      };
    }, [id]),
  );

  async function approve(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await approveWaiting(id);
      setDone("approved");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "no_account_key") {
        setProblem("This iPhone can't approve devices. Use another device, or the recovery words on the new one.");
      } else {
        setProblem("Couldn't approve it. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await removeDevice(id);
      setDone("removed");
    } catch {
      setProblem("Couldn't remove it. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done === "approved") {
    return (
      <Screen>
        <Title>Approve a new device</Title>
        <Body>Approved. It can use your account now.</Body>
        <View style={styles.actions}>
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }
  if (done === "removed") {
    return (
      <Screen>
        <Title>Approve a new device</Title>
        <Body>Removed. Nothing was shared with it.</Body>
        <View style={styles.actions}>
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <BackButton />
      <Title>Approve a new device</Title>
      {view === null || view.kind === "waiting_reveal" ? (
        <>
          <Body>Open NotePath on the new device. It shows a 6-digit code in a moment.</Body>
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        </>
      ) : null}
      {view?.kind === "code" ? (
        <>
          <Text style={[styles.code, { color: colors.ink }]}>
            {view.code.slice(0, 3)} {view.code.slice(3)}
          </Text>
          <Body>Does the new device show the same code?</Body>
          <View style={styles.actions}>
            <PrimaryButton label={busy ? "Checking…" : "They match"} onPress={() => void approve()} />
            <SecondaryButton label="They don't match" onPress={() => void remove()} />
          </View>
        </>
      ) : null}
      {view?.kind === "mismatch" ? (
        <>
          <Body>Something's wrong with this request. Don't approve it.</Body>
          <View style={styles.actions}>
            <SecondaryButton label="Remove it" onPress={() => void remove()} />
          </View>
        </>
      ) : null}
      {view?.kind === "taken" ? <Body>Another of your devices is approving it.</Body> : null}
      {view?.kind === "expired" ? <Body>This request ran out of time. Start again on the new device.</Body> : null}
      {view?.kind === "lost" ? (
        <>
          <Body>Start again on the new device.</Body>
          <View style={styles.actions}>
            <SecondaryButton label="Remove this request" onPress={() => void remove()} />
          </View>
        </>
      ) : null}
      {view?.kind === "gone" ? <Body>This device was already approved or removed.</Body> : null}
      {problem !== null ? <Caption>{problem}</Caption> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 48, fontWeight: "700", letterSpacing: 2, textAlign: "center", marginTop: 24, fontVariant: ["tabular-nums"] },
  spinner: { marginTop: 24 },
  actions: { gap: 12, marginTop: 24 },
});
