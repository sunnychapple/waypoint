# Usage notes 2: the live recording screen

From the owner's class notes of 22 Nov 2026 (notes 6, 8, 16, 17 and 21; boards S1, S7 and S12 in `waypoint-usage-notes-2026-11-22.pen`). Written against `main` at `3d6ad80`. All paths are under `apps/mobile/`. U3, U4, U5 and U7 change different lines and are built at the same time. Build only your own card.

---

## U3 · Auto scroll that holds, Jump to live, and less work while recording

Branch `fix/u3-live-scroll`. Files, and no others:
`src/core/capture/follow.ts` (new), `test/follow.test.ts` (new), `src/features/capture/Waveform.tsx` (new), `src/features/capture/RecordScreen.tsx`, `src/features/capture/useRecording.ts`, `docs/cards/usage-notes-2.md` (new: this file, copied as it is).

Today the screen's own animated scroll can read as the person scrolling away, which turns following off. Every level event (10 a second) also re-renders the whole screen and rebuilds the timeline.

### follow.ts

```ts
const END_MARGIN = 40;

// True when the scroll position is at the newest line, give or take a small margin.
export function isAtEnd(position: { contentHeight: number; offsetY: number; viewHeight: number }): boolean {
  return position.contentHeight - (position.offsetY + position.viewHeight) < END_MARGIN;
}
```

Test: at the very end is true; 39 from the end is true; 40 from the end is false; content shorter than the view is true.

### Waveform.tsx

```tsx
import { useEffect, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import type { EventSubscription } from "expo";
import { onRecorderLevel } from "../../../modules/waypoint-audio/index.ts";
import { useColors } from "../../ui/theme.ts";

const LEVELS_KEPT = 48;

// The level bars. They hold their own state, so a level event redraws only them, and they stop listening while the app
// is in the background, where nobody can see them.
export function Waveform() {
  const colors = useColors();
  const [levels, setLevels] = useState<number[]>([]);

  useEffect(() => {
    let levelEvents: EventSubscription | null = null;
    const follow = (state: string | null | undefined): void => {
      if (state === "active" && levelEvents === null) {
        levelEvents = onRecorderLevel((e) => setLevels((previous) => [...previous.slice(-(LEVELS_KEPT - 1)), e.level]));
      } else if (state !== "active" && levelEvents !== null) {
        levelEvents.remove();
        levelEvents = null;
      }
    };
    follow(AppState.currentState);
    const appState = AppState.addEventListener("change", follow);
    return () => {
      appState.remove();
      levelEvents?.remove();
    };
  }, []);

  const bars = Array.from({ length: LEVELS_KEPT }, (_, i) => levels[levels.length - LEVELS_KEPT + i] ?? 0);
  return (
    <View style={styles.waveform}>
      {bars.map((level, i) => (
        <View
          key={i}
          style={[styles.bar, { height: Math.max(3, level * 40), backgroundColor: i >= bars.length - 8 ? colors.rec : colors.ink4 }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  waveform: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, height: 44 },
  bar: { width: 3, borderRadius: 2 },
});
```

### useRecording.ts

- Remove `onRecorderLevel` from the imports, `LEVELS_KEPT`, the `levels` state, its subscription, `bars`, and `levels` from `RecordingModel` and the returned object.
- Add `useMemo` to the React import. Build the timeline once per change, next to where `clockMs` is computed (before the `return`):

```ts
  const timeline = useMemo(() => buildTimeline(live.finals, parts, resumes, flags, photos), [live.finals, parts, resumes, flags, photos]);
```

  and return `timeline,` in place of the `buildTimeline(...)` call.

### RecordScreen.tsx

1. In `Dock`, replace the whole `<View style={styles.waveform}>…</View>` block with `<Waveform />`. Remove `waveform` and `bar` from the styles. Import `Waveform` from `./Waveform.tsx`.

2. Import `memo` and `useState` from React (`import { memo, useRef, useState } from "react";`) and `isAtEnd` from `../../core/capture/follow.ts`.

3. In `Transcript`, replace `onScroll` and the `following` ref with:

```tsx
  const following = useRef(true);
  const touching = useRef(false); // the person's finger or fling is moving the list; the screen's own scrolling never sets this
  const [showJump, setShowJump] = useState(false);

  function setFollowing(next: boolean): void {
    following.current = next;
    setShowJump(!next);
  }

  function readPosition(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    setFollowing(isAtEnd({ contentHeight: contentSize.height, offsetY: contentOffset.y, viewHeight: layoutMeasurement.height }));
  }
```

4. Replace the `ScrollView`'s `onScroll` and `onContentSizeChange` props with:

```tsx
        onScroll={(event) => {
          if (touching.current) readPosition(event);
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
```

5. Right after the closing `</ScrollView>`, add:

```tsx
      {showJump ? (
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
```

   and add to the styles: `jump: { position: "absolute", bottom: 8, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 16, borderRadius: 22 },`

