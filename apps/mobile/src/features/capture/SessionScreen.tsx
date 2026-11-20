import { useEffect, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { dateLine } from "../../core/capture/labels.ts";
import { listPages } from "../../core/capture/pages.ts";
import { diffWords, partText, uploadParts, type DiffWord } from "../../core/capture/second.ts";
import { listSegments } from "../../core/capture/segments.ts";
import { deleteSessionRow, getSession, renameSession } from "../../core/capture/sessions.ts";
import type { SqlDb } from "../../core/db/sql.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { researchForSession } from "../../core/research/research.ts";
import { countLabel, formatClock, formatOffset } from "../../core/format.ts";
import { jobsForSession } from "../../core/jobs/jobs.ts";
import { useQuery, writeDb } from "../../platform/db.ts";
import { deleteSessionFiles, fileUri } from "../../platform/files.ts";
import { Caption, PrimaryButton, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { WordText } from "../../ui/WordText.tsx";
import { useColors } from "../../ui/theme.ts";

// One session: its title, when and where it was saved, and what to do with it.
// A recording's transcript lists its lines; tapping a word opens Explain (M15).
export default function SessionScreen() {
  const colors = useColors();
  const { id, view } = useLocalSearchParams<{ id: string; view?: string }>();
  const data = useQuery((db) => {
    const session = getSession(db, id);
    if (!session) return null;
    return {
      session,
      spaceName: getSpace(db, session.spaceId)?.name ?? "",
      pages: session.kind === "pages" ? listPages(db, id) : [],
      segments: session.kind === "recording" ? listSegments(db, id) : [],
      research: researchForSession(db, id),
      second: session.kind === "recording" ? secondTranscript(db, id) : null,
    };
  }, id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [showSecond, setShowSecond] = useState(view === "second");
  // A push to ?view=second while this screen is already open moves the switch too.
  useEffect(() => setShowSecond(view === "second"), [view]);

  if (!data) return <Screen>{null}</Screen>;
  const { session, spaceName, pages, segments, research, second } = data;
  const offset = -new Date().getTimezoneOffset();
  const detail = session.kind === "recording" ? formatClock(session.recordedMs) : countLabel(pages.length, "page", "pages");

  function saveTitle() {
    setEditing(false);
    const next = draft.trim();
    if (next === "" || next === session.title) return;
    writeDb((db) => renameSession(db, id, next));
  }

  function openMenu() {
    const canSecond = session.kind === "recording" && (session.state === "saved" || session.state === "interrupted");
    Alert.alert(session.title, undefined, [
      ...(canSecond ? [{ text: "Second transcript", onPress: () => router.push(`/second-transcript?sessionId=${id}`) }] : []),
      { text: "Move to another space", onPress: () => router.push(`/space-picker?sessionId=${id}`) },
      { text: "Delete", style: "destructive", onPress: confirmDelete },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function confirmDelete() {
    Alert.alert("Delete this session?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          writeDb((db) => deleteSessionRow(db, id));
          deleteSessionFiles(id);
          router.replace("/");
        },
      },
    ]);
  }

  return (
    <Screen>
      <View style={styles.topRow}>
        <CircleButton label="Back" icon="chevron.left" onPress={() => router.back()} />
        <CircleButton label="More" icon="ellipsis" onPress={openMenu} />
      </View>

      <Caption>{spaceName}</Caption>
      {editing ? (
        <TextInput
          autoFocus
          accessibilityLabel="Title"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={saveTitle}
          onBlur={saveTitle}
          maxLength={80}
          style={[styles.titleInput, { color: colors.ink }]}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Rename ${session.title}`}
          onPress={() => {
            setDraft(session.title);
            setEditing(true);
          }}
        >
          <Title>{session.title}</Title>
        </Pressable>
      )}
      <Caption>{`${dateLine(session.startedAt, offset)} · ${detail}`}</Caption>

      {session.kind === "recording" && session.transcript === "waiting" ? (
        <Caption>Writing down the recording on this iPhone…</Caption>
      ) : null}
      {session.kind === "recording" && session.transcript === "failed" ? (
        <Caption>Couldn't write down this recording.</Caption>
      ) : null}

      {second !== null ? (
        <View style={styles.switchRow}>
          {(["On this iPhone", "Second transcript"] as const).map((label, index) => {
            const active = showSecond === (index === 1);
            return (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setShowSecond(index === 1)}
                style={[styles.switchItem, { backgroundColor: active ? colors.accentSoft : colors.surface2 }]}
              >
                <Text style={[styles.switchText, { color: colors.ink }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {second !== null && showSecond ? (
        <>
          {second.parts.map((words, index) => (
            <Text key={index} style={[styles.lineText, { color: colors.ink }]}>
              {words.map((word, i) => (
                <Text key={i} style={word.changed ? [styles.changed, { backgroundColor: colors.accentSoft }] : undefined}>
                  {`${word.text} `}
                </Text>
              ))}
            </Text>
          ))}
          <Caption>Highlighted words are different from this iPhone's transcript.</Caption>
          {second.truncated ? <Caption>Only the minutes you paid for were transcribed.</Caption> : null}
        </>
      ) : (
        segments.map((segment) => (
          <View key={segment.tStart} style={styles.line}>
            <Text style={[styles.time, { color: colors.ink3 }]}>{formatOffset(segment.tStart)}</Text>
            <WordText
              text={segment.text}
              style={[styles.lineText, { color: colors.ink }]}
              onWord={(word) => router.push({ pathname: "/explain", params: { sessionId: id, t: String(segment.tStart), word } })}
            />
          </View>
        ))
      )}

      {pages.map((page, index) => (
        <PageBlock key={page.id} number={index + 1} file={page.file} text={page.foundText} />
      ))}

      <View style={styles.actions}>
        {session.kind === "pages" ? (
          <SecondaryButton label="Help me with a problem" icon="questionmark.circle" onPress={() => router.push(`/study/help?sessionId=${id}`)} />
        ) : null}
        <PrimaryButton label="Flashcards" icon="square.stack.3d.up" onPress={() => router.push(`/study/make?sessionId=${id}`)} />
        <SecondaryButton label="Quiz me" icon="checklist" onPress={() => router.push(`/study/quiz?sessionId=${id}`)} />
        <SecondaryButton label="Research the web" icon="globe" onPress={() => router.push(`/research/new?sessionId=${id}`)} />
      </View>

      {research.length > 0 ? (
        <View style={styles.actions}>
          <Caption>RESEARCH</Caption>
          {research.map((item) => (
            <Row
              key={item.id}
              title={item.question}
              right={<Caption>{dateLine(item.createdAt, offset)}</Caption>}
              onPress={() => router.push(`/research/${encodeURIComponent(item.id)}`)}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

// The second transcript, one list of changed-word marks per recording part, or null when no cloud transcript exists.
function secondTranscript(db: SqlDb, sessionId: string): { parts: DiffWord[][]; truncated: boolean } | null {
  const cloud = db.get<{ n: number }>("SELECT 1 AS n FROM segments WHERE session_id = ? AND source = 'cloud' LIMIT 1", [sessionId]);
  if (cloud === null) return null;
  const parts = uploadParts(db, sessionId).map((part) =>
    diffWords(partText(db, sessionId, "device", part), partText(db, sessionId, "cloud", part)),
  );
  const job = jobsForSession(db, sessionId).find((j) => j.type === "retranscribe" && j.state === "succeeded");
  let truncated = false;
  try {
    truncated = (JSON.parse(job?.detail ?? "{}") as { truncated?: unknown }).truncated === true;
  } catch {
    truncated = false;
  }
  return { parts, truncated };
}

function PageBlock({ number, file, text }: { number: number; file: string; text: string | null }) {
  const colors = useColors();
  const [showing, setShowing] = useState(false);
  return (
    <View style={styles.page}>
      <Caption>{String(number)}</Caption>
      <Image
        accessibilityLabel={`Page ${number}`}
        source={{ uri: fileUri(file) }}
        resizeMode="contain"
        style={[styles.pageImage, { backgroundColor: colors.surface2 }]}
      />
      {text ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showing ? "Hide the text" : "Show the text"}
            onPress={() => setShowing(!showing)}
          >
            <Text style={[styles.toggle, { color: colors.accent }]}>{showing ? "Hide the text" : "Show the text"}</Text>
          </Pressable>
          {showing ? <Text style={[styles.pageText, { color: colors.ink2 }]}>{text}</Text> : null}
        </>
      ) : null}
    </View>
  );
}

function CircleButton({ label, icon, onPress }: { label: string; icon: SFSymbol; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.circle, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <SymbolView name={icon} tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  titleInput: { fontFamily: "Georgia", fontSize: 32, fontWeight: "700", padding: 0 },
  page: { gap: 8 },
  pageImage: { width: "100%", aspectRatio: 0.75, borderRadius: 12 },
  toggle: { fontSize: 15, fontWeight: "600" },
  pageText: { fontSize: 15, lineHeight: 22 },
  actions: { gap: 12 },
  line: { flexDirection: "row", gap: 12 },
  time: { width: 48, fontSize: 13, fontVariant: ["tabular-nums"] },
  lineText: { flex: 1, fontSize: 17, lineHeight: 25 },
  changed: { fontWeight: "700" },
  switchRow: { flexDirection: "row", gap: 8 },
  switchItem: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  switchText: { fontSize: 15, fontWeight: "600" },
});
