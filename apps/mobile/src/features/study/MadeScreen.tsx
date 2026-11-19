import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { listPages } from "../../core/capture/pages.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { dueCards, sessionCardCount } from "../../core/study/cards.ts";
import { madeSummary } from "../../core/study/labels.ts";
import { getDb } from "../../platform/db.ts";
import { Body, Caption, PrimaryButton, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// Shown once after a session's flashcards are made: what they are made from and where they are kept.
export function MadeScreen({ sessionId, onStart }: { sessionId: string; onStart: () => void }) {
  const colors = useColors();
  const db = getDb();
  const session = getSession(db, sessionId);
  if (session === null) return null;
  const space = getSpace(db, session.spaceId)?.name ?? "";
  const isRecording = session.kind === "recording";
  const cards = sessionCardCount(db, sessionId);
  const pages = listPages(db, sessionId).length;
  const { terms, problems } = madeSummary(dueCards(db, Date.now(), { sessionId, limit: 1000 }));

  return (
    <>
      <View style={[styles.ring, { borderColor: colors.accent }]}>
        <SymbolView name="square.stack.3d.up" tintColor={colors.accent} size={34} />
      </View>
      <Title>{isRecording ? `${cards} flashcards from your recording.` : `${cards} flashcards from your ${pages} pages.`}</Title>
      <Body>{`Made on this iPhone. Saved in ${space}.`}</Body>

      <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Caption>WHAT'S IN THEM</Caption>
        {terms > 0 ? <Text style={[styles.line, { color: colors.ink }]}>{`${terms} terms and what they mean`}</Text> : null}
        {problems > 0 ? <Text style={[styles.line, { color: colors.ink }]}>{`${problems} worked problems, step by step`}</Text> : null}
        <Text style={[styles.line, { color: colors.ink }]}>
          {isRecording ? "Each card shows the moment it came from" : "Each card shows the page it came from"}
        </Text>
      </View>

      <PrimaryButton label="Start practising" onPress={onStart} />
      <SecondaryButton label={isRecording ? "See the recording" : "See the pages"} onPress={() => router.push(`/session/${sessionId}`)} />
    </>
  );
}

const styles = StyleSheet.create({
  ring: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, alignSelf: "center", alignItems: "center", justifyContent: "center" },
  box: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 10 },
  line: { fontSize: 16, lineHeight: 22 },
});
