import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SqlDb } from "../../core/db/sql.ts";
import { lineMarks, type LineMark } from "../../core/capture/marks.ts";
import { explainedWords, paragraphSelection, refKey, type Selection, type WordRef } from "../../core/capture/selection.ts";
import { explainedInTranscript, type ExplainedTerm } from "../../core/explain/explanations.ts";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { setRecordingLabel } from "../../../modules/waypoint-audio/index.ts";
import { countLabel, formatClock, formatOffset } from "../../core/format.ts";
import { applyMarks, groupTimeline, PARAGRAPH_PAUSE_MS, type TimelineLine, type TimelineRow as Row } from "../../core/capture/timeline.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { useQuery, useStableQuery } from "../../platform/db.ts";
import { setRecordScreenShowing } from "../../platform/push.ts";
import { Body, PrimaryButton, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";
import { isAtEnd } from "../../core/capture/follow.ts";
import { ParagraphRow, paragraphSlice } from "./ParagraphRow.tsx";
import { EditingBar, EditSwitch } from "./EditingBar.tsx";
import { SelectionBar } from "./SelectionBar.tsx";
import { liveSelection, selectionModel } from "./selectionModel.ts";
import { TimeMarkRow } from "./TimelineMarks.tsx";
import { Waveform } from "./Waveform.tsx";
import { useLineEditor } from "./useLineEditor.ts";
import { useRecording, type Banner, type TimelineItem } from "./useRecording.ts";

const PAUSE_REASONS: Record<string, string> = {
  interruption: "Another app took the microphone. We'll try to resume when it finishes.",
  route_change: "The microphone changed. We'll try to resume.",
  media_reset: "Audio restarted. We'll try to resume.",
  write_failed: "Your iPhone couldn't save the recording. Free up some space, then resume.",
};

// The live recording screen (C1, C3, C8, P5, P11, cut to stage 1). It cannot be swiped away; the close button asks first.
export default function RecordScreen() {
  const colors = useColors();
  const model = useRecording();

  useFocusEffect(
    useCallback(() => {
      setRecordScreenShowing(true);
      return () => setRecordScreenShowing(false);
    }, []),
  );

  function close(): void {
    if (model.phase !== "recording") {
      router.back();
      return;
    }
    if (model.continuing) {
      Alert.alert("End this recording?", "What you recorded stays in this session.", [
        { text: "Keep recording", style: "cancel" },
        { text: "Stop and save", onPress: model.stop },
      ]);
      return;
    }
    Alert.alert("End this recording?", "Discarding deletes its audio, photos and words.", [
      { text: "Keep recording", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: model.discard },
      { text: "Stop and save", onPress: model.stop },
    ]);
  }

  if (model.phase === "checking") {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: colors.bg }]}>
        <View style={styles.topRow}>
          <CircleButton label="Close" icon="chevron.down" onPress={close} />
        </View>
      </SafeAreaView>
    );
  }

  if (model.phase === "denied") {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: colors.bg }]}>
        <CircleButton label="Close" icon="chevron.down" onPress={close} />
        <View style={styles.centered}>
          <View style={[styles.micOff, { backgroundColor: colors.recSoft }]}>
            <SymbolView name="mic.slash.fill" tintColor={colors.rec} size={36} />
          </View>
          <Title style={styles.centeredText}>NotePath can't hear yet</Title>
          <Body style={styles.centeredText}>Turn on the microphone in Settings to record. You can still snap pages.</Body>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
          <SecondaryButton label="Snap pages instead" onPress={() => router.replace("/pages/new")} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Transcript model={model} onClose={close} />
      <Dock model={model} />
    </SafeAreaView>
  );
}

type Model = ReturnType<typeof useRecording>;

type Extras = { marks: LineMark[]; explanations: ExplainedTerm[] };

// The person's marks and saved answers for the live screen, read again after every write.
function transcriptExtras(db: SqlDb, sessionId: string | null): Extras {
  return sessionId === null ? { marks: [], explanations: [] } : { marks: lineMarks(db, sessionId), explanations: explainedInTranscript(db, sessionId) };
}

