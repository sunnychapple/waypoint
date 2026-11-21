import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { activityLine, needsZeroRetentionClear, sentKeyOf, zeroRetentionShown } from "../../core/cloud/activity.ts";
import { getSent } from "../../core/explain/sent.ts";
import { useQuery } from "../../platform/db.ts";
import { clearStoredZeroRetention, setZeroRetention, useActivity, useStoredZeroRetention, type SwitchResult } from "../../platform/privacy.ts";
import { useWallet } from "../../platform/wallet.ts";
import { CloudLine } from "../../ui/CloudLine.tsx";
import { BackButton, Body, Caption, OnDeviceNote, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const SHOW_ZERO_RETENTION = true;

function resultMessage(result: SwitchResult): string | null {
  switch (result) {
    case "ok":
      return null;
    case "plan_required":
      return "“Don't keep my text” needs Plus.";
    case "offline":
      return "You're offline. Try again when you're connected.";
    case "failed":
      return "Couldn't change it. Try again.";
  }
}

// Settings › Cloud & privacy (J5, K2's Plus switch): the zero-retention switch, and the cloud tasks the server kept a
// record of. The text itself is on this iPhone only, in sent_log.
export default function CloudScreen() {
  const colors = useColors();
  const { wallet } = useWallet();
  const stored = useStoredZeroRetention();
  const activity = useActivity();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const plan = wallet?.plan ?? null;
  const on = zeroRetentionShown(stored, plan);
  useEffect(() => {
    if (needsZeroRetentionClear(stored, plan)) clearStoredZeroRetention();
  }, [stored, plan]);
  const keys = activity.items.map((item) => sentKeyOf(item.id)).filter((key): key is string => key !== null);
  const localKeys = useQuery((db) => new Set(keys.filter((key) => getSent(db, key) !== null)), keys.join(","));

  async function change(enabled: boolean) {
    setBusy(true);
    setMessage(null);
    const result = await setZeroRetention(enabled);
    setBusy(false);
    setMessage(resultMessage(result));
  }

  function askToTurnOn() {
    Alert.alert(
      "Turn on “Don't keep my text”?",
      "Cloud tasks will use only AI providers that keep nothing of what you send. None is available yet, so Explain and every other cloud task will stop working until one is.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Turn on", onPress: () => void change(true) },
      ],
    );
  }

  return (
    <Screen>
      <BackButton />
      <Title>Cloud & privacy</Title>
      <Body>Recording, pages, flashcards, quizzes and search never leave this iPhone. Only the cloud tasks you tap send text, and only for that task.</Body>

      {SHOW_ZERO_RETENTION ? (
        <>
          <Caption style={styles.section}>DON'T KEEP MY TEXT</Caption>
          <Row
            title="Don't keep my text"
            subtitle="AI providers keep nothing of what you send."
            right={
              <Switch
                accessibilityLabel="Don't keep my text"
                value={on}
                disabled={plan !== "plus" || busy}
                onValueChange={(value) => (value ? askToTurnOn() : void change(false))}
                trackColor={{ true: colors.accent, false: colors.line }}
              />
            }
          />
          {plan !== "plus" ? (
            <View style={styles.inline}>
              <Caption>Plus only.</Caption>
              <Pressable accessibilityRole="button" onPress={() => router.push("/plans")} style={styles.textButton}>
                <Text style={[styles.textButtonLabel, { color: colors.accent }]}>See Plus</Text>
              </Pressable>
            </View>
          ) : on ? (
            <View style={[styles.warning, { backgroundColor: colors.flagSoft }]}>
              <Text style={[styles.warningText, { color: colors.flagInk }]}>
                “Don't keep my text” is on. No AI provider that keeps nothing is available yet, so Explain and other cloud tasks won't work until one is. Everything on this iPhone keeps working.
              </Text>
            </View>
          ) : (
            <Caption>Cloud tasks use open models that keep your text only while they answer.</Caption>
          )}
          {message !== null ? <Caption>{message}</Caption> : null}
        </>
      ) : null}

      <Caption style={styles.section}>CLOUD ACTIVITY</Caption>
      {activity.items.map((item) => {
        const line = activityLine(item, -new Date().getTimezoneOffset());
        const key = sentKeyOf(item.id);
        const onDevice = key !== null && localKeys.has(key);
        return (
          <View key={item.id} style={styles.item}>
            <Row
              title={line.title}
              subtitle={line.detail}
              right={onDevice ? <Caption style={{ color: colors.accent }}>See what was sent</Caption> : <Caption>What was sent isn't on this iPhone.</Caption>}
              onPress={onDevice ? () => router.push(`/sent?id=${key}`) : undefined}
            />
            <View style={styles.cloud}>
              <CloudLine retention={line.retention} />
            </View>
          </View>
        );
      })}
      {activity.items.length === 0 && activity.error === null ? <Caption>No cloud tasks yet.</Caption> : null}
      {activity.error === "offline" ? <Caption>Can't load activity offline.</Caption> : null}
      {activity.error === "failed" ? <Caption>Couldn't load activity.</Caption> : null}
      {activity.more ? (
        <Pressable accessibilityRole="button" onPress={activity.loadMore} style={styles.textButton}>
          <Text style={[styles.textButtonLabel, { color: colors.accent }]}>Show more</Text>
        </Pressable>
      ) : null}

      <OnDeviceNote text="The text you send is kept only on this iPhone. NotePath's server keeps the task, its size, the credits and the time." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, letterSpacing: 0.5 },
  inline: { flexDirection: "row", alignItems: "center", gap: 12 },
  warning: { padding: 12, borderRadius: 12 },
  warningText: { fontSize: 14, lineHeight: 20 },
  item: { gap: 6 },
  cloud: { paddingHorizontal: 16 },
  textButton: { minHeight: 44, justifyContent: "center" },
  textButtonLabel: { fontSize: 17, fontWeight: "600" },
});
