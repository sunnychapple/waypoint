# Usage notes 3: readable transcripts and recordings that belong to one phone

From the owner's class notes of 22 Nov 2026 (note 4, board S1) and a sync bug found in review. Written against `main` at `dee7b80`. All paths are under `apps/mobile/`. U6 and U9 touch different files and are built at the same time. Build only your own card.

---

## U6 · Paragraphs with one time each

Branch `fix/u6-paragraphs`. Files, and no others:
`src/core/capture/timeline.ts`, the existing timeline test file in `test/` (find it with `grep -l buildTimeline test/*.ts`), `src/features/capture/ParagraphRow.tsx` (new), `src/features/capture/RecordScreen.tsx`, `src/features/capture/SessionScreen.tsx`, `docs/cards/usage-notes-3.md` (new: this file, copied as it is).

Today every short line has its own time, packed tightly. On board S1, lines group into paragraphs with one time above each.

### timeline.ts

1. The `line` item gains its end time: `{ kind: "line"; key: string; at: number; end: number; text: string }`, and `buildTimeline` sets `end: piece.tEnd`. Update the expected objects in the existing tests only for this new field.

2. Add at the end of the file:

```ts
export type TimelineLine = Extract<TimelineItem, { kind: "line" }>;
export type TimelineRow = { kind: "paragraph"; key: string; at: number; lines: TimelineLine[] } | Exclude<TimelineItem, { kind: "line" }>;

const PARAGRAPH_PAUSE_MS = 3000;
const PARAGRAPH_MAX_MS = 30_000;

// Lines said close together become one paragraph, shown with one time. A pause of 3 seconds, 30 seconds of speech, or a
// gap, flag or photo starts a new one. Every line keeps its own time, so a tapped word still knows when it was said.
export function groupTimeline(items: TimelineItem[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const item of items) {
    if (item.kind !== "line") {
      rows.push(item);
      continue;
    }
    const last = rows.at(-1);
    const previous = last?.kind === "paragraph" ? last.lines.at(-1) : undefined;
    if (last?.kind === "paragraph" && previous !== undefined && item.at - previous.end < PARAGRAPH_PAUSE_MS && item.end - last.at <= PARAGRAPH_MAX_MS) {
      last.lines.push(item);
    } else {
      rows.push({ kind: "paragraph", key: item.key, at: item.at, lines: [item] });
    }
  }
  return rows;
}
```

3. Tests for `groupTimeline`: lines 2,999 ms apart join; lines 3,000 ms apart split; a line that would make the paragraph longer than 30 seconds splits, and one ending at exactly 30 seconds joins; a flag between two close lines splits them and stays in place; the paragraph's key and time are its first line's; an empty list gives an empty list.

### ParagraphRow.tsx

```tsx
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
      <Text style={[styles.text, { color: colors.ink }]}>
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
```

### RecordScreen.tsx

1. Import `ParagraphRow` from `./ParagraphRow.tsx`, and `groupTimeline` and `type TimelineRow as Row` from `../../core/capture/timeline.ts`. Add `useMemo` to the React import.

2. In `Transcript`, before the `return`: `const rows = useMemo(() => groupTimeline(model.timeline), [model.timeline]);` and render `rows.map((item) => <TimelineRow key={item.key} item={item} sessionId={model.sessionId} />)`.

3. Replace the `TimelineRow` component, keeping `memo`:

```tsx
const TimelineRow = memo(
  function TimelineRow({ item, sessionId }: { item: Row; sessionId: string | null }) {
    if (item.kind !== "paragraph") return <TimeMarkRow item={item} interactive={item.kind === "photo"} />;
    return (
      <ParagraphRow
        at={item.at}
        lines={item.lines}
        onWord={(word, at) => {
          if (sessionId !== null) router.push({ pathname: "/explain", params: { sessionId, t: String(at), word } });
        }}
      />
    );
  },
  // A paragraph changes only by gaining lines; a written line never changes.
  (a, b) =>
    a.sessionId === b.sessionId &&
    a.item.key === b.item.key &&
    (a.item.kind !== "paragraph" || b.item.kind !== "paragraph" || a.item.lines.length === b.item.lines.length),
);
```

