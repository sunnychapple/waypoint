import { Fragment, memo } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { speakerLabel, type LineMark } from "../../core/capture/marks.ts";
import { isSelected, refKey, type Selection, type WordRef } from "../../core/capture/selection.ts";
import type { TimelineLine } from "../../core/capture/timeline.ts";
import { splitWords } from "../../core/explain/excerpt.ts";
import { formatOffset } from "../../core/format.ts";
import { useColors, type Colors } from "../../ui/theme.ts";

const NO_MARKS: ReadonlyMap<number, LineMark> = new Map();
const NO_EXPLAINED: ReadonlyMap<string, string> = new Map();

// The part of the marks and explained words that one paragraph draws: its lines' marks by line start, and its explained
// words (refKey → explanation id). The screen builds each paragraph's slice once per change of the data, so a paragraph
// keeps the same slice (and is not redrawn) while the person taps elsewhere.
export function paragraphSlice(
  lines: TimelineLine[],
  marks: ReadonlyMap<number, LineMark>,
  explained: ReadonlyMap<string, string>,
): { marks: ReadonlyMap<number, LineMark>; explained: ReadonlyMap<string, string> } {
  const ats = new Set(lines.map((line) => line.at));
  const ownMarks = new Map<number, LineMark>();
  for (const at of ats) {
    const mark = marks.get(at);
    if (mark !== undefined) ownMarks.set(at, mark);
  }
  const ownExplained = new Map<string, string>();
  for (const [key, id] of explained) {
    if (ats.has(Number(key.slice(0, key.lastIndexOf(":"))))) ownExplained.set(key, id);
  }
  return { marks: ownMarks, explained: ownExplained };
}

// Edit mode (T9): what tapping, typing, leaving and Undo do. The screen passes one object to every paragraph; the open line
// goes in `editOpen` per paragraph, so a paragraph without it keeps the same props and is not redrawn.
export type LineEditing = {
  onOpen: (at: number) => void;
  onType: (text: string) => void;
  onBlur: (at: number) => void;
  onUndo: (at: number) => void;
};

// The name shown before line `index`: its speaker, unless the line before has the same one (T6).
function shownName(lines: TimelineLine[], marks: ReadonlyMap<number, LineMark>, index: number): string | null {
  const line = lines[index];
  const speaker = line === undefined ? null : (marks.get(line.at)?.speaker ?? null);
  const previous = lines[index - 1];
  const before = previous === undefined ? null : (marks.get(previous.at)?.speaker ?? null);
  return speaker !== null && (index === 0 || speaker !== before) ? speakerLabel(speaker) : null;
}

// Whether a line holds part of the selection (by its start, which is what the selection's ends are compared with).
function touchesLine(selection: Selection | null, line: TimelineLine): boolean {
  return selection !== null && selection.from.at <= line.at && line.at <= selection.to.at;
}

// A paragraph of a transcript: one time above it, then its lines as running text. A line's name shows before it when it
// is not the name of the line before. With `onPlay`, the time plays the recording from there.
// Every callback is called with the paragraph's own data (its time, its lines), so the screen can pass one stable
// function to all paragraphs, and `memo` skips the paragraphs a tap does not touch. `selection` is the selection only
// when it reaches this paragraph (null otherwise).
export const ParagraphRow = memo(function ParagraphRow({
  at,
  lines,
  onWord,
  onPlay,
  lit = false,
  onLayout,
  marks = NO_MARKS,
  explained = NO_EXPLAINED,
  selection = null,
  canChange = true,
  onSpeaker,
  onSelectParagraph,
  editing,
  editOpen = null,
}: {
  at: number;
  lines: TimelineLine[];
  onWord: (ref: WordRef, word: string) => void;
  onPlay?: ((at: number) => void) | undefined;
  lit?: boolean | undefined;
  onLayout?: ((event: LayoutChangeEvent) => void) | undefined;
  marks?: ReadonlyMap<number, LineMark> | undefined;
  explained?: ReadonlyMap<string, string> | undefined;
  selection?: Selection | null | undefined;
  // false for a viewer of a shared space: words are explained, not selected, and a name is not changed.
  canChange?: boolean | undefined;
  onSpeaker?: ((at: number) => void) | undefined;
  onSelectParagraph?: ((lines: TimelineLine[]) => void) | undefined;
  // Edit mode (T9): present only while Edit is on for a person who can change the transcript.
  editing?: LineEditing | undefined;
  // The line open for typing, when it is in this paragraph (null otherwise).
  editOpen?: number | null | undefined;
}) {
  const colors = useColors();
  const time = <Text style={[styles.time, { color: onPlay ? colors.accent : colors.ink3 }]}>{formatOffset(at)}</Text>;
  const timeRow = onPlay ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`Play from ${formatOffset(at)}`} hitSlop={12} onPress={() => onPlay(at)} style={styles.timeButton}>
      {time}
    </Pressable>
  ) : (
    time
  );
  if (editing !== undefined) {
    return (
      <View onLayout={onLayout} style={styles.paragraph}>
        {timeRow}
        {lines.map((line, index) => (
          <EditableLine
            key={line.key}
            line={line}
            named={shownName(lines, marks, index)}
            mark={marks.get(line.at)}
            open={editOpen === line.at}
            editing={editing}
            colors={colors}
          />
        ))}
      </View>
    );
  }
  return (
    <View onLayout={onLayout} style={[styles.paragraph, lit ? [styles.lit, { backgroundColor: colors.accentSoft }] : null]}>
      {timeRow}
      <Text
        accessibilityHint={canChange ? "Tap a word to select it" : "Tap a word to explain it"}
        accessibilityActions={onSelectParagraph ? [{ name: "select", label: "Select this paragraph" }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName !== "select" || onSelectParagraph === undefined) return;
          onSelectParagraph(lines);
          AccessibilityInfo.announceForAccessibility("Paragraph selected. Actions are at the bottom.");
        }}
        style={[styles.text, { color: colors.ink }]}
      >
        {lines.map((line, index) => {
          const mark = marks.get(line.at);
          const named = shownName(lines, marks, index);
          return (
            <Fragment key={line.key}>
              {index > 0 ? " " : null}
              {named !== null ? (
                <Text
                  accessibilityRole={canChange && onSpeaker ? "button" : undefined}
                  accessibilityLabel={canChange && onSpeaker ? `Speaker: ${named}. Change speaker` : undefined}
                  onPress={canChange && onSpeaker ? () => onSpeaker(line.at) : undefined}
                  style={[styles.speaker, { color: colors.ink2 }]}
                >
                  {`${named}: `}
                </Text>
              ) : null}
              <LineWords
                line={line}
                mark={mark}
                selection={touchesLine(selection, line) ? selection : null}
                explained={explained}
                colors={colors}
                onWord={onWord}
              />
            </Fragment>
          );
        })}
      </Text>
    </View>
  );
});