// What a row draws from the screen: the marks, the explained words, and the selection.
type RowView = { marks: ReadonlyMap<number, LineMark>; explained: ReadonlyMap<string, string>; selection: Selection | null };
type RowActions = {
  word: (ref: WordRef, word: string) => void;
  speaker: (at: number) => void;
  selectLines: (lines: TimelineLine[]) => void;
  openLine: (at: number) => void;
  typed: (text: string) => void;
  blurLine: (at: number) => void;
  undoLine: (at: number) => void;
};

// Everything a row draws, as text. A row redraws only when this changes. `edit` is the open line while Edit is on
// (undefined when it is off), so a row redraws when its line opens or closes.
function rowSig(item: Row, view: RowView, edit: number | null | undefined): string {
  if (item.kind !== "paragraph") return JSON.stringify(item);
  const { selection } = view;
  const explained = [...view.explained.keys()];
  return item.lines
    .map((line) => {
      const mark = view.marks.get(line.at);
      const chosen = selection !== null && line.at >= selection.from.at && line.at <= selection.to.at ? `${refKey(selection.from)}-${refKey(selection.to)}` : "";
      const words = explained.filter((key) => key.startsWith(`${line.at}:`)).join(",");
      const editing = edit === undefined ? "" : edit === line.at ? "|open" : "|edit";
      return `${line.key}|${line.text}|${mark === undefined ? "" : JSON.stringify(mark)}|${chosen}|${words}${editing}`;
    })
    .join("\n");
}

// The open line shows the text it had when it opened (T10), so a row's field is never rewritten under the person.
function withOpenedText(item: Row, opened: { at: number; text: string } | null, edit: number | null | undefined): Row {
  if (opened === null || edit !== opened.at || item.kind !== "paragraph" || !item.lines.some((line) => line.at === opened.at)) return item;
  return { ...item, lines: item.lines.map((line) => (line.at === opened.at ? { ...line, text: opened.text } : line)) };
}

