import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { cleanHelp, type HelpDraft } from "../../core/study/drafts.ts";
import { problemOf, typedProblemOf } from "../../core/study/help.ts";
import { getDb } from "../../platform/db.ts";
import { getAvailability, helpWithProblem } from "../../../modules/waypoint-model/index.ts";
import { Body, PrimaryButton, Screen, SecondaryButton } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { ModelUnavailable } from "./ModelUnavailable.tsx";
import { StepByStep } from "./StepByStep.tsx";

function isDeclined(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "declined";
}

// Help on one problem, worked out on this iPhone. When that can't be done, or for a second opinion, "Help with the
// cloud" opens the cloud screen for the same problem (it shows the price first).
export default function HelpStepsScreen() {
  const colors = useColors();
  // A problem is either a block the page's text found (block) or one the student typed in (text).
  const { sessionId, captureId, block, text } = useLocalSearchParams<{ sessionId: string; captureId: string; block?: string; text?: string }>();
  const [availability] = useState(getAvailability);
  const [problem] = useState(() => (text === undefined ? problemOf(getDb(), captureId, Number(block)) : typedProblemOf(getDb(), captureId, text)));
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<"working" | "failed" | "declined" | "ready">("working");
  const [draft, setDraft] = useState<HelpDraft | null>(null);

  useEffect(() => {
    if (availability !== "available" || problem === null) return;
    const target = problem;
    let active = true;
    setOutcome("working");
    async function run() {
      try {
        const cleaned = cleanHelp(await helpWithProblem(target.text, target.context));
        if (!active) return;
        if (cleaned === null) {
          setOutcome("failed");
          return;
        }
        setDraft(cleaned);
        setOutcome("ready");
      } catch (error) {
        if (active) setOutcome(isDeclined(error) ? "declined" : "failed");
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [attempt, availability, problem]);

  const cloudHref = `/study/help-cloud?sessionId=${encodeURIComponent(sessionId)}&captureId=${encodeURIComponent(captureId)}${
    text === undefined ? `&block=${block ?? ""}` : `&text=${encodeURIComponent(text)}`
  }`;
  const cloudButton = <SecondaryButton label="Help with the cloud" icon="cloud" onPress={() => router.push(cloudHref)} />;

  if (availability !== "available") {
    return (
      <Screen>
        <CloseButton />
        <ModelUnavailable availability={availability} />
        {problem !== null ? cloudButton : null}
      </Screen>
    );
  }

  if (problem === null) {
    return (
      <Screen>
        <CloseButton />
        <Body>Couldn't work this one out on this iPhone.</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <CloseButton />
      <View style={[styles.problem, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.problemText, { color: colors.ink }]}>{problem.text}</Text>
      </View>

      {outcome === "working" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Body>Working it out on this iPhone…</Body>
        </View>
      ) : null}
      {outcome === "failed" ? (
        <>
          <Body>Couldn't work this one out on this iPhone.</Body>
          <PrimaryButton label="Try again" onPress={() => setAttempt(attempt + 1)} />
          {cloudButton}
        </>
      ) : null}
      {outcome === "declined" ? (
        <>
          <Body>This problem can't be answered here.</Body>
          {cloudButton}
        </>
      ) : null}

      {outcome === "ready" && draft !== null ? <StepByStep key={attempt} draft={draft} onAnother={() => backToPick(sessionId)} after={cloudButton} /> : null}
    </Screen>
  );
}

// The problem list for this session. Steps are pushed from it, so going back lands there; a deep link has no list under it.
function backToPick(sessionId: string) {
  if (router.canGoBack()) router.back();
  else router.replace(`/study/help?sessionId=${sessionId}`);
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
  center: { alignItems: "center", gap: 12, paddingTop: 24 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  problem: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  problemText: { fontFamily: "Georgia", fontSize: 22, fontWeight: "700", lineHeight: 30 },
});
