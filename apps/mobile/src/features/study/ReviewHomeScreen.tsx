import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { listSpaces } from "../../core/db/spaces.ts";
import { sessionsInSpace } from "../../core/capture/sessions.ts";
import { countDue, nextDueAt } from "../../core/study/cards.ts";
import { minutesLabel } from "../../core/study/labels.ts";
import { useQuery } from "../../platform/db.ts";
import { Body, Caption, PrimaryButton, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { nextDueLabel } from "./ReviewScreen.tsx";

// The Review tab: what is due, and the five newest sessions to make cards from.
export default function ReviewHomeScreen() {
  const colors = useColors();
  const data = useQuery((db) => {
    const now = Date.now();
    const sessions = listSpaces(db)
      .flatMap((space) => sessionsInSpace(db, space.id))
      .sort((a, b) => b.startedAt - a.startedAt);
    return {
      due: countDue(db, now),
      total: sessions.reduce((sum, session) => sum + session.cards, 0),
      next: nextDueAt(db, now),
      recent: sessions.slice(0, 5),
      now,
    };
  });

  if (data.total === 0) {
    return (
      <Screen>
        <Title>Review</Title>
        <View style={styles.empty}>
          <SymbolView name="square.stack.3d.up" tintColor={colors.accent} size={44} />
          <Title style={styles.centered}>Nothing to review yet</Title>
          <Body style={styles.centered}>Make flashcards from a recording or your pages and they show up here.</Body>
          <PrimaryButton label="Snap pages" onPress={() => router.push("/pages/new")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Review</Title>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {data.due > 0 ? (
          <>
            <View style={[styles.ring, { borderColor: colors.accent }]}>
              <Text style={[styles.ringText, { color: colors.ink }]}>{`${data.due}/${data.total}`}</Text>
            </View>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{`${data.due} cards due`}</Text>
            <Body>{minutesLabel(data.due)}</Body>
            <PrimaryButton label="Start review" icon="play.fill" onPress={() => router.push("/study/review")} />
          </>
        ) : (
          <>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>All caught up</Text>
            {data.next === null ? null : <Body>{`Next cards are due ${nextDueLabel(data.next, data.now)}`}</Body>}
          </>
        )}
      </View>

      <Caption>MAKE A REVIEW</Caption>
      {data.recent.map((session) => (
        <View key={session.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <Text style={[styles.sessionTitle, { color: colors.ink }]}>{session.title}</Text>
          <Caption>{session.spaceName}</Caption>
          <View style={styles.buttons}>
            <SecondaryButton
              label="Flashcards"
              style={styles.half}
              onPress={() => router.push(`/study/make?sessionId=${session.id}`)}
            />
            <SecondaryButton label="Quiz me" style={styles.half} onPress={() => router.push(`/study/quiz?sessionId=${session.id}`)} />
          </View>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: 12, paddingTop: 24 },
  centered: { textAlign: "center" },
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  ring: { width: 84, height: 84, borderRadius: 42, borderWidth: 8, alignSelf: "center", alignItems: "center", justifyContent: "center" },
  ringText: { fontSize: 16, fontWeight: "700" },
  cardTitle: { fontFamily: "Georgia", fontSize: 22, fontWeight: "700" },
  sessionTitle: { fontSize: 17, fontWeight: "600" },
  buttons: { flexDirection: "row", gap: 8 },
  half: { flex: 1 },
});
