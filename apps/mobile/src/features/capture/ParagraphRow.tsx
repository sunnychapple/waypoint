import { Fragment } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import type { TimelineLine } from "../../core/capture/timeline.ts";
import { formatOffset } from "../../core/format.ts";
import { WordText } from "../../ui/WordText.tsx";
import { useColors } from "../../ui/theme.ts";

// A paragraph of a transcript: one time above it, then its lines as running text.
// With `onPlay`, the time plays the recording from there.
export function ParagraphRow({
  at,
  lines,
  onWord,
  onPlay,
  lit = false,
  onLayout,
}: {
  at: number;
  lines: TimelineLine[];
  onWord: (word: string, at: number) => void;
  onPlay?: (() => void) | undefined;
  lit?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const colors = useColors();
  const time = <Text style={[styles.time, { color: onPlay ? colors.accent : colors.ink3 }]}>{formatOffset(at)}</Text>;
  return (
    <View onLayout={onLayout} style={[styles.paragraph, lit ? [styles.lit, { backgroundColor: colors.accentSoft }] : null]}>
      {onPlay ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Play from ${formatOffset(at)}`} hitSlop={12} onPress={onPlay} style={styles.timeButton}>
          {time}
        </Pressable>
      ) : (
        time
      )}
      <Text accessibilityHint="Tap a word to explain it" style={[styles.text, { color: colors.ink }]}>
        {lines.map((line, index) => (
          <Fragment key={line.key}>
            {index > 0 ? " " : null}
            <WordText text={line.text} onWord={(word) => onWord(word, line.at)} />
          </Fragment>
        ))}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  paragraph: { gap: 6 },
  lit: { borderRadius: 10, paddingHorizontal: 6, marginHorizontal: -6 },
  timeButton: { alignSelf: "flex-start" },
  time: { fontSize: 13, fontVariant: ["tabular-nums"] },
  text: { fontSize: 17, lineHeight: 26 },
});
