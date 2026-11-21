import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { wordsMatch, pickPositions } from "../../core/device/recovery.ts";
import type { MadeRecoveryKey } from "../../../modules/waypoint-keys/index.ts";
import { newRecoveryKey, saveRecoveryKey } from "../../platform/recovery.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

type Step = "intro" | "words" | "check" | "done";

// The words live only in this screen's state: never stored, logged or passed anywhere but the native check.
export default function RecoveryWordsScreen() {
  const colors = useColors();
  const [step, setStep] = useState<Step>("intro");
  const [made, setMade] = useState<MadeRecoveryKey | null>(null);
  const [positions, setPositions] = useState<number[]>([]);
  const [typed, setTyped] = useState<string[]>(["", "", ""]);
  const [caption, setCaption] = useState("");
  const [mismatch, setMismatch] = useState(false);

  async function showWords(): Promise<void> {
    setCaption("");
    try {
      setMade(await newRecoveryKey());
      setStep("words");
    } catch {
      setCaption("Couldn't make a recovery key. Try again.");
    }
  }

  function startCheck(): void {
    setPositions(pickPositions(Math.random));
    setTyped(["", "", ""]);
    setMismatch(false);
    setCaption("");
    setStep("check");
  }

  function showWordsAgain(): void {
    setMismatch(false);
    setCaption("");
    setStep("words");
  }

  async function check(): Promise<void> {
    if (made === null) return;
    if (!wordsMatch(made.words, positions, typed)) {
      setMismatch(true);
      setCaption("That doesn't match. Look at your paper and try again.");
      return;
    }
    const result = await saveRecoveryKey(made);
    if (result === "saved") {
      setStep("done");
    } else if (result === "offline") {
      setCaption("You're offline. Connect and tap Check again.");
    } else if (result === "changed") {
      setMade(null);
      setCaption("Your account changed on another device. Start again.");
      setStep("intro");
    } else {
      setCaption("Couldn't save. Try again.");
    }
  }

  if (step === "intro") {
    return (
      <Screen>
        <Title>Your recovery key</Title>
        <Body>
          12 words that get you back into NotePath if you lose this iPhone. Write them on paper and keep it somewhere safe, like with your school things at
          home.
        </Body>
        <Caption>NotePath can't see these words and can't send them to you again.</Caption>
        {caption !== "" ? <Caption>{caption}</Caption> : null}
        <View style={styles.actions}>
          <PrimaryButton label="Show my words" onPress={() => void showWords()} />
          <SecondaryButton label="Later" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  if (step === "words" && made !== null) {
    return (
      <Screen>
        <Title>Write these down</Title>
        <View style={styles.grid}>
          {made.words.map((word, i) => (
            <Text key={i} selectable={false} style={[styles.word, { color: colors.ink }]}>
              {`${i + 1}. ${word}`}
            </Text>
          ))}
        </View>
        <Caption>In this order. Anyone with these words can open your notes.</Caption>
        <View style={styles.actions}>
          <PrimaryButton label="I wrote them down" onPress={startCheck} />
        </View>
      </Screen>
    );
  }

  if (step === "check") {
    return (
      <Screen>
        <Title>Check your words</Title>
        {positions.map((p, i) => (
          <View key={p} style={styles.field}>
            <Caption>{`Word ${p + 1}`}</Caption>
            <TextInput
              value={typed[i] ?? ""}
              onChangeText={(text) => setTyped((list) => list.map((old, j) => (j === i ? text : old)))}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="none"
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.ink }]}
            />
          </View>
        ))}
        {caption !== "" ? <Caption>{caption}</Caption> : null}
        <View style={styles.actions}>
          <PrimaryButton label="Check" onPress={() => void check()} />
          {mismatch ? <SecondaryButton label="Show the words again" onPress={showWordsAgain} /> : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Recovery key saved</Title>
      <Body>Keep the paper safe. You'll need it only if you lose all your devices.</Body>
      <View style={styles.actions}>
        <PrimaryButton label="Done" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 16 },
  word: { width: "50%", fontSize: 20, lineHeight: 36 },
  field: { marginTop: 12, gap: 6 },
  input: { height: 52, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, fontSize: 17 },
  actions: { gap: 12, marginTop: 24 },
});