function Transcript({ model, onClose }: { model: Model; onClose: () => void }) {
  const colors = useColors();
  const scroll = useRef<ScrollViewInstance>(null);
  const following = useRef(true);
  const touching = useRef(false); // the person's finger or fling is moving the list; the screen's own scrolling never sets this
  const position = useRef({ contentHeight: 0, offsetY: 0, viewHeight: 0 });
  const [showJump, setShowJump] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const paused = model.recorder === "paused";
  const showPause = paused && model.pauseReason !== "user" && model.pauseReason !== "none";
  const extras = useStableQuery((db) => transcriptExtras(db, model.sessionId), model.sessionId ?? "");
  // Edit (T10): the lines as shown, read only when the editor saves (to tell whether anything changed). Set with the lines, below.
  const linesRef = useRef<TimelineLine[]>([]);
  // The text the open line had when it opened. Its field keeps it, so a re-transcription does not rewrite what the person sees.
  const openedRef = useRef<{ at: number; text: string } | null>(null);
  const editor = useLineEditor(model.sessionId, (at) => linesRef.current.find((line) => line.at === at)?.text ?? null);
  const { save: saveOpenLine } = editor;
  const marks = useMemo(() => new Map(extras.marks.map((mark) => [mark.tStart, mark] as const)), [extras.marks]);
  // Edit shows hidden lines too, so a line just cleared keeps its Undo on screen.
  const timeline = useMemo(() => applyMarks(model.timeline, marks, showHidden || editor.on), [model.timeline, marks, showHidden, editor.on]);
  const rows = useMemo(() => groupTimeline(timeline), [timeline]);
  const lines = useMemo(() => timeline.filter((item): item is TimelineLine => item.kind === "line"), [timeline]);
  linesRef.current = lines;
  // The open line's shown text changed under it (a re-transcription or a sync): what was typed is saved first.
  const openShown = useMemo(
    () => (editor.open === null ? null : (lines.find((line) => line.at === editor.open)?.text ?? null)),
    [lines, editor.open],
  );
  useEffect(() => saveOpenLine(), [openShown, saveOpenLine]);
  const edit = editor.on ? editor.open : undefined;
  const explained = useMemo(
    () => explainedWords(lines.map((line) => ({ at: line.at, text: line.text })), extras.explanations),
    [lines, extras.explanations],
  );
  const view = useMemo<RowView>(() => ({ marks, explained, selection }), [marks, explained, selection]);
  const sigs = useMemo(() => rows.map((row) => rowSig(row, view, edit)), [rows, view, edit]);
  const hiddenCount = extras.marks.filter((mark) => mark.hidden).length;
  // A selection whose words were hidden picks nothing: it is cleared, not kept.
  const stale = selection !== null && liveSelection(selection, lines) === null;
  useEffect(() => {
    if (stale) setSelection(null);
  }, [stale]);
  // Words still being heard that will join the last paragraph show under it with no time of their own.
  const lastRow = rows.at(-1);
  const lastLine = lastRow?.kind === "paragraph" ? lastRow.lines.at(-1) : undefined;
  const continuesParagraph = model.volatile !== null && lastLine !== undefined && model.volatile.tStart - lastLine.end < PARAGRAPH_PAUSE_MS;

  function setFollowing(next: boolean): void {
    following.current = next;
    setShowJump(!next);
  }

  function remember(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    position.current = { contentHeight: contentSize.height, offsetY: contentOffset.y, viewHeight: layoutMeasurement.height };
  }

  // While a line is open, a drag that ends at the bottom does not turn following back on: new lines must not scroll it away.
  function settleFollowing(): void {
    if (editor.open === null) setFollowing(isAtEnd(position.current));
  }

  function readPosition(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    remember(event);
    settleFollowing();
  }

  // Rows are memoized, so they call the latest selection model through this ref, and their handlers never change.
  const selected = selectionModel({
    sessionId: model.sessionId,
    lines,
    marks,
    explained,
    explanations: extras.explanations,
    selection,
    setSelection,
    canChange: true,
    // Words chosen while new lines arrive stay in view: the list stops following until Jump to live.
    onSelect: () => setFollowing(false),
  });
  const latest = useRef(selected);
  latest.current = selected;
  const latestEditor = useRef(editor);
  latestEditor.current = editor;
  const [actions] = useState<RowActions>(() => ({
    word: (ref, word) => latest.current.tapWord(ref, word),
    speaker: (at) => latest.current.renameRun(at),
    selectLines: (rowLines) => setSelection(paragraphSelection(rowLines)),
    // Opening a line stops the list from following the live end, so new lines do not move it. Jump to live brings it back.
    openLine: (at) => {
      setFollowing(false);
      openedRef.current = { at, text: linesRef.current.find((line) => line.at === at)?.text ?? "" };
      latestEditor.current.openLine(at);
    },
    typed: (text) => latestEditor.current.typed(text),
    blurLine: (at) => latestEditor.current.blurLine(at),
    undoLine: (at) => latestEditor.current.undoLine(at),
  }));

  return (
    <View style={styles.transcriptArea}>
      <View style={styles.topRow}>
        <CircleButton label="Close" icon="chevron.down" onPress={onClose} />
        <FolderPill sessionId={model.sessionId} fallback={model.spaceName} title={model.title} />
        <EditSwitch
          on={editor.on}
          onChange={(on) => {
            setSelection(null);
            editor.setOn(on);
          }}
        />
      </View>
      <Title>{model.title}</Title>
      {editor.on ? (
        <EditingBar hint="Tap a line to type. Recording keeps going and new lines keep coming." onDone={() => editor.setOn(false)} />
      ) : null}

      {hiddenCount > 0 || showHidden ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            setSelection(null);
            setShowHidden(!showHidden);
          }}
          style={styles.hiddenRow}
        >
          <Text style={[styles.hiddenText, { color: colors.accent }]}>
            {showHidden ? "Hide hidden lines" : `Show ${countLabel(hiddenCount, "hidden line", "hidden lines")}`}
          </Text>
        </Pressable>
      ) : null}

      {model.banner ? <BannerView banner={model.banner} /> : null}
      {showPause ? (
        <View style={[styles.card, { backgroundColor: colors.flagSoft, borderColor: colors.flag }]}>
          <View style={styles.cardHead}>
            <SymbolView name="mic.slash.fill" tintColor={colors.flag} size={20} />
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, { color: colors.flagInk }]}>Recording paused at {formatClock(model.clockMs)}</Text>
              <Text style={[styles.cardBody, { color: colors.flagInk }]}>{PAUSE_REASONS[model.pauseReason] ?? ""}</Text>
              <Text style={[styles.cardBody, { color: colors.flagInk }]}>Nothing before {formatClock(model.clockMs)} was lost.</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resume recording"
              onPress={model.resume}
              style={[styles.wideButton, { backgroundColor: colors.rec }]}
            >
              <SymbolView name="mic.fill" tintColor={colors.onRec} size={16} />
              <Text style={[styles.buttonText, { color: colors.onRec }]}>Resume recording</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save and stop"
              onPress={model.stop}
              style={[styles.wideButton, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.buttonText, { color: colors.ink }]}>Save & stop</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={scroll}
        style={styles.flex}
        contentContainerStyle={styles.lines}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        onScroll={(event) => {
          remember(event);
          if (touching.current) settleFollowing();
        }}
        scrollEventThrottle={100}
        onTouchEnd={() => {
          // A tap that stops a fling can end it with no scroll event, which would leave `touching` set.
          if (!touching.current) return;
          touching.current = false;
          settleFollowing();
        }}
        onLayout={() => {
          // The pause card appearing shrinks the list, and that is not a content change.
          if (following.current) scroll.current?.scrollToEnd({ animated: false });
        }}
        onScrollBeginDrag={() => {
          touching.current = true;
        }}
        onScrollEndDrag={(event) => {
          touching.current = false;
          readPosition(event);
        }}
        onMomentumScrollBegin={() => {
          touching.current = true;
        }}
        onMomentumScrollEnd={(event) => {
          if (!touching.current) return; // the end of the screen's own animated scroll
          touching.current = false;
          readPosition(event);
        }}
        onContentSizeChange={() => {
          if (following.current && !touching.current) scroll.current?.scrollToEnd({ animated: true });
        }}
      >
        {rows.map((item, i) => (
          <TimelineRow key={item.key} item={withOpenedText(item, openedRef.current, edit)} sig={sigs[i] ?? ""} view={view} actions={actions} edit={edit} />
        ))}
        {model.volatile ? (
          <View style={[styles.volatile, continuesParagraph ? styles.volatileJoined : null]}>
            {continuesParagraph ? null : <Text style={[styles.time, { color: colors.ink3, minWidth: 0 }]}>{formatOffset(model.volatile.tStart)}</Text>}
            <Text style={[{ fontSize: 17, lineHeight: 26 }, { color: colors.ink3 }]}>{model.volatile.text}</Text>
          </View>
        ) : null}
      </ScrollView>

      {showJump && selected.picked === null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Jump to live"
          onPress={() => {
            setFollowing(true);
            scroll.current?.scrollToEnd({ animated: true });
          }}
          style={[styles.jump, { backgroundColor: colors.ink }]}
        >
          <SymbolView name="arrow.down" tintColor={colors.bg} size={14} />
          <Text style={[styles.toastText, { color: colors.bg }]}>Jump to live</Text>
        </Pressable>
      ) : null}

      {model.toast ? (
        <View style={[styles.toast, { backgroundColor: colors.ink }]}>
          <SymbolView name="questionmark.bubble.fill" tintColor={colors.bg} size={14} />
          <Text style={[styles.toastText, { color: colors.bg }]}>Saved to ask later at {formatOffset(model.toast.t)}</Text>
        </View>
      ) : null}

      {selected.picked !== null && !editor.on ? (
        <SelectionBar
          text={selected.picked.text}
          single={selected.single}
          canExplain={selected.canExplain}
          highlighted={selected.highlighted}
          inset={false}
          onExplain={selected.explain}
          onHighlight={selected.highlight}
          onNote={selected.note}
          onMore={selected.more}
          onClose={() => setSelection(null)}
        />
      ) : null}
    </View>
  );
}

