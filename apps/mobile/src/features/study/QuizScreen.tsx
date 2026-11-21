import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { getSession } from "../../core/capture/sessions.ts";
import { saveCards } from "../../core/study/cards.ts";
import { pendingCopy, skippedCopy } from "../../core/study/pending.ts";
import { makeQuizFromUnits, type ModelPort } from "../../core/study/generate.ts";
import { isDone, missedToCards, next, pick, quizCount, retryMissed, startQuiz, type QuizState } from "../../core/study/quiz.ts";
import { studyUnits } from "../../core/study/units.ts";
import { getDb, writeDb } from "../../platform/db.ts";
import { usePendingText } from "../../platform/pending.ts";
import { getAvailability, getContextSize, makeCards, makeQuiz } from "../../../modules/waypoint-model/index.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { ModelUnavailable } from "./ModelUnavailable.tsx";

const PORT: ModelPort = { contextSize: getContextSize, makeCards, makeQuiz };
const LETTERS = ["A", "B", "C", "D"] as const;

// Runs one quiz on this iPhone. Wrong answers are saved as flashcards when the quiz ends.
export default function QuizScreen() {
  const colors = useColors();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [availability] = useState(getAvailability);
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<"working" | "failed" | "empty" | "ready">("working");
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  // True once the student is practising the ones they missed: nothing more is saved, and the first run's count stands.
  const [retrying, setRetrying] = useState(false);
  const [added, setAdded] = useState(0);
  // Unread pages or a transcript still being made: the quiz starts once they are read.
  const { pending, skipped } = usePendingText(sessionId);
  // Once a quiz has started it is not made again, even if something is read in the middle of it.
  const started = useRef(false);

  useEffect(() => {
    if (availability !== "available" || pending !== null || started.current) return;
    let active = true;
    setOutcome("working");
    async function run() {
      try {
        const db = getDb();
        const session = getSession(db, sessionId);
        if (session === null) {
          if (active) setOutcome("failed");
          return;
        }
        const questions = await makeQuizFromUnits(PORT, studyUnits(db, sessionId), quizCount(session.kind));
        if (!active) return;
        if (questions.length === 0) {
          setOutcome("empty");
          return;
        }
        started.current = true;
        setQuiz(startQuiz(questions));
        setRetrying(false);
        setAdded(0);
        setOutcome("ready");
      } catch {
        if (active) setOutcome("failed");
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [attempt, availability, pending, sessionId]);

  if (availability !== "available") {
    return (
      <Screen>
        <CloseButton />
        <ModelUnavailable availability={availability} />
      </Screen>
    );
  }

  if (quiz === null && pending !== null) {
    return (
      <Screen>
        <CloseButton />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Body>{pendingCopy(pending)}</Body>
        </View>
      </Screen>
    );
  }

  if (outcome === "working") {
    return (
      <Screen>
        <CloseButton />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Body>Making a quiz on this iPhone…</Body>
          {skipped !== null ? <Body>{skippedCopy(skipped)}</Body> : null}
        </View>
      </Screen>
    );
  }

  if (outcome === "failed") {
    return (
      <Screen>
        <CloseButton />
        <Title>Couldn't make a quiz this time.</Title>
        <PrimaryButton label="Try again" onPress={() => setAttempt(attempt + 1)} />
      </Screen>
    );
  }

  if (outcome === "empty" || quiz === null) {
    return (
      <Screen>
        <CloseButton />
        <Title>There wasn't enough here to make a quiz.</Title>
        {outcome === "empty" ? <PrimaryButton label="Try again" onPress={() => setAttempt(attempt + 1)} /> : null}
      </Screen>
    );
  }

  if (isDone(quiz)) {
    return (
      <Screen>
        <CloseButton />
        <Title>{`You got ${quiz.right} of ${quiz.questions.length}`}</Title>
        {!retrying && added > 0 ? <Body>{addedLine(added)}</Body> : null}
        {quiz.missed.length > 0 ? (
          <PrimaryButton
            label="Practise the ones I missed"
            onPress={() => {
              setRetrying(true);
              setQuiz(retryMissed(quiz));
            }}
          />
        ) : null}
        {quiz.missed.length > 0 ? (
          <SecondaryButton label="Review them" onPress={() => router.push(`/study/review?sessionId=${sessionId}`)} />
        ) : null}
        <SecondaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  const question = quiz.questions[quiz.index];
  if (question === undefined) return null;
  const picked = quiz.picked;
  const last = quiz.index === quiz.questions.length - 1;
  const answered = picked !== null;
  const wasRight = picked === question.answerIndex;

  function advance() {
    if (quiz === null) return;
    const after = next(quiz);
    if (!retrying && isDone(after) && after.missed.length > 0) {
      const missed = after.missed;
      // Only the cards actually saved count: a front the session already has is skipped.
      setAdded(writeDb((db) => saveCards(db, { now: Date.now, newId: randomUUID }, sessionId, missedToCards(missed), "quiz_miss")).length);
    }
    setQuiz(after);
  }

  return (
    <Screen>
      <View style={styles.top}>
        <CloseButton />
        <Title>Quiz</Title>
        <Caption>{`Question ${quiz.index + 1} of ${quiz.questions.length}`}</Caption>
        <View style={[styles.track, { backgroundColor: colors.surface3 }]}>
          <View style={[styles.fill, { width: `${(quiz.index / quiz.questions.length) * 100}%`, backgroundColor: colors.accent }]} />
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Text style={[styles.question, { color: colors.ink }]}>{question.question}</Text>
      </View>

      {question.choices.map((choice, index) => {
        const isAnswer = index === question.answerIndex;
        const isWrongPick = answered && index === picked && !isAnswer;
        const tint = answered && isAnswer ? colors.localSoft : isWrongPick ? colors.dangerSoft : colors.surface;
        const edge = answered && isAnswer ? colors.local : isWrongPick ? colors.danger : colors.line;
        return (
          <Pressable
            key={LETTERS[index]}
            accessibilityRole="button"
            accessibilityLabel={`${LETTERS[index]}, ${choice}`}
            disabled={answered}
            onPress={() => setQuiz(pick(quiz, index))}
            style={[styles.choice, { backgroundColor: tint, borderColor: edge }]}
          >
            <View style={[styles.letter, { backgroundColor: colors.surface2 }]}>
              <Text style={[styles.letterText, { color: colors.ink2 }]}>{LETTERS[index]}</Text>
            </View>
            <Text style={[styles.choiceText, { color: colors.ink }]}>{choice}</Text>
            {answered && isAnswer ? <SymbolView name="checkmark.circle.fill" tintColor={colors.local} size={20} /> : null}
          </Pressable>
        );
      })}

      {answered ? (
        <View style={[styles.feedback, { backgroundColor: wasRight ? colors.localSoft : colors.dangerSoft }]}>
          {wasRight ? (
            <Text style={[styles.feedbackTitle, { color: colors.localInk }]}>{`Right — ${question.why}`}</Text>
          ) : (
            <>
              <Text style={[styles.feedbackTitle, { color: colors.danger }]}>
                {`Not quite. The answer is ${LETTERS[question.answerIndex]}: ${question.choices[question.answerIndex]}.`}
              </Text>
              <Body>{question.why}</Body>
            </>
          )}
        </View>
      ) : null}

      {answered ? <PrimaryButton label={last ? "See how you did" : "Next"} onPress={advance} /> : null}
      {retrying ? null : <Caption style={styles.caption}>Wrong answers become flashcards</Caption>}
    </Screen>
  );
}

function addedLine(count: number): string {
  return count === 1 ? "1 flashcard added from the one you missed." : `${count} flashcards added from the ones you missed.`;
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
  top: { gap: 10 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  card: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 24, minHeight: 140, justifyContent: "center" },
  question: { fontFamily: "Georgia", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  choice: { minHeight: 56, borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  letter: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  letterText: { fontSize: 15, fontWeight: "700" },
  choiceText: { flex: 1, fontSize: 17 },
  feedback: { borderRadius: 16, padding: 16, gap: 8 },
  feedbackTitle: { fontSize: 17, fontWeight: "700", lineHeight: 24 },
  caption: { textAlign: "center" },
});
