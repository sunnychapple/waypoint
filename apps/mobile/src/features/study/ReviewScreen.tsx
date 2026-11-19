import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { listPages } from "../../core/capture/pages.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { formatOffset } from "../../core/format.ts";
import { dueCards, nextDueAt, previewIntervals, reviewCard, type CardRow } from "../../core/study/cards.ts";
import { intervalLabel } from "../../core/study/labels.ts";
import { getDb, writeDb } from "../../platform/db.ts";
import { Body, Caption, PrimaryButton, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
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

// Runs one review of the cards due: a session's cards when sessionId is given, otherwise all of them.
// "Made" is shown first when the route says the cards were just made.
export default function ReviewScreen() {
  const colors = useColors();
  const { sessionId, made } = useLocalSearchParams<{ sessionId?: string; made?: string }>();
  const [showMade, setShowMade] = useState(made === "1" && sessionId !== undefined);
  const [deck] = useState(() => dueCards(getDb(), Date.now(), sessionId === undefined ? { limit: DECK_SIZE } : { sessionId, limit: DECK_SIZE }));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (showMade && sessionId !== undefined) {
    return (
      <Screen>
        <MadeScreen sessionId={sessionId} onStart={() => setShowMade(false)} />
      </Screen>
    );
  }

  const card = deck[index];
  if (card === undefined) {
    const next = nextDueAt(getDb(), Date.now());
    return (
      <Screen>
        <Title>Review complete</Title>
        {next === null ? null : <Body>{`Next cards are due ${nextDueLabel(next, Date.now())}`}</Body>}
        <PrimaryButton label="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  const previews = previewIntervals(getDb(), card.id, Date.now());
  const source = sourceOf(card);
  const ratings = [
    { rating: 1 as const, label: "Again", fill: colors.dangerSoft, ink: colors.danger },
    { rating: 2 as const, label: "Hard", fill: colors.surface2, ink: colors.ink2 },
    { rating: 3 as const, label: "Good", fill: colors.accentSoft, ink: colors.accent },
    { rating: 4 as const, label: "Easy", fill: colors.localSoft, ink: colors.local },
  ];

  const cardId = card.id;
  function rate(rating: 1 | 2 | 3 | 4) {
    writeDb((db) => reviewCard(db, cardId, rating, Date.now()));
    setIndex(index + 1);
    setFlipped(false);
  }

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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={flipped ? "Show the front" : "Show the back"}
        onPress={() => setFlipped(!flipped)}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}
      >
        <Caption>{KIND_LABEL[card.kind]}</Caption>
        <Text style={[styles.front, { color: colors.ink }]}>{flipped ? card.back : card.front}</Text>
      </Pressable>

      {source === null ? null : (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/session/${card.sessionId}`)} style={[styles.chip, { backgroundColor: colors.accentSoft }]}>
          <Text style={[styles.chipText, { color: colors.accent }]}>{source}</Text>
        </Pressable>
      )}

      <View style={styles.ratings}>
        {ratings.map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => rate(item.rating)}
            style={[styles.rating, { backgroundColor: item.fill }]}
          >
            <Text style={[styles.ratingLabel, { color: item.ink }]}>{item.label}</Text>
            <Text style={[styles.ratingInterval, { color: item.ink }]}>{intervalLabel(previews[item.rating])}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
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
  card: { minHeight: 300, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 24, alignItems: "center", justifyContent: "center", gap: 20 },
  front: { fontFamily: "Georgia", fontSize: 30, fontWeight: "700", textAlign: "center", lineHeight: 38 },
  chip: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  chipText: { fontSize: 14, fontWeight: "600" },
  ratings: { flexDirection: "row", gap: 8 },
  rating: { flex: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", gap: 4 },
  ratingLabel: { fontSize: 16, fontWeight: "700" },
  ratingInterval: { fontSize: 13 },
});