// One line in Edit mode (T9): tap it to type in it. A line with the person's words, or a hidden one, shows Undo, which brings
// back what was heard. Only one line is open at a time; it is a field, with the cursor at its end.
function EditableLine({
  line,
  named,
  mark,
  open,
  editing,
  colors,
}: {
  line: TimelineLine;
  named: string | null;
  mark: LineMark | undefined;
  open: boolean;
  editing: LineEditing;
  colors: Colors;
}) {
  return (
    <View style={styles.editLine}>
      {open ? (
        <TextInput
          autoFocus
          multiline
          scrollEnabled={false}
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          defaultValue={line.text}
          onChangeText={editing.onType}
          onBlur={() => editing.onBlur(line.at)}
          accessibilityLabel={`Line at ${formatOffset(line.at)}`}
          style={[styles.text, styles.input, { color: colors.ink, borderColor: colors.accent, backgroundColor: colors.surface }]}
        />
      ) : (
        <Text
          accessibilityRole="button"
          accessibilityHint="Opens this line for typing"
          onPress={() => editing.onOpen(line.at)}
          style={[styles.text, { color: mark?.hidden === true ? colors.ink4 : colors.ink }]}
        >
          {named !== null ? <Text style={styles.speaker}>{`${named}: `}</Text> : null}
          {line.text}
        </Text>
      )}
      {!open && mark !== undefined && (mark.text !== null || mark.hidden) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Undo. Brings back what was heard"
          hitSlop={12}
          onPress={() => editing.onUndo(line.at)}
          style={styles.undo}
        >
          <Text style={[styles.undoText, { color: colors.accent }]}>{mark.text !== null ? "Edited · Undo" : "Undo"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// One line's words. Selected words are tinted, highlighted words are yellow, explained words are underlined, and a hidden
// line (shown with Show hidden lines) is faint. Words are counted with wordsOf's split (selection.ts), so a position here
// is the same word everywhere else. A line is redrawn only when its text, its mark, its part of the selection or its
// explained words change.
const LineWords = memo(function LineWords({
  line,
  mark,
  selection,
  explained,
  colors,
  onWord,
}: {
  line: TimelineLine;
  mark: LineMark | undefined;
  selection: Selection | null;
  explained: ReadonlyMap<string, string>;
  colors: Colors;
  onWord: (ref: WordRef, word: string) => void;
}) {
  let index = -1;
  return (
    <Text style={mark?.hidden === true ? { color: colors.ink4 } : undefined}>
      {splitWords(line.text).map((token, position) => {
        const word = token.word;
        if (word === null) return token.text;
        index += 1;
        const ref = { at: line.at, index };
        const highlighted = mark?.highlights.some(([from, to]) => from <= ref.index && ref.index <= to) === true;
        const background = isSelected(selection, ref) ? colors.accentSoft : highlighted ? colors.flagSoft : undefined;
        return (
          <Text
            key={position}
            onPress={() => onWord(ref, word)}
            suppressHighlighting={false}
            style={[
              background === undefined ? null : { backgroundColor: background },
              explained.has(refKey(ref)) ? [styles.explained, { textDecorationColor: colors.accent }] : null,
            ]}
          >
            {token.text}
          </Text>
        );
      })}
    </Text>
  );
});

const styles = StyleSheet.create({
  paragraph: { gap: 6 },
  lit: { borderRadius: 10, paddingHorizontal: 6, marginHorizontal: -6 },
  timeButton: { alignSelf: "flex-start" },
  time: { fontSize: 13, fontVariant: ["tabular-nums"] },
  text: { fontSize: 17, lineHeight: 26 },
  speaker: { fontWeight: "700" },
  explained: { textDecorationLine: "underline", textDecorationStyle: "dotted" },
  editLine: { gap: 2 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4 },
  undo: { alignSelf: "flex-start" },
  undoText: { fontSize: 13, fontWeight: "600" },
});