// Where this recording is being saved. Tapping it moves the recording; the microphone keeps running under the sheet.
function FolderPill({ sessionId, fallback, title }: { sessionId: string | null; fallback: string; title: string }) {
  const colors = useColors();
  const name = useQuery((db) => {
    const session = sessionId === null ? null : getSession(db, sessionId);
    return session === null ? fallback : (getSpace(db, session.spaceId)?.name ?? fallback);
  }, `${sessionId ?? ""}|${fallback}`);
  // The Lock Screen shows the folder too. The native side sends nothing when the words did not change.
  useEffect(() => {
    if (sessionId !== null) setRecordingLabel({ title, place: name });
  }, [sessionId, title, name]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Saving to ${name}. Change folder`}
      disabled={sessionId === null}
      onPress={() => router.push(`/space-picker?sessionId=${encodeURIComponent(sessionId ?? "")}`)}
      style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <SymbolView name="folder.fill" tintColor={colors.ink3} size={14} />
      <Text style={[styles.pillText, { color: colors.ink }]}>{name}</Text>
      <SymbolView name="chevron.down" tintColor={colors.ink3} size={12} />
    </Pressable>
  );
}

type TimelineRowProps = { item: Row; sig: string; view: RowView; actions: RowActions; edit: number | null | undefined };

const TimelineRow = memo(
  function TimelineRow({ item, view, actions, edit }: TimelineRowProps) {
    if (item.kind !== "paragraph") return <TimeMarkRow item={item} interactive={item.kind === "photo"} canChange />;
    // Only this paragraph's slice of the marks and words, and the selection only when it reaches this paragraph.
    const slice = paragraphSlice(item.lines, view.marks, view.explained);
    const range = view.selection;
    const reached = range !== null && item.lines.some((line) => line.at >= range.from.at && line.at <= range.to.at);
    return (
      <ParagraphRow
        at={item.at}
        lines={item.lines}
        marks={slice.marks}
        explained={slice.explained}
        selection={reached ? range : null}
        onWord={actions.word}
        onSpeaker={actions.speaker}
        onSelectParagraph={actions.selectLines}
        editing={
          edit === undefined
            ? undefined
            : { onOpen: actions.openLine, onType: actions.typed, onBlur: actions.blurLine, onUndo: actions.undoLine }
        }
        editOpen={edit}
      />
    );
  },
  // Only what the row draws: new lines keep arriving while recording, and every other row stays as it is.
  (a, b) => a.sig === b.sig && a.actions === b.actions,
);

function BannerView({ banner }: { banner: Banner }) {
  const colors = useColors();
  if (banner === null) return null;
  if (banner.kind === "unsupported") {
    return (
      <View style={[styles.card, { backgroundColor: colors.flagSoft, borderColor: colors.flag }]}>
        <Text style={[styles.cardBody, { color: colors.flagInk }]}>This iPhone can't write down this language yet. Your audio is saved.</Text>
      </View>
    );
  }
  return (
    <View style={[styles.card, { backgroundColor: colors.flagSoft, borderColor: colors.flag }]}>
      <Text style={[styles.cardTitle, { color: colors.flagInk }]}>Recording now. Words appear when offline speech finishes downloading.</Text>
      <View style={[styles.progressTrack, { backgroundColor: colors.surface }]}>
        <View style={[styles.progressFill, { width: `${banner.percent}%`, backgroundColor: colors.flag }]} />
      </View>
      <Text style={[styles.cardBody, { color: colors.flagInk }]}>{banner.percent}% · your audio is safe either way</Text>
    </View>
  );
}

// Stop asks first, so a mistap does not end the recording. The microphone keeps running while the alert is open.
function confirmStop(model: Model): void {
  Alert.alert("Stop and save this recording?", undefined, [
    { text: "Keep recording", style: "cancel" },
    { text: "Stop and save", onPress: model.stop },
  ]);
}

function Dock({ model }: { model: Model }) {
  const colors = useColors();
  const paused = model.recorder === "paused";
  const live = model.recorder === "recording";
  return (
    <View style={[styles.dock, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: live ? colors.rec : colors.ink4 }]} />
        {paused ? <Text style={[styles.pausedText, { color: colors.ink3 }]}>Paused</Text> : null}
        <Text style={[styles.clock, { color: colors.ink }]} accessibilityLabel={`Recorded ${formatClock(model.clockMs)}`}>
          {formatClock(model.clockMs)}
        </Text>
        <View style={styles.flex} />
        <CircleButton
          label={paused ? "Resume" : "Pause"}
          icon={paused ? "play.fill" : "pause.fill"}
          onPress={paused ? model.resume : model.pause}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          disabled={model.stopping}
          onPress={() => confirmStop(model)}
          style={[styles.stop, { backgroundColor: colors.rec, opacity: model.stopping ? 0.5 : 1 }]}
        >
          <SymbolView name="stop.fill" tintColor={colors.onRec} size={14} />
          <Text style={[styles.buttonText, { color: colors.onRec }]}>Stop</Text>
        </Pressable>
      </View>

      <Waveform />

      <View style={styles.actions}>
        <ActionButton label="Photo" icon="camera.fill" onPress={model.photo} />
        <ActionButton label="Ask later" icon="questionmark.bubble" onPress={model.flag} />
        <ActionButton label="Note" icon="note.text" onPress={model.note} />
      </View>
    </View>
  );
}

function ActionButton({ label, icon, onPress }: { label: string; icon: SFSymbol; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.action}>
      <View style={[styles.actionCircle, { backgroundColor: colors.surface2 }]}>
        <SymbolView name={icon} tintColor={colors.ink} size={20} />
      </View>
      <Text style={[styles.actionLabel, { color: colors.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

function CircleButton({ label, icon, onPress }: { label: string; icon: SFSymbol; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.circle, { backgroundColor: colors.surface }]}>
      <SymbolView name={icon} tintColor={colors.ink} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  centeredText: { textAlign: "center" },
  micOff: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  footer: { padding: 20, gap: 12 },
  transcriptArea: { flex: 1, paddingHorizontal: 20, paddingTop: 8, gap: 12 },
  hiddenRow: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  hiddenText: { fontSize: 15, fontWeight: "600" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  pillText: { fontSize: 15, fontWeight: "600" },
  card: { padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 10 },
  cardHead: { flexDirection: "row", gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardBody: { fontSize: 14, lineHeight: 20 },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6 },
  lines: { gap: 22, paddingBottom: 12 },
  volatile: { gap: 6 },
  volatileJoined: { marginTop: -16 },
  time: { fontSize: 13, fontVariant: ["tabular-nums"], minWidth: 44, paddingTop: 2 },
  toast: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  toastText: { fontSize: 14, fontWeight: "600" },
  dock: { margin: 12, padding: 16, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  clock: { fontSize: 26, fontWeight: "600", fontVariant: ["tabular-nums"] },
  pausedText: { fontSize: 15, fontWeight: "600" },
  stop: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 16, borderRadius: 22 },
  buttonText: { fontSize: 16, fontWeight: "600" },
  wideButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 14 },
  jump: { position: "absolute", bottom: 8, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 16, borderRadius: 22 },
  actions: { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-end" },
  action: { alignItems: "center", gap: 6, width: 80 },
  actionCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 13 },
});
