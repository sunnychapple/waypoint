import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { failureCopy, type FailureAction } from "../../core/cloud/failure.ts";
import { creditsLabel, priceOf } from "../../core/config/config.ts";
import { contextCopy } from "../../core/explain/excerpt.ts";
import { verdictOf, type ThreadItem } from "../../core/explain/explanations.ts";
import { guessHeadline, guessLabel, guessSentence } from "../../core/explain/term.ts";
import type { InstantSentTask } from "../../core/explain/sent.ts";
import { formatOffset } from "../../core/format.ts";
import { useSignOut } from "../../platform/auth.tsx";
import { useConfig } from "../../platform/config.ts";
import { useWallet } from "../../platform/wallet.ts";
import { Body, Caption, PrimaryButton, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors, type Colors } from "../../ui/theme.ts";
import { CloudLine } from "../../ui/CloudLine.tsx";
import { useExplain } from "./useExplain.ts";
import { useLikelyTerm } from "./useLikelyTerm.ts";

// D1–D8: a tapped word, explained by the cloud, with more detail, a double-check and Save. Opened as a sheet over the
// recording or the session.
export default function ExplainSheet() {
  const params = useLocalSearchParams<{ sessionId: string; t: string; word: string; flagId?: string; explanationId?: string; page?: string }>();
  const t = Number(params.t);
  const timed = typeof params.t === "string" && params.t !== "" && Number.isFinite(t);
  return (
    <ExplainBody
      sessionId={params.sessionId}
      t={timed ? t : 0}
      timed={timed}
      word={params.word.slice(0, 100)}
      flagId={typeof params.flagId === "string" && params.flagId !== "" ? params.flagId : undefined}
      explanationId={typeof params.explanationId === "string" && params.explanationId !== "" ? params.explanationId : undefined}
      pageId={typeof params.page === "string" && params.page !== "" ? params.page : undefined}
    />
  );
}

const HEADINGS: Record<InstantSentTask, string> = { explain: "What it means here", more_detail: "More detail", double_check: "Double-check" };
const RUNNING: Record<InstantSentTask, string> = { explain: "Explaining…", more_detail: "Adding more detail…", double_check: "Double-checking…" };
// Used only until the live price table (M13) has loaded.
const FALLBACK_PRICES: Record<InstantSentTask, number> = { explain: 1, more_detail: 3, double_check: 4 };

