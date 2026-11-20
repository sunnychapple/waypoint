import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { failureCopy, type FailureAction } from "../../core/cloud/failure.ts";
import { creditsLabel, priceOf } from "../../core/config/config.ts";
import { formatOffset } from "../../core/format.ts";
import { useConfig } from "../../platform/config.ts";
import { Body, Caption, PrimaryButton, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { CloudLine } from "./CloudLine.tsx";
import { useExplain } from "./useExplain.ts";

// D1–D3: a tapped word, explained by the cloud. Opened as a sheet over the recording or the session.
export default function ExplainSheet() {
  const params = useLocalSearchParams<{ sessionId: string; t: string; word: string }>();
  const t = Number(params.t);
  return <ExplainBody sessionId={params.sessionId} t={Number.isFinite(t) ? t : 0} word={params.word.slice(0, 100)} />;
}

function ExplainBody({ sessionId, t, word }: { sessionId: string; t: number; word: string }) {
  const colors = useColors();
  const config = useConfig();
  const model = useExplain(sessionId, t, word);
  const [showSent, setShowSent] = useState(false);
  const price = priceOf(config, "explain") ?? 1;
  const phase = model.phase;

  // A "Try again" after "already finished" starts a new paid request, so the button says what it costs.
  function actionLabel(action: FailureAction): string {
    if (action === "try_again" && phase.kind === "failed" && phase.failure.kind === "already_finished") return `Explain again · ${creditsLabel(price)}`;
    return ACTION_LABELS[action];
  }

  function act(action: FailureAction): void {
    if (action === "try_again") void model.explain();
    else if (action === "get_credits" && phase.kind === "failed" && phase.failure.kind === "out_of_credits") router.push(`/plans?need=${phase.failure.shortfall}`);
    else if (action === "ask_later") model.saveForLater();
    else if (action === "approve_device") router.push("/device-waiting");
    else router.back();
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Title>{word}</Title>
      <Caption>{`At ${formatOffset(t)} in this recording`}</Caption>

      {phase.kind === "ready" ? (
        <>
          {model.excerpt === "" ? (
            <Body>There isn't enough of the transcript around this word yet.</Body>
          ) : (
            <>
              <Body style={{ color: colors.ink2 }}>Waypoint sends this word and about a minute of the transcript around it, for this task only.</Body>
              <Pressable accessibilityRole="button" onPress={() => setShowSent((v) => !v)}>
                <Text style={[styles.link, { color: colors.accent }]}>{showSent ? "Hide what's sent" : "Show what's sent"}</Text>
              </Pressable>
              {showSent ? <Text style={[styles.sent, { color: colors.ink3, backgroundColor: colors.surface2 }]}>{model.excerpt}</Text> : null}
              <PrimaryButton label={`Explain · ${creditsLabel(price)}`} icon="sparkle.magnifyingglass" onPress={() => void model.explain()} />
            </>
          )}
        </>
      ) : null}

      {phase.kind === "streaming" ? (
        <View style={styles.answer}>
          {phase.text === "" ? <ActivityIndicator /> : <Body>{phase.text}</Body>}
          <Caption>Explaining…</Caption>
        </View>
      ) : null}

      {phase.kind === "done" ? (
        <View style={styles.answer}>
          <Body>{phase.text}</Body>
          <CloudLine retention={phase.retention} />
          {phase.unsaved ? <Caption>Couldn't save this on the iPhone</Caption> : null}
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      ) : null}

      {phase.kind === "failed" ? (
        <View style={styles.answer}>
          {phase.text !== "" ? <Body style={{ color: colors.ink3 }}>{phase.text}</Body> : null}
          <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
            <Text style={[styles.boxTitle, { color: colors.flagInk }]}>{failureCopy(phase.failure).title}</Text>
            <Text style={[styles.boxBody, { color: colors.flagInk }]}>{failureCopy(phase.failure).body}</Text>
          </View>
          {model.askedLater ? <Caption>Saved as a question for later.</Caption> : null}
          {failureCopy(phase.failure).actions.map((action, index) =>
            action === "ask_later" && model.askedLater ? null : index === 0 ? (
              <PrimaryButton key={action} label={actionLabel(action)} onPress={() => act(action)} />
            ) : (
              <SecondaryButton key={action} label={actionLabel(action)} onPress={() => act(action)} />
            ),
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const ACTION_LABELS: Record<FailureAction, string> = {
  try_again: "Try again",
  get_credits: "Get credits",
  ask_later: "Ask later",
  approve_device: "Set up this iPhone",
  close: "Close",
};

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  answer: { gap: 14 },
  link: { fontSize: 15, fontWeight: "600" },
  sent: { fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 12 },
  box: { padding: 14, borderRadius: 14, gap: 4 },
  boxTitle: { fontSize: 16, fontWeight: "700" },
  boxBody: { fontSize: 15, lineHeight: 21 },
});
