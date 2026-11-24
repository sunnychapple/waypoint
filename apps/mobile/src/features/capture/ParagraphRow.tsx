import { Fragment } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { speakerLabel, type LineMark } from "../../core/capture/marks.ts";
import { isSelected, refKey, type Selection, type WordRef } from "../../core/capture/selection.ts";
import type { TimelineLine } from "../../core/capture/timeline.ts";
import { splitWords } from "../../core/explain/excerpt.ts";
import { formatOffset } from "../../core/format.ts";
import { useColors, type Colors } from "../../ui/theme.ts";

// What a paragraph draws on its words: the person's marks by line start, explained words (refKey → explanation id), and
// the selection.
export type ParagraphView = { marks: ReadonlyMap<number, LineMark>; explained: ReadonlyMap<string, string>; selection: Selection | null };
const NO_VIEW: ParagraphView = { marks: new Map(), explained: new Map(), selection: null };

// A paragraph of a transcript: one time above it, then its lines as running text. A line's name shows before it when it
// is not the name of the line before. With `onPlay`, the time plays the recording from there.
export function ParagraphRow({
  at,
  lines,
  onWord,
  onPlay,
  lit = false,
  onLayout,
  view = NO_VIEW,
  onSpeaker,
  onSelectParagraph,
}: {
  at: number;
  lines: TimelineLine[];
  onWord: (ref: WordRef, word: string) => void;
  onPlay?: (() => void) | undefined;
  lit?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  view?: ParagraphView;
  onSpeaker?: ((at: number) => void) | undefined;
  onSelectParagraph?: (() => void) | undefined;
}) {
  const colors = useColors();
  const time = <Text style={[styles.time, { color: onPlay ? colors.accent : colors.ink3 }]}>{formatOffset(at)}</Text>;
  const timeRow = onPlay ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`Play from ${formatOffset(at)}`} hitSlop={12} onPress={onPlay} style={styles.timeButton}>
      {time}
    </Pressable>
  ) : (
    time
  );
  return (
    <View onLayout={onLayout} style={[styles.paragraph, lit ? [styles.lit, { backgroundColor: colors.accentSoft }] : null]}>
      {timeRow}
      <Text
        accessibilityHint="Tap a word to select it"
        accessibilityActions={onSelectParagraph ? [{ name: "select", label: "Select this paragraph" }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "select") onSelectParagraph?.();
        }}
        style={[styles.text, { color: colors.ink }]}
      >
        {lines.map((line, index) => {
          const mark = view.marks.get(line.at);
          const speaker = mark?.speaker ?? null;
          const previous = lines[index - 1];
          const before = previous === undefined ? null : (view.marks.get(previous.at)?.speaker ?? null);
          const label = speaker !== null && (index === 0 || speaker !== before) ? speaker : null;
          return (
            <Fragment key={line.key}>
              {index > 0 ? " " : null}
              {label !== null ? (
                <Text onPress={onSpeaker ? () => onSpeaker(line.at) : undefined} style={[styles.speaker, { color: colors.ink2 }]}>
                  {`${speakerLabel(label)}: `}
                </Text>
              ) : null}
              <LineWords line={line} mark={mark} view={view} colors={colors} onWord={onWord} />
            </Fragment>
          );
        })}
      </Text>
    </View>
  );
}

// One line's words. Selected words are tinted, highlighted words are yellow, explained words are underlined, and a hidden
// line (shown with Show hidden lines) is faint. Words are counted with wordsOf's split (selection.ts), so a position here
// is the same word everywhere else.
function LineWords({
  line,
  mark,
  view,
  colors,
  onWord,
}: {
  line: TimelineLine;
  mark: LineMark | undefined;
  view: ParagraphView;
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
        const background = isSelected(view.selection, ref) ? colors.accentSoft : highlighted ? colors.flagSoft : undefined;
        return (
          <Text
            key={position}
            onPress={() => onWord(ref, word)}
            suppressHighlighting={false}
            style={[
              background === undefined ? null : { backgroundColor: background },
              view.explained.has(refKey(ref)) ? [styles.explained, { textDecorationColor: colors.accent }] : null,
            ]}
          >
            {token.text}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  paragraph: { gap: 6 },
  lit: { borderRadius: 10, paddingHorizontal: 6, marginHorizontal: -6 },
  timeButton: { alignSelf: "flex-start" },
  time: { fontSize: 13, fontVariant: ["tabular-nums"] },
  text: { fontSize: 17, lineHeight: 26 },
  speaker: { fontWeight: "700" },
  explained: { textDecorationLine: "underline", textDecorationStyle: "dotted" },
});
