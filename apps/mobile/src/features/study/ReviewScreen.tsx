import { useEffect, useState, type ReactNode } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { listPages } from "../../core/capture/pages.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { spaceGroups } from "../../core/groups/groups.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { formatOffset } from "../../core/format.ts";
import { cardExists, cardSourceHref, deleteCard, dueCards, nextDueAt, previewIntervals, reviewCard, sessionCards, type CardRow } from "../../core/study/cards.ts";
import { intervalLabel, RATING_SPOKEN } from "../../core/study/labels.ts";
import { getDb, writeDb } from "../../platform/db.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { FlipCard, useReduceMotion } from "./FlipCard.tsx";
import { MadeScreen } from "./MadeScreen.tsx";

const DECK_SIZE = 200;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KIND_LABEL: Record<CardRow["kind"], string> = { term: "DEFINITION", problem: "PROBLEM", question: "QUESTION" };

// "in 10 minutes", "tomorrow" or "on Nov 23", for the next cards due after `now`.
export function nextDueLabel(next: number, now: number): string {
  const diff = next - now;
  if (diff < 60 * MINUTE) {
    const minutes = Math.max(1, Math.round(diff / MINUTE));
    return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const due = new Date(next);
  if (due.toDateString() === new Date(now + DAY).toDateString()) return "tomorrow";
  if (due.toDateString() === new Date(now).toDateString()) return "later today";
  return `on ${MONTHS[due.getMonth()]} ${due.getDate()}`;
}

// The cards to review: the cards due, or with `all`, every card of the session (due or not).
function deckFor(sessionId: string | undefined, all: boolean): CardRow[] {
  const db = getDb();
  if (sessionId === undefined) return dueCards(db, Date.now(), { limit: DECK_SIZE });
  return all ? sessionCards(db, sessionId, DECK_SIZE) : dueCards(db, Date.now(), { sessionId, limit: DECK_SIZE });
}

// Runs one review of the cards due: a session's cards when sessionId is given, otherwise all of them.
// With all=1 every card of the session is practised, due or not. Each rating is a normal review.
// "Made" is shown first when the route says the cards were just made.
export default function ReviewScreen() {
  const colors = useColors();
  const { sessionId, made, all } = useLocalSearchParams<{ sessionId?: string; made?: string; all?: string }>();
  const [showMade, setShowMade] = useState(made === "1" && sessionId !== undefined);
  const [deck, setDeck] = useState<CardRow[]>(() => deckFor(sessionId, all === "1"));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [right, setRight] = useState(0);
  const [missed, setMissed] = useState<CardRow[]>([]);

  // Runs the given cards again from the first, with the count starting over.
  function practise(cards: CardRow[]) {
    setDeck(cards);
    setIndex(0);
    setFlipped(false);
    setRevealed(false);
    setRight(0);
    setMissed([]);
  }

  // Takes a card out of this review. The next card takes its place.
  function dropCard(id: string) {
    setDeck(deck.filter((item) => item.id !== id));
    setMissed(missed.filter((item) => item.id !== id));
    setFlipped(false);
    setRevealed(false);
  }

  if (showMade && sessionId !== undefined) {
    return (
      <Screen>
        <MadeScreen sessionId={sessionId} onStart={() => setShowMade(false)} />
      </Screen>
    );
  }

  const card = deck[index];
  if (card === undefined) {
    if (deck.length > 0) {
      const finishedMissed = missed.length > 0;
      return (
        <Screen>
          <Title>Review complete</Title>
          <Body>{`You got ${right} of ${deck.length}`}</Body>
          {finishedMissed ? <PrimaryButton label="Practise the ones I missed" onPress={() => practise(missed)} /> : null}
          {finishedMissed ? (
            <SecondaryButton label="Done" onPress={() => router.back()} />
          ) : (
            <PrimaryButton label="Done" onPress={() => router.back()} />
          )}
        </Screen>
      );
    }
    const next = nextDueAt(getDb(), Date.now());
    return (
      <Screen>
        <Title>Review complete</Title>
        {next === null ? null : <Body>{`Next cards are due ${nextDueLabel(next, Date.now())}`}</Body>}
        <PrimaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  // Deleted on another phone since this review started.
  if (!cardExists(getDb(), card.id)) {
    dropCard(card.id);
    return null;
  }

  const previews = previewIntervals(getDb(), card.id, Date.now());
  const source = sourceOf(card);
  const ratings = [
    { rating: 1 as const, label: "Again", fill: colors.dangerSoft, ink: colors.danger },
    { rating: 2 as const, label: "Hard", fill: colors.surface2, ink: colors.ink2 },
    { rating: 3 as const, label: "Good", fill: colors.accentSoft, ink: colors.accent },
    { rating: 4 as const, label: "Easy", fill: colors.localSoft, ink: colors.local },
  ];

  const current: CardRow = card;
  const cardId = card.id;
  function rate(rating: 1 | 2 | 3 | 4) {
    if (!cardExists(getDb(), cardId)) {
      dropCard(cardId);
      return;
    }
    writeDb((db) => reviewCard(db, cardId, rating, Date.now()));
    if (rating === 1) setMissed([...missed, current]);
    else setRight(right + 1);
    setIndex(index + 1);
    setFlipped(false);
    setRevealed(false);
  }

  // The first flip to the answer reveals the rating buttons; flipping back keeps them.
  function flip() {
    if (!flipped) setRevealed(true);
    setFlipped(!flipped);
  }

  // A card the model got wrong can be taken out.
  function removeCard() {
    Alert.alert("Remove this card?", "It won't come back in your reviews.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          writeDb((db) => deleteCard(db, cardId));
          dropCard(cardId);
        },
      },
    ]);
  }

  // A viewer of a shared space cannot change its notes.
  const session = getSession(getDb(), card.sessionId);
  const canRemove = session === null || spaceGroups(getDb()).get(session.spaceId)?.role !== "viewer";

  return (
    <Screen>
      <View style={styles.top}>
        <CloseButton />
        <Title>Flashcards</Title>
        <Caption>{`${spaceNameOf(card.sessionId)} · ${index + 1} of ${deck.length}`}</Caption>
        <View style={[styles.track, { backgroundColor: colors.surface3 }]}>
          <View style={[styles.fill, { width: `${(index / deck.length) * 100}%`, backgroundColor: colors.accent }]} />
        </View>
      </View>

      <FlipCard key={card.id} kindLabel={KIND_LABEL[card.kind]} front={card.front} back={card.back} flipped={flipped} onPress={flip} />

      {source === null ? null : (
        <Pressable accessibilityRole="button" onPress={() => router.push(cardSourceHref(card))} style={[styles.chip, { backgroundColor: colors.accentSoft }]}>
          <Text style={[styles.chipText, { color: colors.accent }]}>{source}</Text>
        </Pressable>
      )}

      {revealed ? (
        <>
          <Caption style={styles.centered}>How well did you know it?</Caption>
          <RatingRow>
            {ratings.map((item) => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityLabel={RATING_SPOKEN[item.rating]}
                onPress={() => rate(item.rating)}
                style={[styles.rating, { backgroundColor: item.fill }]}
              >
                <Text style={[styles.ratingLabel, { color: item.ink }]}>{item.label}</Text>
                <Text style={[styles.ratingInterval, { color: item.ink }]}>{intervalLabel(previews[item.rating])}</Text>
              </Pressable>
            ))}
          </RatingRow>
        </>
      ) : (
        <PrimaryButton label="Show answer" onPress={flip} />
      )}
      {canRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove this card" onPress={removeCard} style={styles.remove}>
          <Text style={[styles.removeText, { color: colors.ink3 }]}>Remove this card</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

// The rating buttons fade in and rise 24 pt once, when the answer is revealed. Reduce Motion: they appear at once.
function RatingRow({ children }: { children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: 240, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress]);

  useEffect(() => {
    if (reduceMotion) progress.setValue(1);
  }, [reduceMotion, progress]);

  return (
    <Animated.View
      style={[
        styles.ratings,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Where the card came from: a moment in a recording, or a page of a pages session.
function sourceOf(card: CardRow): string | null {
  const db = getDb();
  if (card.t !== null) {
    const title = getSession(db, card.sessionId)?.title ?? "";
    return `From ${title} · ${formatOffset(card.t)}`;
  }
  const page = listPages(db, card.sessionId).find((p) => p.id === card.captureId);
  return page === undefined ? null : `From page ${page.position + 1}`;
}

function spaceNameOf(sessionId: string): string {
  const db = getDb();
  const session = getSession(db, sessionId);
  return session === null ? "" : (getSpace(db, session.spaceId)?.name ?? "");
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
  top: { gap: 10 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  chip: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  chipText: { fontSize: 14, fontWeight: "600" },
  ratings: { flexDirection: "row", gap: 8 },
  rating: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", gap: 4 },
  ratingLabel: { fontSize: 16, fontWeight: "700" },
  ratingInterval: { fontSize: 13 },
  centered: { textAlign: "center" },
  remove: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  removeText: { fontSize: 15, fontWeight: "600" },
});
