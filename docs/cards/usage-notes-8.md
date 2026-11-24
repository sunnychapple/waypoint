# Usage notes 8: fixes from the review since build 6

Fable's review of `ab8497f..16e3bcc` (PRs #212 to #225). Written against `main` at `16e3bcc`. Paths are under `apps/mobile/` unless they start with `docs/`.

---

## U13 · Keep transcripts safe between phones, and do less while locked

Branch `fix/u13-review-since-build-6`. Files, and no others:

- `src/core/capture/recording.ts`
- `test/recording.test.ts`
- `src/core/capture/transcript.ts`
- `test/transcript.test.ts`
- `src/platform/transcription.ts`
- `src/core/sync/changes.ts`
- `test/sync.test.ts`
- `modules/waypoint-audio/ios/AudioRecorder.swift`
- `modules/waypoint-audio/ios/LiveTranscriber.swift`
- `src/platform/push.ts`
- `src/features/capture/RecordScreen.tsx`
- `src/features/study/ReviewScreen.tsx`
- `src/ui/QuoteBox.tsx`
- `src/features/settings/CloudScreen.tsx`
- `docs/cards/usage-notes-8.md` (new: this file, copied as it is)

### 1. recording.ts: never write down a recording whose audio is on another phone

In `pendingTranscriptions`, change the sessions query so a session with any audio part that has no file here is skipped. Its words are written by the phone that has the audio; marking it failed here would sync "failed" back to that phone.

```ts
  const sessions = db.all<{ id: string }>(
    `SELECT id FROM sessions WHERE transcript = 'waiting' AND state IN ('saved', 'interrupted')
       AND NOT EXISTS (SELECT 1 FROM captures c WHERE c.session_id = sessions.id AND c.kind = 'audio' AND c.file = '')
     ORDER BY started_at`,
  );
```

Update the comment above the function to say so.

Test in `test/recording.test.ts`: a waiting saved session whose one audio capture has `file = ''` is not returned; the same session with a real file is.

### 2. recording.ts: forget "recording here" for sessions that are no longer recording

At the start of `recoverSessions`, before `const nativeActive`:

```ts
  // A marker for a session that another phone has since closed would let this phone close that phone's next recording.
  db.run(
    `DELETE FROM settings WHERE key LIKE ? AND substr(key, ?) NOT IN (SELECT id FROM sessions WHERE state IN ('recording', 'paused'))`,
    [`${RECORDING_HERE_PREFIX}%`, RECORDING_HERE_PREFIX.length + 1],
  );
```

Test: a marker for a session in state `interrupted` is gone after `recoverSessions`; a marker for the session native is still recording is kept.

### 3. transcript.ts and transcription.ts: replace a part only for a real gain, and keep a line that runs into the next part

Replace `replacementFor`:

```ts
// What to write for a re-transcribed part, in place of its own segments: those that start and end inside it. A segment
// that starts in the part and runs on into the next one is kept, because the next part may not be redone. The second pass
// splits sentences differently, so merging the two would repeat or lose words at each edge. Pieces that mostly repeat a
// segment kept around the part are left out. Null unless the second pass writes down at least `minGainMs` more of the part.
export function replacementFor<T extends SegmentSpan>(part: PartSpan, pieces: T[], existing: SegmentSpan[], minGainMs = 2_000): T[] | null {
  const end = part.startMs + part.durationMs;
  const own = existing.filter((s) => s.tStart >= part.startMs && s.tStart < end && s.tEnd <= end);
  const kept = existing.filter((s) => !own.includes(s));
  const fresh = piecesToKeep(pieces, kept);
  return coveredMs(part.startMs, end, [...fresh, ...kept]) >= coveredMs(part.startMs, end, [...own, ...kept]) + minGainMs ? fresh : null;
}
```

In `src/platform/transcription.ts`, the `DELETE` in `transcribeSession` deletes only the part's own segments:

```ts
        db.run("DELETE FROM segments WHERE session_id = ? AND source = 'device' AND t_start >= ? AND t_start < ? AND t_end <= ?", [
          sessionId,
          part.startMs,
          part.startMs + part.durationMs,
          part.startMs + part.durationMs,
        ]);
```

Tests in `test/transcript.test.ts` (`replacementFor`):
- Update the existing tests only where a gain is now under 2 seconds; keep what each one checks.
- A segment from 118 s to 123 s in a part from 0 to 120 s is not replaced, and a piece from 117 s to 120 s that mostly repeats it is left out.
- A second pass that adds only 1 second returns null; one that adds 3 seconds returns the pieces.

### 4. changes.ts: while this phone records a session, incoming words are added, not swapped in

In `applyChange`, in the `change.op === "segments"` branch, replace the `DELETE` line with:

```ts
    // While this iPhone records the session, another phone recording it too (both tapped Continue) must not delete the
    // words this one just wrote: add theirs instead. "recording_here:" is RECORDING_HERE_PREFIX in sessions.ts, which
    // imports this file.
    const recordingHere = db.get("SELECT 1 AS n FROM settings WHERE key = ?", [`recording_here:${sessionId}`]) !== null;
    if (!recordingHere) db.run("DELETE FROM segments WHERE session_id = ? AND source = ? AND t_start >= ? AND t_start < ?", [sessionId, change.source, from, to]);
```

