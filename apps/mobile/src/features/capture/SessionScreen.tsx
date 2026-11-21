import { useEffect, useRef, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { dateLine } from "../../core/capture/labels.ts";
import { momentFromParam, nearestSegmentIndex } from "../../core/capture/moment.ts";
import { listPages } from "../../core/capture/pages.ts";
import { diffWords, partText, uploadParts, type DiffWord } from "../../core/capture/second.ts";
import { listSegments } from "../../core/capture/segments.ts";
import { buildTimeline, type TimelineItem } from "../../core/capture/timeline.ts";
import type { Piece } from "../../core/capture/transcript.ts";
import { deleteSessionRow, getSession, renameSession } from "../../core/capture/sessions.ts";
import type { SqlDb } from "../../core/db/sql.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { spaceGroups } from "../../core/groups/groups.ts";
import { researchForSession } from "../../core/research/research.ts";
import { linksForSession } from "../../core/share/links.ts";
import { madeForSession, type MadeItem } from "../../core/made/made.ts";
import { countLabel, formatClock, formatOffset } from "../../core/format.ts";
import { jobsForSession } from "../../core/jobs/jobs.ts";
import { overviewsForSession, type Overview, type OverviewState } from "../../core/overviews/overviews.ts";
import { useConfig } from "../../platform/config.ts";
import { useQuery, writeDb } from "../../platform/db.ts";
import { deleteFile, deleteSessionFiles, fileUri } from "../../platform/files.ts";
import { linkRefused, revokeLink } from "../../platform/links.ts";
import { Caption, PrimaryButton, Row, Screen, SecondaryButton, Title } from "../../ui/kit.tsx";
import { WordText } from "../../ui/WordText.tsx";
import { useColors } from "../../ui/theme.ts";
import { getRecorderStatus } from "../../../modules/waypoint-audio/index.ts";
import { RecordingPlayer } from "./RecordingPlayer.tsx";
import { TimeMarkRow } from "./TimelineMarks.tsx";

// One session: its title, when and where it was saved, and what to do with it.
// A recording's transcript lists its lines; tapping a word opens Explain (M15), tapping a line's time plays the
// recording from there (open question 54).
export default function SessionScreen() {
  const colors = useColors();
  const { id, view, t, page: pageId } = useLocalSearchParams<{ id: string; view?: string; t?: string; page?: string }>();
  const data = useQuery((db) => {
    const session = getSession(db, id);
    if (!session) return null;
    return {
      session,
      spaceName: getSpace(db, session.spaceId)?.name ?? "",
      pages: session.kind === "pages" ? listPages(db, id) : [],
      timeline: session.kind === "recording" ? recordingTimeline(db, id) : [],
      research: researchForSession(db, id),
      made: madeForSession(db, id),
      overviews: overviewsForSession(db, id),
      links: linksForSession(db, id),
      role: spaceGroups(db).get(session.spaceId)?.role ?? null,
      second: session.kind === "recording" ? secondTranscript(db, id) : null,
      // The recording's parts that are on this iPhone (a synced part may not be downloaded yet).
      playParts: session.kind === "recording" ? uploadParts(db, id).filter((part) => part.file !== "") : [],
    };
  }, id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [showSecond, setShowSecond] = useState(view === "second");
  const [seek, setSeek] = useState<{ ms: number } | null>(null);
  const [more, setMore] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const landed = useRef<string | null>(null);
  // A push to ?view=second while this screen is already open moves the switch too.
  useEffect(() => setShowSecond(view === "second"), [view]);
  // The line a search hit landed on stays tinted for two seconds.
  useEffect(() => {
    if (lit === null) return;
    const timer = setTimeout(() => setLit(null), 2000);
    return () => clearTimeout(timer);
  }, [lit]);
  const miniAppsOn = useConfig()?.flags.mini_app_viewer === true;
  const diagramsOn = useConfig()?.flags.diagram_viewer === true;

  if (!data) return <Screen>{null}</Screen>;
  const { session, spaceName, pages, timeline, research, second, overviews, links, role, playParts } = data;
  const playable = playParts.length > 0 && (session.state === "saved" || session.state === "interrupted");
  // A mini app or a diagram is listed only while its flag is on (M25b).
  const made = data.made.filter((item) => (item.kind !== "mini_app" || miniAppsOn) && (item.kind !== "diagram" || diagramsOn));
  const offset = -new Date().getTimezoneOffset();
  const detail = session.kind === "recording" ? formatClock(session.recordedMs) : countLabel(pages.length, "page", "pages");
  // A search hit's moment picks the transcript line to land on: the nearest one (see nearestSegmentIndex).
  const moment = momentFromParam(t);
  const lines = timeline.filter((item): item is Extract<TimelineItem, { kind: "line" }> => item.kind === "line");
  // A search hit on a page lands on that page (its capture id); any other hit lands on its transcript line.
  const landPage = targetPageId(pages, pageId);
  const jumpKey = `${id}|${t ?? ""}|${pageId ?? ""}`;
  const targetKey =
    landPage ?? (moment === null || lines.length === 0 ? null : (lines[nearestSegmentIndex(lines.map((line) => line.at), moment)]?.key ?? null));

  // Once the target line or page has laid out, scroll to it and tint it. Only the first layout of one jump does this.
  // Its y is measured from the scroll content, where every row sits.
  function landOn(key: string, y: number): void {
    if (key !== targetKey || landed.current === jumpKey) return;
    landed.current = jumpKey;
    scroll.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
    setLit(key);
  }

  function saveTitle() {
    setEditing(false);
    const next = draft.trim();
    if (next === "" || next === session.title) return;
    writeDb((db) => renameSession(db, id, next));
  }

  function openMenu() {
    const canSecond = session.kind === "recording" && (session.state === "saved" || session.state === "interrupted");
    Alert.alert(session.title, undefined, [
      ...(canSecond ? [{ text: "Better transcript", onPress: () => router.push(`/second-transcript?sessionId=${id}`) }] : []),
      // A viewer can neither take a session out of a shared space nor link to it (the server refuses both).
      ...(role === "viewer"
        ? []
        : [
            { text: "Move to another space", onPress: () => router.push(`/space-picker?sessionId=${id}`) },
            { text: "Share a link", onPress: () => router.push(`/share/${id}`) },
          ]),
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
        onPress: () => void deleteSession(),
      },
    ]);
  }

  // Its links are turned off first (M30b); when one cannot be turned off, the session stays.
  async function deleteSession() {
    try {
      for (const link of links) if (link.revokedAt === null) await revokeLink(link.id);
    } catch (error) {
      if (linkRefused(error)) Alert.alert("Couldn't turn off a link", "Only the person who made it, or an owner of the shared space, can turn it off. This session is still here.");
      else Alert.alert("Couldn't turn off the links", "This session is still here. Try again when you're online.");
      return;
    }
    writeDb((db) => deleteSessionRow(db, id));
    deleteSessionFiles(id);
    for (const overview of overviews) if (overview.file !== null) deleteFile(overview.file);
    router.replace("/");
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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

        {playable ? <RecordingPlayer parts={playParts} seek={seek} onSeekDone={() => setSeek(null)} /> : null}

        <View style={styles.actions}>
          <View style={styles.studyHead}>
            <Caption>STUDY THIS</Caption>
            {session.kind === "pages" ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Edit pages" hitSlop={8} onPress={() => router.push(`/pages/${id}`)}>
                <Text style={[styles.toggle, { color: colors.accent }]}>Edit pages</Text>
              </Pressable>
            ) : null}
          </View>
          <PrimaryButton label="Flashcards" icon="square.stack.3d.up" onPress={() => router.push(`/study/make?sessionId=${id}`)} />
          <SecondaryButton label="Quiz me" icon="checklist" onPress={() => router.push(`/study/quiz?sessionId=${id}`)} />
          {session.kind === "pages" ? (
            <SecondaryButton label="Help me with a problem" icon="questionmark.circle" onPress={() => router.push(`/study/help?sessionId=${id}`)} />
          ) : null}
          <SecondaryButton label="More tools" icon="ellipsis" onPress={() => setMore(!more)} />
          {more ? (
            <>
              <SecondaryButton label="Research the web" icon="globe" onPress={() => router.push(`/research/new?sessionId=${id}`)} />
              <SecondaryButton label="Audio overview" icon="waveform" onPress={() => router.push(`/overview/new?sessionId=${id}`)} />
              <SecondaryButton label="Video overview" icon="play.rectangle" onPress={() => router.push(`/video/new?sessionId=${id}`)} />
              <SecondaryButton label="Practice set" icon="list.bullet.clipboard" onPress={() => router.push(`/made/new?sessionId=${id}&kind=practice`)} />
              {diagramsOn ? (
                <SecondaryButton label="Diagram" icon="point.3.connected.trianglepath.dotted" onPress={() => router.push(`/made/new?sessionId=${id}&kind=diagram`)} />
              ) : null}
              {miniAppsOn ? (
                <SecondaryButton label="Mini app" icon="square.grid.2x2" onPress={() => router.push(`/made/new?sessionId=${id}&kind=mini_app`)} />
              ) : null}
            </>
          ) : null}
        </View>

        {second !== null ? (
          <View style={styles.switchRow}>
            {(["On this iPhone", "Better transcript"] as const).map((label, index) => {
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
          timeline.map((item) =>
            item.kind === "line" ? (
              <View
                key={item.key}
                onLayout={(event) => landOn(item.key, event.nativeEvent.layout.y)}
                style={[styles.line, lit === item.key ? [styles.litLine, { backgroundColor: colors.accentSoft }] : null]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Play from ${formatOffset(item.at)}`}
                  hitSlop={12}
                  disabled={!playable || getRecorderStatus().state !== "idle"}
                  onPress={() => setSeek({ ms: item.at })}
                >
                  <Text style={[styles.time, { color: playable ? colors.accent : colors.ink3 }]}>{formatOffset(item.at)}</Text>
                </Pressable>
                <WordText
                  text={item.text}
                  style={[styles.lineText, { color: colors.ink }]}
                  onWord={(word) => router.push({ pathname: "/explain", params: { sessionId: id, t: String(item.at), word } })}
                />
              </View>
            ) : (
              <TimeMarkRow key={item.key} item={item} interactive />
            ),
          )
        )}

        {pages.map((page, index) => (
          <PageBlock
            key={page.id}
            number={index + 1}
            file={page.file}
            text={page.foundText}
            lit={lit === page.id}
            onLayout={(y) => landOn(page.id, y)}
            onWord={(word) => router.push({ pathname: "/explain", params: { sessionId: id, page: page.id, word } })}
          />
        ))}

        {overviews.length > 0 ? (
          <View style={styles.actions}>
            <Caption>OVERVIEWS</Caption>
            {overviews.map((item) => (
              <Row
                key={item.id}
                title={item.title}
                right={<Caption>{overviewLabel(item)}</Caption>}
                onPress={() => router.push(`${item.kind === "video" ? "/video/" : "/overview/"}${encodeURIComponent(item.id)}`)}
              />
            ))}
          </View>
        ) : null}

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

        {made.length > 0 ? (
          <View style={styles.actions}>
            <Caption>MADE FROM THIS SESSION</Caption>
            {made.map((item) => (
              <Row
                key={item.id}
                title={item.title}
                right={<Caption>{dateLine(item.createdAt, offset)}</Caption>}
                onPress={() => router.push(`${madeRoute(item)}${encodeURIComponent(item.id)}`)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// The recording's lines, gaps, flags and photos in time order, built the way the live screen builds them.
// Pauses are not stored, so each resume is the start of an audio part after the first (a part starts when recording
// resumes), which gives the same gaps the live screen drew.
function recordingTimeline(db: SqlDb, sessionId: string): TimelineItem[] {
  const lines: Piece[] = listSegments(db, sessionId).map((segment) => ({ ...segment, isFinal: true }));
  const parts = uploadParts(db, sessionId).map((part) => ({ index: part.n, startMs: part.startMs, durationMs: part.durationMs }));
  const flags = db.all<{ t: number }>("SELECT t FROM flags WHERE session_id = ? ORDER BY t", [sessionId]).map((row) => row.t);
  const photos = db.all<{ id: string; t: number; file: string }>(
    "SELECT id, t, file FROM captures WHERE session_id = ? AND kind = 'photo' ORDER BY t, id",
    [sessionId],
  );
  // A part whose length was never measured (0) would make the whole part look like a gap, so its resume is skipped.
  const resumes = parts.slice(1).filter((part, i) => parts[i]!.durationMs > 0).map((part) => part.startMs);
  return buildTimeline(lines, parts, resumes, flags, photos);
}

const OVERVIEW_STATE: Record<OverviewState, string> = {
  script: "Making the voices…",
  rendering: "Making the voices…",
  ready: "Ready",
  failed: "Couldn't make the voices",
  no_voices: "Needs a second voice",
};

// A video row says "video" while it is made and when that failed; the other states keep the shared wording.
function overviewLabel(item: Overview): string {
  if (item.kind === "video" && (item.state === "script" || item.state === "rendering")) return "Making the video…";
  if (item.kind === "video" && item.state === "failed") return "Couldn't make the video";
  return OVERVIEW_STATE[item.state];
}

// Where a made item opens: practice sets, diagrams and mini apps each have their own screen.
function madeRoute(item: MadeItem): string {
  if (item.kind === "practice") return "/practice/";
  return item.kind === "diagram" ? "/diagram/" : "/mini-app/";
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

// The page a search hit names, when this session has that page; otherwise null.
export function targetPageId(pages: { id: string }[], pageId: string | undefined): string | null {
  if (pageId === undefined || pageId === "") return null;
  return pages.some((page) => page.id === pageId) ? pageId : null;
}

function PageBlock({
  number,
  file,
  text,
  lit,
  onLayout,
  onWord,
}: {
  number: number;
  file: string;
  text: string | null;
  lit: boolean;
  onLayout: (y: number) => void;
  onWord: (word: string) => void;
}) {
  const colors = useColors();
  const [showing, setShowing] = useState(false);
  return (
    <View
      onLayout={(event) => onLayout(event.nativeEvent.layout.y)}
      style={[styles.page, lit ? [styles.litLine, { backgroundColor: colors.accentSoft }] : null]}
    >
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
          {showing ? <WordText text={text} style={[styles.pageText, { color: colors.ink2 }]} onWord={onWord} /> : null}
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
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  studyHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  litLine: { borderRadius: 10, paddingHorizontal: 6, marginHorizontal: -6 },
  line: { flexDirection: "row", gap: 12 },
  time: { width: 48, fontSize: 13, fontVariant: ["tabular-nums"] },
  lineText: { flex: 1, fontSize: 17, lineHeight: 25 },
  changed: { fontWeight: "700" },
  switchRow: { flexDirection: "row", gap: 8 },
  switchItem: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  switchText: { fontSize: 15, fontWeight: "600" },
});