function ExplainBody({
  sessionId,
  t,
  timed,
  word,
  flagId,
  explanationId,
  pageId,
}: {
  sessionId: string;
  t: number;
  timed: boolean;
  word: string;
  flagId?: string | undefined;
  explanationId?: string | undefined;
  pageId?: string | undefined;
}) {
  const colors = useColors();
  const config = useConfig();
  const { wallet } = useWallet();
  const signOut = useSignOut();
  const model = useExplain(sessionId, t, word, flagId, explanationId, pageId);
  const [showSent, setShowSent] = useState(false);
  const { phase, explanation, unsavedItem, offerResearch, pageNumber, pageId: resolvedPageId } = model;
  const likely = useLikelyTerm(sessionId, word, model.excerpt, timed && resolvedPageId === undefined);
  const thread = explanation?.thread ?? [];
  const hasAnswer = thread.some((item) => item.kind === "explain");
  const explained = hasAnswer || unsavedItem?.kind === "explain";
  const failure = phase.kind === "failed" ? failureCopy(phase.failure, "explain") : null;
  // A saved answer reopened with nothing left to send: its page or transcript is gone, so it cannot be explained further.
  const contextGone = explanationId !== undefined && model.excerpt === "";
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open in session"
          onPress={() => router.push(resolvedPageId === undefined ? `/session/${sessionId}?t=${t}` : `/session/${sessionId}?page=${encodeURIComponent(resolvedPageId)}`)}
          style={styles.touch}
        >
          <Text style={[styles.link, { color: colors.accent }]}>Open in session</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={() => router.back()} style={styles.touch}>
          <Text style={[styles.link, { color: colors.accent }]}>Done</Text>
        </Pressable>
      </View>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
        <Title>{word}</Title>
        <Caption>
          {timed && resolvedPageId === undefined
            ? `Said at ${formatOffset(t)}`
            : pageNumber === null
              ? `“${word}”`
              : `“${word}” · on page ${pageNumber}`}
        </Caption>
        {likely.guess !== null ? (
          <View style={[styles.suggest, { backgroundColor: colors.accentSoft }]}>
            <Caption>Suggested</Caption>
            <Text accessibilityLabel={guessLabel(likely.guess)} style={[styles.suggestTitle, { color: colors.ink }]}>
              {guessHeadline(likely.guess)}
            </Text>
            <Body>{guessSentence(likely.guess)}</Body>
            <Caption>A guess from this iPhone. It might be wrong.</Caption>
            <SecondaryButton label="Keep as said" onPress={likely.keep} />
          </View>
        ) : null}

        {phase.kind === "idle" && !explained ? (
          model.excerpt === "" ? (
            <Body>{contextCopy(resolvedPageId !== undefined, word.includes(" ")).missing}</Body>
          ) : model.stillComing ? (
            <Body>Your answer is still on its way. It will be in Questions for later.</Body>
          ) : (
            <>
              <Body style={{ color: colors.ink2 }}>{contextCopy(resolvedPageId !== undefined, word.includes(" ")).sent}</Body>
              <Pressable accessibilityRole="button" onPress={() => setShowSent((v) => !v)}>
                <Text style={[styles.link, { color: colors.accent }]}>{showSent ? "Hide what's sent" : "Show what's sent"}</Text>
              </Pressable>
              {showSent ? <Text style={[styles.sent, { color: colors.ink3, backgroundColor: colors.surface2 }]}>{model.excerpt}</Text> : null}
              <PrimaryButton label={`Explain · ${cost("explain")}`} icon="sparkle.magnifyingglass" onPress={() => void model.run("explain")} />
              <Caption>
                {wallet === null
                  ? `Explain uses ${cost("explain")}.`
                  : `Explain uses ${cost("explain")}. You have ${creditsLabel(wallet.balance.available)}.`}
              </Caption>
            </>
          )
        ) : null}

        {thread.map((item, index) => (
          <ThreadBlock key={`${item.sentId}-${index}`} item={item} colors={colors} />
        ))}
        {hasAnswer ? <Caption>AI can be wrong. Check it with your teacher or text.</Caption> : null}

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
            <Caption>
              {phase.task === "explain" ? `${RUNNING[phase.task]} You can close this. Your answer will be in Questions for later.` : RUNNING[phase.task]}
            </Caption>
          </View>
        ) : null}

        {phase.kind === "failed" ? (
          <View style={styles.block}>
            {phase.text !== "" ? <Body style={{ color: colors.ink3 }}>{phase.text}</Body> : null}
            <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
              <Text style={[styles.boxTitle, { color: colors.flagInk }]}>{failure?.title}</Text>
              <Text style={[styles.boxBody, { color: colors.flagInk }]}>{failure?.body}</Text>
            </View>
            {model.askedLater ? <Caption>Saved as a question for later.</Caption> : null}
            {failure?.signIn === true ? <SecondaryButton label="Sign in again" onPress={() => void signOut()} /> : null}
            {(failure?.actions ?? []).map((action, index) =>
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
                {contextGone ? (
                  <Caption>The page this came from is gone, so it can't be explained further.</Caption>
                ) : (
                  <>
                    <SecondaryButton label={`More detail · ${cost("more_detail")}`} icon="text.append" onPress={() => void model.run("more_detail")} />
                    <SecondaryButton label={`Double-check · ${cost("double_check")}`} icon="checkmark.seal" onPress={() => void model.run("double_check")} />
                  </>
                )}
                <SecondaryButton
                  label={explanation?.saved === true ? "Saved" : "Save"}
                  icon={explanation?.saved === true ? "bookmark.fill" : "bookmark"}
                  tone={explanation?.saved === true ? "accent" : "surface"}
                  onPress={model.toggleSave}
                />
                {explanation?.saved === true ? <Caption>Saved to Questions for later. Tap Saved to remove it.</Caption> : null}
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
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
  approve_device: "Approve this iPhone",
  close: "Close",
};

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingTop: 8 },
  touch: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 8 },
  content: { padding: 20, paddingBottom: 40, gap: 14 },
  block: { gap: 10 },
  link: { fontSize: 15, fontWeight: "600" },
  sent: { fontSize: 14, lineHeight: 20, padding: 12, borderRadius: 12 },
  box: { padding: 14, borderRadius: 14, gap: 4 },
  boxTitle: { fontSize: 16, fontWeight: "700" },
  boxBody: { fontSize: 15, lineHeight: 21 },
  verdict: { borderLeftWidth: 4, paddingLeft: 12 },
  suggest: { padding: 14, borderRadius: 16, gap: 8 },
  suggestTitle: { fontSize: 20, fontWeight: "700" },
});
