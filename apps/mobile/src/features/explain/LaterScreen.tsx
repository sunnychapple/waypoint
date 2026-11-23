import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { savedExplanations, type SavedExplanation } from "../../core/explain/explanations.ts";
import { dismissFlag, groupFlagsBySession, openFlags, phraseForFlag, wordFromQuestion, type OpenFlag } from "../../core/explain/later.ts";
import { formatOffset } from "../../core/format.ts";
import { useQuery, writeDb } from "../../platform/db.ts";
import { BackButton, Body, Caption, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors, type Colors } from "../../ui/theme.ts";

// Questions for later: open flags (plain ones and words Explain could not answer) grouped by session, then the saved
// explanations. Opened from Home.
export default function LaterScreen() {
  const colors = useColors();
  // A flag with no word is explained by the transcript line at its time (null when there is none yet).
  const data = useQuery((db) => {
    const flags = openFlags(db);
    const phrases = Object.fromEntries(
      flags.filter((flag) => wordFromQuestion(flag.question) === null).map((flag) => [flag.id, phraseForFlag(db, flag)]),
    );
    return { flags, phrases, notes: savedExplanations(db) };
  });
  const groups = groupFlagsBySession(data.flags);
  const empty = data.flags.length === 0 && data.notes.length === 0;

  return (
    <Screen>
      <View style={styles.header}>
        <BackButton />
      </View>
      <Title>Questions for later</Title>

      {empty ? <Body>Nothing saved for later. Tap a word in your notes to explain it, or flag a moment while recording.</Body> : null}

      {groups.map((group) => (
        <View key={group.sessionId} style={styles.section}>
          <Caption>{group.sessionTitle}</Caption>
          {group.flags.map((flag) => (
            <FlagItem key={flag.id} flag={flag} phrase={data.phrases[flag.id] ?? null} colors={colors} />
          ))}
        </View>
      ))}

      {data.notes.length > 0 ? (
        <View style={styles.section}>
          <Caption>Saved answers</Caption>
          {data.notes.map((note) => (
            <NoteItem key={note.id} note={note} colors={colors} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

// A flag made on a page opens that page and is explained with it; a flag from a recording moment keeps its time.
function FlagItem({ flag, phrase, colors }: { flag: OpenFlag; phrase: string | null; colors: Colors }) {
  const word = wordFromQuestion(flag.question);
  const pageId = flag.captureId;
  const openHref = pageId === null ? `/session/${flag.sessionId}?t=${flag.t}` : `/session/${flag.sessionId}?page=${encodeURIComponent(pageId)}`;
  const where = pageId === null ? { t: String(flag.t) } : { page: pageId };
  return (
    <View style={styles.item}>
      <Row
        title={flag.question === "" ? "A moment you saved" : flag.question}
        subtitle={flag.pageNumber !== null ? `Page ${flag.pageNumber}` : formatOffset(flag.t)}
        onPress={() => router.push(openHref)}
      />
      <View style={styles.actions}>
        {word === null && phrase !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Get the answer"
            onPress={() =>
              router.push({
                pathname: "/explain",
                params: { sessionId: flag.sessionId, t: String(flag.t), word: phrase, flagId: flag.id },
              })
            }
            style={styles.action}
          >
            <Text style={[styles.link, { color: colors.accent }]}>Get the answer</Text>
          </Pressable>
        ) : word === null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open"
            onPress={() => router.push(openHref)}
            style={styles.action}
          >
            <Text style={[styles.link, { color: colors.accent }]}>Open</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Explain ${word}`}
            onPress={() =>
              router.push({
                pathname: "/explain",
                params: { sessionId: flag.sessionId, ...where, word, flagId: flag.id },
              })
            }
            style={styles.action}
          >
            <Text style={[styles.link, { color: colors.accent }]}>Explain</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={() => writeDb((db) => dismissFlag(db, flag.id))}
          style={styles.action}
        >
          <Text style={[styles.link, { color: colors.ink3 }]}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

function NoteItem({ note, colors }: { note: SavedExplanation; colors: Colors }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${note.term}, ${note.sessionTitle}`}
      onPress={() =>
        router.push({
          pathname: "/explain",
          params: { sessionId: note.sessionId, ...(note.captureId === null ? { t: String(note.t) } : { page: note.captureId }), word: note.term, explanationId: note.id },
        })
      }
      style={[styles.note, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <Text style={[styles.noteTerm, { color: colors.ink }]}>{note.term}</Text>
      {note.answer !== "" ? (
        <Text numberOfLines={2} style={[styles.noteAnswer, { color: colors.ink2 }]}>
          {note.answer}
        </Text>
      ) : null}
      <Caption>{note.sessionTitle}</Caption>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row" },
  section: { gap: 10 },
  item: { gap: 6 },
  actions: { flexDirection: "row", gap: 12, paddingHorizontal: 4 },
  action: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 8 },
  link: { fontSize: 15, fontWeight: "600" },
  note: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 6 },
  noteTerm: { fontSize: 17, fontWeight: "700" },
  noteAnswer: { fontSize: 15, lineHeight: 21 },
});