Test in `test/sync.test.ts`, next to the existing segment bucket tests: with the marker set, applying a bucket keeps a local segment that the bucket does not have and adds the bucket's; without the marker, the local one is replaced as before.

### 5. Swift: no in-progress words while nobody can see them, a fresh engine on start, and a status that never waits

`AudioRecorder.swift`:

1. Add to `protocol AudioBufferSink`: `func setPartialsEnabled(_ on: Bool)`.
2. `setLevelsEnabled` becomes:

```swift
  func setLevelsEnabled(_ on: Bool) {
    io.async {
      self.levelsOn = on
      self.sink?.setPartialsEnabled(on)
    }
  }
```

3. In `start`, right after `try Self.configureSession()`, add `engine = AVAudioEngine()` with the comment `// A fresh engine: the last one can hold a format from before a route change or a call.`
4. A status that does not wait on `control`, which can be inside `setActive` during a resume. Add next to the other stored values:

```swift
  private let statusLock = NSLock()
  private var statusSnapshot: (sessionId: String?, paused: Bool) = (nil, false)   // statusLock
```

   Change `sessionId` and `paused` (both `control`) to publish every change:

```swift
  private var sessionId: String? { didSet { publishStatus() } }   // control
  private var paused = false { didSet { publishStatus() } }        // control
```

   keeping their existing comments and initial values, and add:

```swift
  private func publishStatus() {
    let snapshot = (sessionId: sessionId, paused: paused)
    statusLock.withLock { statusSnapshot = snapshot }
  }
```

   `status()` becomes:

```swift
  func status() -> [String: Any] {
    let (sessionId, paused) = statusLock.withLock { statusSnapshot }
    let recorded = io.sync { Double(timeline?.recordedMs(now: Self.now()) ?? 0) }
    let state = sessionId == nil ? "idle" : (paused ? "paused" : "recording")
    return ["sessionId": sessionId ?? "", "state": state, "recordedMs": recorded]
  }
```

`LiveTranscriber.swift`:

```swift
  private var partialsOn = true                     // lock: in-progress words are sent only while someone can see them
```

```swift
  func setPartialsEnabled(_ on: Bool) {
    lock.withLock { partialsOn = on }
  }
```

and the first line of `emit`: `if !isFinal && !lock.withLock({ partialsOn }) { return }`. Final words are always sent.

Compile check: `npm run test:swift`, and the full simulator build (`npx expo prebuild -p ios --no-install`, `pod install`, `xcodebuild … -scheme NotePath …`), then `git checkout -- package.json`.

### 6. push.ts and RecordScreen.tsx: show the pause alert on other screens

`push.ts`:

```ts
// True while the recording screen is in front: it shows the pause itself, so the alert is not shown as a banner there.
let recordScreenShowing = false;
export function setRecordScreenShowing(showing: boolean): void {
  recordScreenShowing = showing;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = notification.request.identifier !== RECORDING_PAUSED_ALERT || !recordScreenShowing;
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});
```

Update the comment above `RECORDING_PAUSED_ALERT` to match.

`RecordScreen.tsx`: import `useFocusEffect` from `expo-router` and `setRecordScreenShowing` from `../../platform/push.ts`, and add in `RecordScreen`:

```tsx
  useFocusEffect(
    useCallback(() => {
      setRecordScreenShowing(true);
      return () => setRecordScreenShowing(false);
    }, []),
  );
```

(add `useCallback` to the react import if it is not there).

### 7. ReviewScreen.tsx: say when removing a card removes it for everyone

In `removeCard`, the message is `shared ? "It will be removed for everyone in this space." : "It won't come back in your reviews."`, with, next to `canRemove`:

```ts
  const shared = session !== null && spaceGroups(getDb()).has(session.spaceId);
```

`removeCard` is defined above `session`; move the two `const` lines (`session`, `canRemove`) and the new one above `removeCard`.

### 8. QuoteBox.tsx and CloudScreen.tsx: name who runs the model

App Store rules ask apps to say which outside AI service gets the text. In `QuoteBox`, right after the retention caption:

```tsx
          <Caption>Run by Cloudflare's AI service for Waypoint.</Caption>
```

In `CloudScreen`, the opening `Body` becomes:

```tsx
      <Body>Recording, pages, flashcards, quizzes and search work on this iPhone. Only the cloud tasks you tap send text, and only for that task. Cloudflare's AI service runs those tasks for Waypoint.</Body>
```

### Checks

From `apps/mobile`: `npm run typecheck`, `npm test`, `npm run test:swift`, `npm run export:ios`, and the simulator build above.

### Review fixes

- changes.ts: while this phone records a session, a device bucket is merged before the "older" check, so an older bucket from another phone still adds its words, and a bucket that gained words is sent back as a dirty bucket. Cloud buckets still replace.
- recording.ts: a session is skipped only when every part that needs writing down is on another phone; the parts here are written down, and the rest keep their holes.
  - Known limit: when two phones each recorded parts of one session and both have parts that need a second pass, the first phone to finish marks the session done, so the other phone's parts keep their holes.
- AudioRecorder.swift: `start()` sets the session id first, so status never reports idle during a start, and clears it again if setup throws.
- ReviewScreen.tsx: "everyone" is named only when the card's space is a shared group.

### Known limits, not fixed here

- A card saved from a cloud practice set is still labelled `quiz_miss`. Nothing reads the label.
- Each saved live line still runs every mounted query once. It needs measuring on a phone first.