4. The words still being heard (`model.volatile`) are drawn as a paragraph too: a `<View style={styles.volatile}>` with the time `Text` above the words `Text`. Use the existing `styles.time` and a new `volatile: { gap: 6 }`. On that time `Text`, override the width with `{ minWidth: 0 }` if `styles.time` has one, and on the words `Text` use `{ fontSize: 17, lineHeight: 26 }`. Remove `WordText` from the imports if it is no longer used. Keep `styles.line`/`styles.lineText` only if still used, and otherwise delete them.

5. `styles.lines` becomes `{ gap: 22, paddingBottom: 12 }`.

### SessionScreen.tsx

1. Import `ParagraphRow` from `./ParagraphRow.tsx` and `groupTimeline` from `../../core/capture/timeline.ts`.

2. Replace the `timeline.map(...)` block in the transcript with:

```tsx
          groupTimeline(timeline).map((row) =>
            row.kind === "paragraph" ? (
              <ParagraphRow
                key={row.key}
                at={row.at}
                lines={row.lines}
                lit={row.lines.some((line) => line.key === lit)}
                onLayout={(event) => {
                  if (targetKey !== null && row.lines.some((line) => line.key === targetKey)) landOn(targetKey, event.nativeEvent.layout.y);
                }}
                onPlay={playable && getRecorderStatus().state === "idle" ? () => setSeek({ ms: row.at }) : undefined}
                onWord={(word, at) => router.push({ pathname: "/explain", params: { sessionId: id, t: String(at), word } })}
              />
            ) : (
              <TimeMarkRow key={row.key} item={row} interactive />
            ),
          )
```

3. Remove what this leaves unused: the `WordText` import stays because `PageBlock` uses it. `formatOffset` is removed from the imports only if nothing else uses it. Remove the `line` style if unused, keep `lineText` (the second transcript uses it) and `litLine` (`PageBlock` uses it), and remove `time` if unused.

---

## U9 · Another member's phone leaves a live recording alone

Branch `fix/u9-recover-own`. Files, and no others:
`src/core/capture/recording.ts`, `test/recording.test.ts`.

A recording in a shared space syncs with `state = 'recording'`. When another member opens the app, `recoverSessions` treats it as their own crashed recording, marks it interrupted, and syncs that back onto the phone that is still recording. Only the phone that made a recording may recover it.

### recording.ts

1. Add `import { getSetting, setSetting } from "../db/settings.ts";`

2. Add above `startRecordingSession`:

```ts
// The session this iPhone last started recording. The settings table stays on the device.
const RECORDING_HERE_KEY = "recording_here";
```

3. In `startRecordingSession`, inside its transaction, add `setSetting(db, RECORDING_HERE_KEY, row.id);`

4. Add above `recoverSessions`:

```ts
// Whether an unfinished session was recorded on this iPhone. A session outside any shared space always was. One in a
// shared space may be another member's: it is ours if this iPhone started it or holds one of its audio files.
function recordedHere(db: SqlDb, id: string, startedHere: string | null): boolean {
  if (id === startedHere) return true;
  const shared = db.get("SELECT 1 AS n FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = ?", [id]);
  if (shared === null) return true;
  return db.get("SELECT 1 AS n FROM captures WHERE session_id = ? AND kind = 'audio' AND file != ''", [id]) !== null;
}
```

5. In `recoverSessions`, read `const startedHere = getSetting(db, RECORDING_HERE_KEY);` first, and add `.filter((id) => recordedHere(db, id, startedHere))` after the existing `.filter`.

### recording.test.ts

Read how the file sets up rows. To put a space in a group, insert the rows its schema needs into `groups` (if there is such a table) and `space_groups`. Add:

- A session in a shared space that this phone did not start and with no audio file stays `recording` after `recoverSessions`.
- A session in a shared space started with `startRecordingSession` on this phone is recovered.
- A session in a shared space with an audio capture whose `file` is not empty is recovered.
- A session outside any shared space that this phone did not start is recovered (the existing tests already show this; add one only if none does).