6. Wrap the row so a clock tick does not redraw every line. Change `function TimelineRow(...) {` to `const TimelineRow = memo(function TimelineRow(...) {`, close it with `}, (a, b) => a.sessionId === b.sessionId && a.item.key === b.item.key);`. A row's key names its content: a final line never changes after it is written.

---

## U4 · Flag becomes a quiet "Ask later"

Branch `fix/u4-ask-later`. Files, and no others:
`src/features/capture/RecordScreen.tsx`, `src/features/capture/TimelineMarks.tsx`, `src/features/capture/HomeScreen.tsx`, `src/features/explain/LaterScreen.tsx`, `test/timeline-taps.test.ts`.

The button is the brightest thing on the screen and nobody knows what it does. It saves a moment to come back to in Questions for later. Only the words and look change. The code's names (`flag`, `flags`) and the database stay as they are.

- `RecordScreen.tsx`:
  - The toast text becomes `Saved to ask later at {formatOffset(model.toast.t)}`, and its symbol becomes `questionmark.bubble.fill` with `colors.bg` as the tint.
  - `<ActionButton label="Ask later" icon="questionmark.bubble" onPress={model.flag} />`.
  - `ActionButton` loses its `flag` prop: the circle is always `colors.surface2`, the tint `colors.ink`, the size 20.
- `TimelineMarks.tsx`:
  - `flagLabel` returns `Ask later at ${formatOffset(at)}, opens Questions for later`.
  - In the `flag` row: the time color is `colors.ink3`; the not-interactive label is `"Ask later"`; the chip background is `colors.surface2`; the symbol is `questionmark.bubble` with tint `colors.ink3`; the chip text is `Ask later` in `colors.ink2`.
- `HomeScreen.tsx`: the chip label becomes `` `${latest.flags} to ask later` ``. If `countLabel` is then unused in that file, remove its import.
- `LaterScreen.tsx`: the row title `"Flagged moment"` becomes `"A moment you saved"`.
- `test/timeline-taps.test.ts`: expect `Ask later at 2:05, opens Questions for later`.

---

## U5 · Change the folder while recording

Branch `fix/u5-record-folder`. Files, and no others:
`src/features/capture/RecordScreen.tsx`, `src/features/capture/SpacePickerScreen.tsx`.

The folder at the top of the recording screen cannot be tapped, so a recording started in the wrong folder stays there until it ends.

### RecordScreen.tsx

1. Replace the pill `<View style={[styles.pill, …]}>…</View>` in `Transcript` with `<FolderPill sessionId={model.sessionId} fallback={model.spaceName} />`.

2. Add these imports: `getSession` from `../../core/capture/sessions.ts`, `getSpace` from `../../core/db/spaces.ts`, `useQuery` from `../../platform/db.ts`.

3. Add, above `function TimelineRow` (or its `memo` wrapper):

```tsx
// Where this recording is being saved. Tapping it moves the recording; the microphone keeps running under the sheet.
function FolderPill({ sessionId, fallback }: { sessionId: string | null; fallback: string }) {
  const colors = useColors();
  const name = useQuery((db) => {
    const session = sessionId === null ? null : getSession(db, sessionId);
    return session === null ? fallback : (getSpace(db, session.spaceId)?.name ?? fallback);
  }, `${sessionId ?? ""}|${fallback}`);
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
```

### SpacePickerScreen.tsx

Import `isLiveSession` from `../../core/capture/recording.ts` and `getRecorderStatus` from `../../../modules/waypoint-audio/index.ts`. After the `<Title>`, add:

```tsx
      {sessionId && isLiveSession(getRecorderStatus(), sessionId) ? <Caption>Recording continues while you choose.</Caption> : null}
```

---

## U7 · Zoom into pages and photos

Branch `fix/u7-zoom`. Files, and no others:
`src/features/capture/SessionScreen.tsx`, `src/features/capture/RecordScreen.tsx`, `src/features/capture/TimelineMarks.tsx`.

The full-screen viewer can already pinch to zoom, but a page in a session cannot be opened in it, and a photo cannot be opened during a recording.

- `SessionScreen.tsx`, in `PageBlock`: wrap the page `<Image>` in a `Pressable`, and move the `accessibilityLabel` to the Pressable:

```tsx
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Page ${number}, opens full screen`}
        disabled={file === ""}
        onPress={() => router.push({ pathname: "/photo", params: { file } })}
      >
        <Image source={{ uri: fileUri(file) }} resizeMode="contain" style={[styles.pageImage, { backgroundColor: colors.surface2 }]} />
      </Pressable>
```

- `RecordScreen.tsx`, in `TimelineRow`: render marks as `<TimeMarkRow item={item} interactive={item.kind === "photo"} />`. The viewer opens over the recording, and the microphone keeps running.
- `TimelineMarks.tsx`: change the comment line about `interactive` to: `// Taps only work where \`interactive\` is set: the live recorder opens photos, but does not leave for Questions for later.`
