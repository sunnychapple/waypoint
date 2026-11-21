import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { saveCards, sessionCardCount } from "../../core/study/cards.ts";
import { makeCardsFromUnits, type ModelPort } from "../../core/study/generate.ts";
import { studyUnits } from "../../core/study/units.ts";
import { getDb, writeDb } from "../../platform/db.ts";
import { getAvailability, getContextSize, makeCards, makeQuiz } from "../../../modules/waypoint-model/index.ts";
import { Body, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { ModelUnavailable } from "./ModelUnavailable.tsx";

const PORT: ModelPort = { contextSize: getContextSize, makeCards, makeQuiz };

// Makes flashcards from one session on this iPhone, saves them, and goes to the first review.
// A session that already has cards first offers to practise them, or to make more.
export default function MakeCardsScreen() {
  const colors = useColors();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [existing] = useState(() => sessionCardCount(getDb(), sessionId));
  const [making, setMaking] = useState(existing === 0);
  const [availability] = useState(getAvailability);
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<"working" | "failed" | "empty">("working");

  useEffect(() => {
    if (!making || availability !== "available") return;
    let active = true;
    setOutcome("working");
    async function run() {
      try {
        const drafts = await makeCardsFromUnits(PORT, studyUnits(getDb(), sessionId), 12);
        if (!active) return;
        if (drafts.length === 0) {
          setOutcome("empty");
          return;
        }
        writeDb((db) => saveCards(db, { now: Date.now, newId: randomUUID }, sessionId, drafts, "device_model"));
        router.replace(`/study/review?sessionId=${sessionId}&made=1`);
      } catch {
        if (active) setOutcome("failed");
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [attempt, availability, making, sessionId]);

  if (!making) {
    return (
      <Screen>
        <CloseButton />
        <Title>{`You have ${existing} ${existing === 1 ? "card" : "cards"} from this`}</Title>
        <PrimaryButton label="Practise these" onPress={() => router.replace(`/study/review?sessionId=${sessionId}&all=1`)} />
        <SecondaryButton label="Make more" onPress={() => setMaking(true)} />
      </Screen>
    );
  }

  if (availability !== "available") {
    return (
      <Screen>
        <CloseButton />
        <ModelUnavailable availability={availability} />
      </Screen>
    );
  }

  return (
    <Screen>
      <CloseButton />
      {outcome === "working" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Body>Making flashcards on this iPhone…</Body>
        </View>
      ) : null}
      {outcome === "failed" ? (
        <>
          <Title>Couldn't make flashcards this time.</Title>
          <PrimaryButton label="Try again" onPress={() => setAttempt(attempt + 1)} />
        </>
      ) : null}
      {outcome === "empty" ? <Title>There wasn't enough here to make flashcards.</Title> : null}
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
  center: { alignItems: "center", gap: 12, paddingTop: 48 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
