import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { failureCopy, type FailureAction } from "../../core/cloud/failure.ts";
import { creditsLabel, priceOf } from "../../core/config/config.ts";
import { verdictOf, type ThreadItem } from "../../core/explain/explanations.ts";
import type { InstantSentTask } from "../../core/explain/sent.ts";
import { formatOffset } from "../../core/format.ts";
import { useConfig } from "../../platform/config.ts";
import { Body, Caption, PrimaryButton, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors, type Colors } from "../../ui/theme.ts";
import { CloudLine } from "../../ui/CloudLine.tsx";
import { useExplain } from "./useExplain.ts";

// D1–D8: a tapped word, explained by the cloud, with more detail, a double-check and Save. Opened as a sheet over the
// recording or the session.
export default function ExplainSheet() {
  const params = useLocalSearchParams<{ sessionId: string; t: string; word: string }>();
  const t = Number(params.t);
  return <ExplainBody sessionId={params.sessionId} t={Number.isFinite(t) ? t : 0} word={params.word.slice(0, 100)} />;
}

const HEADINGS: Record<InstantSentTask, string> = { explain: "Explanation", more_detail: "More detail", double_check: "Double-check" };
const RUNNING: Record<InstantSentTask, string> = { explain: "Explaining…", more_detail: "Adding more detail…", double_check: "Double-checking…" };
// Used only until the live price table (M13) has loaded.
const FALLBACK_PRICES: Record<InstantSentTask, number> = { explain: 1, more_detail: 3, double_check: 4 };

function ExplainBody({ sessionId, t, word }: { sessionId: string; t: number; word: string }) {
  const colors = useColors();
  const config = useConfig();
  const model = useExplain(sessionId, t, word);
  const [showSent, setShowSent] = useState(false);
  const { phase, explanation, unsavedItem, offerResearch } = model;
  const thread = explanation?.thread ?? [];
  const hasAnswer = thread.some((item) => item.kind === "explain");
  const explained = hasAnswer || unsavedItem?.kind === "explain";
  const cost = (task: InstantSentTask): string => creditsLabel(priceOf(config, task) ?? FALLBACK_PRICES[task]);

  // A "Try again" after "already finished" starts a new paid request, so the button says what it costs.
  function actionLabel(action: FailureAction): string {
    if (action === "try_again" && phase.kind === "failed" && phase.failure.kind === "already_finished") {
      return phase.task === "explain" ? `Explain again · ${cost("explain")}` : `Try again · ${cost(phase.task)}`;
    }
    return ACTION_LABELS[action];
  }

  function act(action: FailureAction): void {
    if (action === "try_again" && phase.kind === "failed") void model.run(phase.task);
    else if (action === "get_credits" && phase.kind === "failed" && phase.failure.kind === "out_of_credits") router.push(`/plans?need=${phase.failure.shortfall}`);
    else if (action === "ask_later") model.saveForLater();
    else if (action === "approve_device") router.push("/device-waiting");
    else router.back();
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Title>{word}</Title>
      <Caption>{`At ${formatOffset(t)} in this recording`}</Caption>

      {phase.kind === "idle" && !explained ? (
        model.excerpt === "" ? (
          <Body>There isn't enough of the transcript around this word yet.</Body>
        ) : (
          <>
            <Body style={{ color: colors.ink2 }}>Waypoint sends this word and about a minute of the transcript around it, for this task only.</Body>
            <Pressable accessibilityRole="button" onPress={() => setShowSent((v) => !v)}>
              <Text style={[styles.link, { color: colors.accent }]}>{showSent ? "Hide what's sent" : "Show what's sent"}</Text>
            </Pressable>
            {showSent ? <Text style={[styles.sent, { color: colors.ink3, backgroundColor: colors.surface2 }]}>{model.excerpt}</Text> : null}
            <PrimaryButton label={`Explain · ${cost("explain")}`} icon="sparkle.magnifyingglass" onPress={() => void model.run("explain")} />
          </>
        )
      ) : null}

      {thread.map((item, index) => (
        <ThreadBlock key={`${item.sentId}-${index}`} item={item} colors={colors} />
      ))}

      {unsavedItem !== null ? (
        <View style={styles.block}>
          <ThreadBlock item={unsavedItem} colors={colors} />
          <Caption>Couldn't save this on the iPhone</Caption>
        </View>
      ) : null}

      {phase.kind === "running" ? (
        <View style={styles.block}>
          <Caption>{HEADINGS[phase.task]}</Caption>
          {phase.text === "" ? <ActivityIndicator /> : <Body>{phase.text}</Body>}
          <Caption>{RUNNING[phase.task]}</Caption>
        </View>
      ) : null}

      {phase.kind === "failed" ? (
        <View style={styles.block}>
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

      {phase.kind === "idle" && explained ? (
        <View style={styles.block}>
          {offerResearch ? (
            <SecondaryButton
              label="Research the web"
              icon="globe"
              onPress={() => router.push(`/research/new?sessionId=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(`What is ${word}?`)}`)}
            />
          ) : null}
          {hasAnswer ? (
            <>
              <SecondaryButton label={`More detail · ${cost("more_detail")}`} icon="text.append" onPress={() => void model.run("more_detail")} />
              <SecondaryButton label={`Double-check · ${cost("double_check")}`} icon="checkmark.seal" onPress={() => void model.run("double_check")} />
              <SecondaryButton
                label={explanation?.saved === true ? "Saved" : "Save"}
                icon={explanation?.saved === true ? "bookmark.fill" : "bookmark"}
                tone={explanation?.saved === true ? "accent" : "surface"}
                onPress={model.toggleSave}
              />
              {explanation?.saved === true ? <Caption>Saved with this recording.</Caption> : null}
            </>
          ) : null}
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function ThreadBlock({ item, colors }: { item: ThreadItem; colors: Colors }) {
  const verdict = item.kind === "double_check" ? verdictOf(item.text) : null;
  const tint = verdict === "correct" ? colors.local : verdict === "partly" ? colors.flag : verdict === "not" ? colors.danger : null;
  return (
    <View style={styles.block}>
      <Caption>{HEADINGS[item.kind]}</Caption>
      <View style={tint === null ? undefined : [styles.verdict, { borderColor: tint }]}>
        <Body>{item.text}</Body>
      </View>
      <CloudLine retention={item.retention} onPress={() => router.push(`/sent?id=${encodeURIComponent(item.sentId)}`)} />
    </View>
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
  block: { gap: 10 },
  link: { fontSize: 15, fontWeight: "600" },
  sent: { fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 12 },
  box: { padding: 14, borderRadius: 14, gap: 4 },
  boxTitle: { fontSize: 16, fontWeight: "700" },
  boxBody: { fontSize: 15, lineHeight: 21 },
  verdict: { borderLeftWidth: 4, paddingLeft: 12 },
});
