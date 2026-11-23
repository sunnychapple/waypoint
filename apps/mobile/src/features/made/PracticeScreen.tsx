import { useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { getSession } from "../../core/capture/sessions.ts";
import { spaceGroups } from "../../core/groups/groups.ts";
import { getMade } from "../../core/made/made.ts";
import { grade, practiceCards, score, type Grade, type PracticeQuestion } from "../../core/made/practice.ts";
import { saveCards } from "../../core/study/cards.ts";
import { useQuery, writeDb } from "../../platform/db.ts";
import { Body, BackButton, Caption, PrimaryButton, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

type Answer = { given: string | number; verdict: Grade };

// Practises one saved practice set on this iPhone. Nothing is sent while practising; the answers stay on screen.
export default function PracticeScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useQuery((db) => getMade(db, id), id);
  const questions = item?.kind === "practice" ? item.body.questions : [];
  const [order, setOrder] = useState<number[]>(() => questions.map((_, i) => i));
  const [grades, setGrades] = useState<Grade[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [typed, setTyped] = useState("");
  const [needsAnswer, setNeedsAnswer] = useState(false);
  const [added, setAdded] = useState<number | null>(null);

  if (item === null || item.kind !== "practice") {
    return (
      <Screen>
        <BackButton />
        <Title>Couldn't open this practice set.</Title>
        <SecondaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  const total = order.length;

  if (grades.length === total) {
    const result = score(grades);
    return (
      <Screen>
        <BackButton />
        <Title>{`${result.right} of ${result.total} right`}</Title>
        <PrimaryButton
          label="Try again"
          onPress={() => {
            setOrder([...order].sort(() => Math.random() - 0.5));
            setGrades([]);
            setAnswer(null);
            setTyped("");
          }}
        />
        <AddToCards sessionId={item.sessionId} questions={questions} added={added} onAdded={setAdded} />
        <SecondaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  const position = grades.length;
  const question = questions[order[position] ?? -1];
  if (question === undefined) return null;
  const last = position === total - 1;

  // Records the answer as its final mark and moves on.
  function finish(mark: Grade) {
    setGrades([...grades, mark]);
    setAnswer(null);
    setTyped("");
    setNeedsAnswer(false);
  }

  // Leaving after answers have been given asks first: the answers so far are not kept.
  function leave() {
    if (grades.length === 0 && answer === null) {
      router.back();
      return;
    }
    Alert.alert("Stop practising?", "Your answers so far won't be saved.", [
      { text: "Cancel", style: "cancel" },
      { text: "Stop", style: "destructive", onPress: () => router.back() },
    ]);
  }

  function checkShort() {
    if (question === undefined || answer !== null) return;
    const verdict = grade(question, typed);
    if (verdict === "wrong") {
      setNeedsAnswer(true);
      return;
    }
    setNeedsAnswer(false);
    setAnswer({ given: typed, verdict });
  }

  return (
    <Screen>
      <BackButton onPress={leave} />
      <Title>{item.body.title}</Title>
      <Caption>{`Question ${position + 1} of ${total}`}</Caption>
      <AddToCards sessionId={item.sessionId} questions={questions} added={added} onAdded={setAdded} />
      <Body style={styles.prompt}>{question.prompt}</Body>

      {question.kind === "multiple_choice" ? (
        <View style={styles.choices}>
          {question.choices.map((choice, index) => {
            const chosen = answer !== null && answer.given === index;
            const isAnswer = index === question.answer;
            const shown = answer === null ? null : isAnswer ? "Answer" : chosen ? "Your answer" : null;
            return (
              <Row
                key={index}
                title={choice}
                selected={chosen}
                right={shown === null ? undefined : <Caption>{shown}</Caption>}
                onPress={
                  answer === null
                    ? () => setAnswer({ given: index, verdict: grade(question, index) })
                    : undefined
                }
              />
            );
          })}
        </View>
      ) : (
        <View style={styles.short}>
          <TextInput
            accessibilityLabel="Your answer"
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              setNeedsAnswer(false);
            }}
            editable={answer === null}
            placeholder="Your answer"
            placeholderTextColor={colors.ink4}
            onSubmitEditing={checkShort}
            style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]}
          />
          {answer === null ? <PrimaryButton label="Check" onPress={checkShort} /> : null}
          {needsAnswer ? <Caption>Type an answer first.</Caption> : null}
        </View>
      )}

      {answer !== null && question.kind === "multiple_choice" ? (
        <Body>{answer.verdict === "right" ? "Right!" : "Not quite."}</Body>
      ) : null}
      {answer !== null && question.kind === "short_answer" && answer.verdict === "right" ? <Body>Right!</Body> : null}
      {answer !== null && question.kind === "short_answer" && answer.verdict === "check" ? (
        <>
          <Body>{`The answer: ${question.answer}`}</Body>
          <PrimaryButton label="I got it" onPress={() => finish("right")} />
          <SecondaryButton label="Not quite" onPress={() => finish("wrong")} />
        </>
      ) : null}
      {answer !== null ? <Caption>{question.explanation}</Caption> : null}
      {answer !== null && answer.verdict !== "check" ? (
        <PrimaryButton label={last ? "See the score" : "Next"} onPress={() => finish(answer.verdict)} />
      ) : null}
    </Screen>
  );
}

// Saves the set as flashcards in its session. Saving twice adds nothing, because a session never repeats a card's front.
function AddToCards({
  sessionId,
  questions,
  added,
  onAdded,
}: {
  sessionId: string | null;
  questions: PracticeQuestion[];
  added: number | null;
  onAdded: (count: number) => void;
}) {
  // A viewer of a shared space cannot change its notes (the server refuses their changes).
  const viewer = useQuery((db) => {
    const session = sessionId === null ? null : getSession(db, sessionId);
    return session !== null && spaceGroups(db).get(session.spaceId)?.role === "viewer";
  }, sessionId ?? "");
  if (sessionId === null || viewer) return null;
  if (added !== null) {
    return (
      <>
        <Caption>{added === 0 ? "These are already in your flashcards." : `Added ${added} to your flashcards.`}</Caption>
        <SecondaryButton label="Practise these" onPress={() => router.push(`/study/review?sessionId=${sessionId}&all=1`)} />
      </>
    );
  }
  return (
    <SecondaryButton
      label="Add to flashcards"
      onPress={() => {
        try {
          onAdded(writeDb((db) => saveCards(db, { now: Date.now, newId: randomUUID }, sessionId, practiceCards(questions), "quiz_miss")).length);
        } catch {
          Alert.alert("Couldn't add these to your flashcards.");
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  prompt: { marginVertical: 12 },
  choices: { gap: 8 },
  short: { gap: 10 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 17 },
});
