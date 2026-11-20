import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { creditsLabel } from "../../core/config/config.ts";
import { TASK_LABELS, getSent, sentFields } from "../../core/explain/sent.ts";
import { shortDate } from "../../core/store/plans.ts";
import { useQuery } from "../../platform/db.ts";
import { Caption, OnDeviceNote, PrimaryButton, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { CloudLine } from "./CloudLine.tsx";

// "What was sent" for one cloud task: exactly the text that left the phone, from sent_log.
export default function SentScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const entry = useQuery((db) => getSent(db, id));
  if (entry === null) {
    return (
      <Screen>
        <Title>What was sent</Title>
        <Caption>This record was deleted with its recording.</Caption>
        <PrimaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }
  const charged = entry.credits === null ? "Waiting for the answer" : entry.credits === 0 ? "Not charged" : creditsLabel(entry.credits);
  return (
    <Screen>
      <Title>What was sent</Title>
      <Caption>{`${TASK_LABELS[entry.task] ?? entry.task} · ${shortDate(entry.at, -new Date().getTimezoneOffset())} · ${charged}`}</Caption>
      {entry.retention !== null ? <CloudLine retention={entry.retention} /> : null}
      {sentFields(entry.sent).map((field) => (
        <View key={field.label} style={styles.field}>
          <Caption>{field.label}</Caption>
          <Text selectable style={[styles.text, { color: colors.ink, backgroundColor: colors.surface2 }]}>
            {field.text}
          </Text>
        </View>
      ))}
      <OnDeviceNote text="This record is kept only on this iPhone." />
      <PrimaryButton label="Done" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  text: { fontSize: 15, lineHeight: 21, padding: 12, borderRadius: 12 },
});
