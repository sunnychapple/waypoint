import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { failureCopy, keepsKey, type CloudFailure } from "../../core/cloud/failure.ts";
import { creditsLabel } from "../../core/config/config.ts";
import { getJob, jobLine } from "../../core/jobs/jobs.ts";
import { keyForRequest } from "../../core/research/research.ts";
import { cloudHelpDraft, cloudHelpRequest, getCloudHelp } from "../../core/study/cloudHelp.ts";
import { problemOf, typedProblemOf } from "../../core/study/help.ts";
import { useSignOut } from "../../platform/auth.tsx";
import { getDb, useQuery } from "../../platform/db.ts";
import { startCloudHelp } from "../../platform/help.ts";
import { followJob, useQuote } from "../../platform/jobs.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { QuoteBox } from "../../ui/QuoteBox.tsx";
import { useColors } from "../../ui/theme.ts";
import { StepByStep } from "./StepByStep.tsx";

// Help with one problem from NotePath's cloud. Opened from the help screens with the problem (captureId and block, or
// the typed text), or from a finished job with jobId. Nothing is sent until Send is tapped under the price and
// "Show what's sent". The answer shows in the same steps as help made on this iPhone.
export default function HelpCloudScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ sessionId?: string; captureId?: string; block?: string; text?: string; jobId?: string }>();
  const [jobId, setJobId] = useState<string | null>(params.jobId ?? null);
  const job = useQuery((db) => (jobId === null ? null : getJob(db, jobId)), jobId ?? "");
  const saved = useQuery((db) => (jobId === null ? null : getCloudHelp(db, jobId)), jobId ?? "");
  const [problem] = useState(() => {
    const { captureId, block, text } = params;
    if (captureId === undefined) return null;
    return text === undefined ? problemOf(getDb(), captureId, Number(block)) : typedProblemOf(getDb(), captureId, text);
  });
  const sessionId = params.sessionId ?? saved?.sessionId ?? job?.sessionId ?? null;
  const [showSent, setShowSent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<CloudFailure | null>(null);
  // The last failed send that may be sent again with the same key (keepsKey).
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const quote = useQuote(jobId === null && problem !== null ? { task: "problem_help" } : null);
  const signOut = useSignOut();
  const price = quote.quote?.credits ?? null;

  useFocusEffect(
    useCallback(() => {
      if (jobId !== null) void followJob(jobId);
    }, [jobId]),
  );

  async function send(): Promise<void> {
    if (problem === null || sessionId === null || params.captureId === undefined || price === null || starting) return;
    setStarting(true);
    setFailure(null);
    const block = params.text === undefined ? Number(params.block) : null;
    const body = JSON.stringify(cloudHelpRequest(problem));
    const key = keyForRequest(attempt.current, body, () => randomUUID());
    const result = await startCloudHelp(problem, { sessionId, captureId: params.captureId, block }, key);
    setStarting(false);
    if (result.ok) {
      attempt.current = null;
      setJobId(result.jobId);
      return;
    }
    setFailure(result.failure);
    attempt.current = keepsKey(result.failure) ? { key, body } : null;
  }

  // Another try after a failed job: the price is quoted again and Send is tapped again.
  function startOver(): void {
    setJobId(null);
    setFailure(null);
  }

  const shownProblem = problem?.text ?? saved?.problem ?? null;
  const copy = failure === null ? null : failureCopy(failure, "make");
  const draft = saved === null ? null : cloudHelpDraft(saved.result);
  const another = sessionId === null ? null : () => router.dismissTo(`/study/help?sessionId=${encodeURIComponent(sessionId)}`);

  return (
    <Screen>
      <CloseButton />
      <Title>Help with the cloud</Title>
      {shownProblem !== null ? (
        <View style={[styles.problem, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.problemText, { color: colors.ink }]}>{shownProblem}</Text>
        </View>
      ) : null}

      {jobId === null && problem === null ? <Body>Couldn't find this problem on the page.</Body> : null}

      {jobId === null && problem !== null ? (
        <>
          <Caption>NotePath's cloud writes the steps. The problem and the words around it on the page are sent.</Caption>
          <QuoteBox state={quote} onRetry={quote.retry} onShowSent={() => setShowSent((v) => !v)} />
          {showSent ? (
            <ScrollView style={[styles.sent, { backgroundColor: colors.surface2 }]} nestedScrollEnabled>
              <Text style={[styles.sentText, { color: colors.ink3 }]}>{`Problem: ${cloudHelpRequest(problem).problem}`}</Text>
              <Text style={[styles.sentText, { color: colors.ink3 }]}>{`Words around it: ${cloudHelpRequest(problem).text}`}</Text>
            </ScrollView>
          ) : null}
          {copy !== null ? (
            <View style={[styles.box, { backgroundColor: colors.flagSoft }]}>
              <Text style={[styles.boxTitle, { color: colors.flagInk }]}>{copy.title}</Text>
              <Text style={[styles.boxBody, { color: colors.flagInk }]}>{copy.body}</Text>
            </View>
          ) : null}
          <PrimaryButton
            label={price === null ? "Send" : `Send · ${creditsLabel(price)}`}
            icon="cloud"
            disabled={price === null || starting}
            onPress={() => void send()}
          />
          {copy?.signIn === true ? <SecondaryButton label="Sign in again" onPress={() => void signOut()} /> : null}
          {failure?.kind === "out_of_credits" ? <SecondaryButton label="Get credits" onPress={() => router.push(`/plans?need=${failure.shortfall}`)} /> : null}
          {failure?.kind === "device" ? <SecondaryButton label="Approve this iPhone" onPress={() => router.push("/device-waiting")} /> : null}
        </>
      ) : null}

      {job !== null && job.problem === null && (job.state === "queued" || job.state === "running" || (job.state === "succeeded" && saved === null)) ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Body>Working it out in the cloud…</Body>
          <Caption>You can leave this screen. It will be in your cloud jobs.</Caption>
        </View>
      ) : null}
      {job !== null && job.problem === "unreadable" ? <Body>The answer arrived but couldn't be opened on this iPhone.</Body> : null}
      {job !== null && job.problem === null && job.state === "failed" ? (
        <>
          <Body>It didn't work. Nothing was charged.</Body>
          {problem !== null ? <PrimaryButton label="Try again" onPress={startOver} /> : null}
        </>
      ) : null}
      {job !== null && job.state === "cancelled" ? <Body>{jobLine(job)}</Body> : null}

      {saved !== null && draft !== null ? <StepByStep draft={draft} onAnother={another} after={null} /> : null}
      {saved !== null && !saved.result.readable ? (
        <>
          <Body>The cloud couldn't read this problem.</Body>
          <Caption>{saved.result.reason}</Caption>
          <Caption>Only 1 credit was used. Try retaking the page, or type the problem in.</Caption>
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </>
      ) : null}
    </Screen>
  );
}

function CloseButton() {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} style={[styles.close, { backgroundColor: colors.surface }]}>
      <SymbolView name="xmark" tintColor={colors.ink} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  problem: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  problemText: { fontFamily: "Georgia", fontSize: 22, fontWeight: "700", lineHeight: 30 },
  center: { alignItems: "center", gap: 12, paddingTop: 24 },
  sent: { maxHeight: 220, borderRadius: 12, padding: 12 },
  sentText: { fontSize: 14, lineHeight: 20 },
  box: { padding: 14, borderRadius: 14, gap: 4 },
  boxTitle: { fontSize: 16, fontWeight: "700" },
  boxBody: { fontSize: 15, lineHeight: 21 },
});
