import { Fragment, memo } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
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
          const speaker = mark?.speaker ?? null;
          const previous = lines[index - 1];
          const before = previous === undefined ? null : (marks.get(previous.at)?.speaker ?? null);
          const label = speaker !== null && (index === 0 || speaker !== before) ? speaker : null;
          const named = label === null ? null : speakerLabel(label);
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
});
