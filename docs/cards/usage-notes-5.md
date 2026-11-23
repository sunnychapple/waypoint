# Usage notes 5: fixes from the phase review

Fable's review of PRs #214 to #222. Written against `main` at `f66f1fc`. Paths are under `apps/mobile/` unless they start with `docs/`.

Not built, on purpose, until a phone test shows the need: a non-mixable fallback for background resume, and a watchdog on audio buffers.

---

## U10 · Headsets, repeat alert, shorter parts, gaps and less background work

Branch `fix/u10-phase-review`. Files, and no others:

- `modules/waypoint-audio/ios/AudioRecorder.swift`
- `modules/waypoint-audio/ios/WaypointAudioModule.swift`
- `modules/waypoint-audio/src/WaypointAudio.ts`
- `src/core/capture/timeline.ts`
- `test/timeline.test.ts`
- `src/features/capture/Waveform.tsx`
- `src/features/capture/useRecording.ts`
- `src/features/capture/RecordScreen.tsx`
- `src/features/capture/SessionScreen.tsx`
- `docs/cards/usage-notes-5.md` (new: this file, copied as it is)

### AudioRecorder.swift

1. `static let maxPartMs: Int64 = 300_000` becomes `120_000`. A crash loses at most the part being written.

2. In `configureSession`, replace the comment and the `setCategory` line:

```swift
    // mixWithOthers: another app's sound no longer stops the recording. defaultToSpeaker: that sound plays from the
    // speaker and not the earpiece. allowBluetoothA2DP: headphones play sound but the iPhone's own microphone keeps
    // recording. A Bluetooth headset microphone (HFP) runs at 8 to 16 kHz, which the part file cannot encode at 64 kbps.
    try audio.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothA2DP, .mixWithOthers, .defaultToSpeaker])
```

3. In `attemptResume`, replace `guard index < Self.resumeDelays.count else { return }` with:

```swift
    guard index < Self.resumeDelays.count else {
      scheduleAlert()   // iOS would not let it restart: say so now, because the first alert may have come during a call
      return
    }
```

4. In `openFile`, make the settings a `var` without the bitrate, then add it only where AAC supports it:

```swift
    var settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: format.channelCount,
    ]
    if format.sampleRate >= 24_000 { settings[AVEncoderBitRateKey] = 64_000 }   // refused below 24 kHz
```

5. Add a stored value after `runId`:

```swift
  private var levelsOn = true             // io: off while nobody can see the level bars
```

6. Add after `status()`:

```swift
  func setLevelsEnabled(_ on: Bool) {
    io.async { self.levelsOn = on }
  }
```

7. In `handle`, change the level condition to `if levelsOn, now - lastLevelAt >= 100, let channels = buffer.floatChannelData {`.

### WaypointAudioModule.swift

After the `getStatus` line add:

```swift
    Function("setLevelsEnabled") { (on: Bool) in self.recorder.setLevelsEnabled(on) }
```

### WaypointAudio.ts

In the class add `setLevelsEnabled(on: boolean): void;`, and after `getRecorderStatus` add:

```ts
export const setRecorderLevelsEnabled = (on: boolean): void => native.setLevelsEnabled(on);
```

### timeline.ts

The gap is measured from the last part that had ended by the resume. Picking the last part that had *started* breaks once the part after the resume has closed: it is then picked, and the gap goes negative and disappears. The margin allows for the native and JS clocks differing by a few milliseconds after an instant restart. Replace the `before` line:

```ts
    const before = parts.filter((part) => part.startMs + part.durationMs <= resumedAt + GAP_MIN_MS).at(-1);
```

Update the comment above `buildTimeline` to say "from the end of the last part that had ended by the resume".

Tests to add in `test/timeline.test.ts`:
- A gap stays drawn after the part following the resume has closed (parts 0 to 10 s and 40 to 60 s, resume at 40 s: one gap at 10 s of 30 s).
- An instant restart where the first part's end is 5 ms after the resume time draws no gap and does not measure from an earlier part.

### Waveform.tsx

Import `setRecorderLevelsEnabled` with `onRecorderLevel`. In the effect:

- Right after subscribing: `setRecorderLevelsEnabled(true);`
- Right after `levelEvents = null;` in the background branch: `setRecorderLevelsEnabled(false);`
- In the cleanup, after `levelEvents?.remove();`: `setRecorderLevelsEnabled(true);` (the default, for the next recording).

### useRecording.ts

1. Add `AppState` to the `react-native` import.

2. In the `onTranscript` listener, after the `mine` check:

```ts
        // Words still being heard are only for the screen. Finished words are always saved.
        if (!e.isFinal && AppState.currentState !== "active") return;
```

3. In the clock effect:

```ts
    const timer = setInterval(() => {
      if (AppState.currentState === "active") setNow(Date.now());
    }, 1000);
```

### RecordScreen.tsx

In the `TimelineRow` memo comparator, check identity first, so an unchanged row costs nothing on a clock tick:

```tsx
  (a, b) =>
    a.sessionId === b.sessionId &&
    (a.item === b.item ||
      (a.item.key === b.item.key &&
        (a.item.kind !== "paragraph" ||
          b.item.kind !== "paragraph" ||
          a.item.lines.map((line) => line.key).join() === b.item.lines.map((line) => line.key).join()))),
```

### SessionScreen.tsx

1. While this session is being continued, the live screen covers this one, so it should not re-read and redraw on every sentence. In the `useQuery` callback, after the `if (!session) return null;` line:

```ts
    const live = isLiveSession(getRecorderStatus(), id);
```

   and change these two entries:

```ts
      timeline: session.kind === "recording" && !live ? recordingTimeline(db, id) : [],
```

```ts
      second: session.kind === "recording" && !live ? secondTranscript(db, id) : null,
```

2. A better transcript made before a continuation leaves out the newer audio. In `secondTranscript`, replace the `parts` constant:

```ts
  const recorded = uploadParts(db, sessionId);
  const parts = recorded.map((part) => diffWords(partText(db, sessionId, "device", part), partText(db, sessionId, "cloud", part)));
  const incomplete = recorded.some((part) => partText(db, sessionId, "device", part).trim() !== "" && partText(db, sessionId, "cloud", part).trim() === "");
```

   Add `incomplete: boolean` to its return type and `incomplete` to the returned object.

3. After the line that shows `second.truncated`, add:

```tsx
            {second.incomplete && !second.truncated ? <Caption>Some parts of this recording aren't in the better transcript.</Caption> : null}
```

---

## Changes from review

A recording with more parts than the server takes is offered as too long, instead of failing on upload. A gap survives a very short part after the resume. Level events stay off if the screen closes in the background.
