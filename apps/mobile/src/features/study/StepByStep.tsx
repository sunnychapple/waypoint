import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { HelpDraft } from "../../core/study/drafts.ts";
import { showAnswer, showNextStep, startHelp } from "../../core/study/help.ts";
import { Body, Caption, PrimaryButton, SecondaryButton } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// Steps first, the answer last. One step shows at a time, and the answer only after the last step. The same steps for
// help made on this iPhone and help from the cloud. onAnother: "Help with another problem"; after: shown under the
// buttons once the answer is shown. A new draft needs a new key, because the steps start again.
export function StepByStep({ draft, onAnother, after }: { draft: HelpDraft; onAnother: (() => void) | null; after: ReactNode }) {
  const colors = useColors();
  const [help, setHelp] = useState(() => startHelp(draft));
  return (
    <>
      {help.steps.slice(0, help.shown).map((step, index) => (
        <View key={index} style={styles.step}>
          <Caption>{`Step ${index + 1} of ${help.steps.length}`}</Caption>
          <Text style={[styles.stepTitle, { color: colors.ink }]}>{step.title}</Text>
          <Body>{step.detail}</Body>
        </View>
      ))}
      {help.shown < help.steps.length ? <PrimaryButton label="Next step" onPress={() => setHelp(showNextStep(help))} /> : null}
      {help.shown === help.steps.length && !help.answerShown ? <PrimaryButton label="Show the answer" onPress={() => setHelp(showAnswer(help))} /> : null}
      {help.answerShown ? (
        <View style={[styles.answer, { backgroundColor: colors.localSoft }]}>
          <Text style={[styles.answerText, { color: colors.localInk }]}>{help.answer}</Text>
        </View>
      ) : null}
      <Caption style={styles.caption}>Try each step yourself before you look at the next one.</Caption>
      {help.answerShown ? (
        <>
          <PrimaryButton label="Done" onPress={() => router.back()} />
          {onAnother !== null ? <SecondaryButton label="Help with another problem" onPress={onAnother} /> : null}
          {after}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  step: { gap: 6 },
  stepTitle: { fontSize: 19, fontWeight: "700" },
  answer: { borderRadius: 16, padding: 16 },
  answerText: { fontSize: 19, fontWeight: "700", lineHeight: 26 },
  caption: { textAlign: "center" },
});
