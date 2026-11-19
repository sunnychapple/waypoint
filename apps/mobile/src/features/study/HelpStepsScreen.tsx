import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { SqlDb } from "../../core/db/sql.ts";
import { groupBlocks, parseLines } from "../../core/pages/blocks.ts";
import { cleanHelp } from "../../core/study/drafts.ts";
import { problemContext, showAnswer, showNextStep, startHelp, type HelpState } from "../../core/study/help.ts";
import { getDb } from "../../platform/db.ts";
import { getAvailability, helpWithProblem } from "../../../modules/waypoint-model/index.ts";
import { Body, Caption, PrimaryButton, Screen } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { ModelUnavailable } from "./ModelUnavailable.tsx";

type Problem = { text: string; context: string };

// The problem the student tapped, with the rest of its page for the model. Null when it can't be found.
function problemOf(db: SqlDb, captureId: string, index: number): Problem | null {
  const page = db.get<{ found_text: string | null; found_lines: string | null }>(
    "SELECT found_text, found_lines FROM captures WHERE id = ? AND kind = 'page'",
    [captureId],
  );
  if (page === null || page.found_text === null) return null;
  const block = groupBlocks(parseLines(page.found_lines))[index];
  if (block === undefined) return null;
  return { text: block.text, context: problemContext(page.found_text, block) };
}

function isDeclined(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "declined";
}

// Steps first, the answer last. One step shows at a time, and the answer only after the last step.
export default function HelpStepsScreen() {
  const colors = useColors();
  const { captureId, block } = useLocalSearchParams<{ sessionId: string; captureId: string; block: string }>();
  const [availability] = useState(getAvailability);
  const [problem] = useState(() => problemOf(getDb(), captureId, Number(block)));
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<"working" | "failed" | "declined" | "ready">("working");
  const [help, setHelp] = useState<HelpState | null>(null);

  useEffect(() => {
    if (availability !== "available" || problem === null) return;
    const target = problem;
    let active = true;
    setOutcome("working");
    async function run() {
      try {
        const draft = cleanHelp(await helpWithProblem(target.text, target.context));
        if (!active) return;
        if (draft === null) {
          setOutcome("failed");
          return;
        }
        setHelp(startHelp(draft));
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

  if (availability !== "available") {
    return (
      <Screen>
        <CloseButton />
        <ModelUnavailable availability={availability} />
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
        </>
      ) : null}
      {outcome === "declined" ? <Body>This problem can't be answered here.</Body> : null}

      {outcome === "ready" && help !== null ? (
        <>
          {help.steps.slice(0, help.shown).map((step, index) => (
            <View key={index} style={styles.step}>
              <Caption>{`Step ${index + 1} of ${help.steps.length}`}</Caption>
              <Text style={[styles.stepTitle, { color: colors.ink }]}>{step.title}</Text>
              <Body>{step.detail}</Body>
            </View>
          ))}
          {help.shown < help.steps.length ? <PrimaryButton label="Next step" onPress={() => setHelp(showNextStep(help))} /> : null}
          {help.shown === help.steps.length && !help.answerShown ? (
            <PrimaryButton label="Show the answer" onPress={() => setHelp(showAnswer(help))} />
          ) : null}
          {help.answerShown ? (
            <View style={[styles.answer, { backgroundColor: colors.localSoft }]}>
              <Text style={[styles.answerText, { color: colors.localInk }]}>{help.answer}</Text>
            </View>
          ) : null}
          <Caption style={styles.caption}>Try each step yourself before you look at the next one.</Caption>
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
  center: { alignItems: "center", gap: 12, paddingTop: 24 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  problem: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20 },
  problemText: { fontFamily: "Georgia", fontSize: 22, fontWeight: "700", lineHeight: 30 },
  step: { gap: 6 },
  stepTitle: { fontSize: 19, fontWeight: "700" },
  answer: { borderRadius: 16, padding: 16 },
  answerText: { fontSize: 19, fontWeight: "700", lineHeight: 26 },
  caption: { textAlign: "center" },
});
