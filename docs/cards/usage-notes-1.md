# Usage notes 1: recording that does not stop silently

From the owner's class notes of 22 Nov 2026 (notes 22 and 23, boards S5 and S6 in `waypoint-usage-notes-2026-11-22.pen`). The owner's decision: share the microphone where iOS allows, alert the moment it is taken, and resume by itself, with one tap to resume as the fallback.

Written against `main` at `58d64ad`. U1 and U2 touch different files and can be built at the same time.

Not in these cards: the Lock Screen Live Activity (it needs a new app extension and Apple signing), Continue recording, and every other usage note.

---

## U1 · Share the microphone, alert on a pause, resume by itself

Branch `fix/u1-mic-recovery`. Files, and no others:

- `apps/mobile/modules/waypoint-audio/ios/AudioRecorder.swift`
- `apps/mobile/modules/waypoint-audio/ios/Core/RecordingTimeline.swift`
- `apps/mobile/modules/waypoint-audio/ios/Tests/RecordingTimelineTests.swift`
- `apps/mobile/src/features/capture/useRecording.ts`
- `apps/mobile/src/features/capture/RecordScreen.tsx`
- `apps/mobile/src/platform/push.ts`
- `docs/cards/usage-notes-1.md` (new: this file, copied as it is)

### RecordingTimeline.swift

Add after `endRun`:

```swift
  /// Drops the run that just started and could not record. Its part is forgotten, so the next run reuses its index.
  /// Returns the dropped part, or nil if nothing was running.
  mutating func cancelRun() -> RecordingPart? {
    let part = current
    current = nil
    runStartMs = nil
    return part
  }
```

Tests to add in `RecordingTimelineTests.swift`, in the file's existing style:
- `cancelRun` after `startRun` returns the part, `isRunning` is false, `recordedMs` is unchanged, and the next `startRun` gets the same index.
- `cancelRun` with nothing running returns nil.

### AudioRecorder.swift

1. Imports: add `import UIKit` and `import UserNotifications`.

2. `RecorderError`: add the case `micBusy`.

3. New stored values, after `paused`:

```swift
  private var wantsResume = false         // control: the system paused us, and the person has not paused or stopped
  private var retry: DispatchWorkItem?    // control: the next resume attempt
```

4. New constants, after `maxPartMs`:

```swift
  private static let resumeDelays: [TimeInterval] = [0, 1, 3]
  private static let alertId = "waypoint.recording-paused"
  private static let alertDelay: TimeInterval = 3   // a pause shorter than this never shows an alert
```

5. `start`: replace the two lines `let audio = ...` and `try audio.setCategory(...)` and `try audio.setActive(true)` with `try Self.configureSession()`.

6. `pause(reason:)`: set `wantsResume = false` before calling `pauseInControl`.

7. Replace `resume()`:

```swift
  func resume() throws {
    try control.sync {
      guard sessionId != nil, paused else { throw RecorderError.notPaused }
      retry?.cancel()
      retry = nil
      try restart()
    }
  }
```

8. Replace `startRun()`:

```swift
  private func startRun() throws {
    guard let id = sessionId else { throw RecorderError.notRecording }
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    // During a call iOS can report no input at all, and installing a tap on that format crashes the app.
    guard format.sampleRate > 0, format.channelCount > 0 else { throw RecorderError.micBusy }
    try io.sync {
      guard var t = timeline, let part = t.startRun(now: Self.now()) else { throw RecorderError.busy }
      file = try Self.openFile(sessionId: id, index: part.index, format: format)
      timeline = t   // only after the file opened, so a failed start leaves the timeline as it was
      writeFailed = false
      sink?.runStarted(sessionId: id, runStartMs: t.runStartMs ?? 0, format: format)
    }
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      self?.handle(buffer)
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      abandonRun()
      throw error
    }
    paused = false
    emitState("recording", reason: "none", recordedMs: nil)
  }

  /// A run that never recorded: no part is reported and its empty file is removed.
  private func abandonRun() {
    io.sync {
      guard var t = timeline, let id = ioSessionId else { return }
      let dropped = t.cancelRun()
      timeline = t
      file = nil
      if let dropped {
        try? FileManager.default.removeItem(at: Self.documents.appendingPathComponent(Self.partPath(sessionId: id, index: dropped.index)))
      }
      sink?.runEnded()
    }
  }

  private static func configureSession() throws {
    let audio = AVAudioSession.sharedInstance()
    // mixWithOthers: another app's sound no longer stops the recording. defaultToSpeaker: that sound plays from the
    // speaker and not the earpiece, which is where playAndRecord would otherwise send it.
    try audio.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothHFP, .mixWithOthers, .defaultToSpeaker])
    try audio.setActive(true)
  }

  /// Starts a new run on a fresh engine, because the old one can hold a format from before the interruption.
  private func restart() throws {
    try Self.configureSession()
    engine = AVAudioEngine()
    try startRun()
    wantsResume = false
    retry?.cancel()
    retry = nil
    clearAlert()
  }

  /// Tries to resume now, then again after each delay left in `resumeDelays`.
  private func attemptResume(from index: Int = 0) {
    retry?.cancel()
    retry = nil
    guard index < Self.resumeDelays.count else { return }
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.sessionId != nil, self.paused, self.wantsResume else { return }
      do { try self.restart() } catch { self.attemptResume(from: index + 1) }
    }
    retry = work
    control.asyncAfter(deadline: .now() + Self.resumeDelays[index], execute: work)
  }

  private func interruptionBegan() {
    retry?.cancel()
    retry = nil
    guard sessionId != nil, !paused else { return }
    wantsResume = true
    pauseInControl(reason: "interruption")
    scheduleAlert()
  }

  private func interruptionEnded(shouldResume: Bool) {
    guard sessionId != nil, paused, wantsResume, shouldResume else { return }
    attemptResume()
  }

  /// The engine stops by itself when the audio hardware changes (a headset removed, another app changing the sample
  /// rate) and no tap runs after that. Starts it again; if it cannot start, this is a pause like any other.
  private func engineMayHaveStopped(_ candidate: AVAudioEngine) {
    guard candidate === engine, sessionId != nil, !paused, !engine.isRunning else { return }
    stopEngine()
    endRun()
    do {
      try restart()
    } catch {
      paused = true
      wantsResume = true
      emitState("paused", reason: "route_change", recordedMs: nil)
      scheduleAlert()
      attemptResume(from: 1)
    }
  }

  private func appBecameActive() {
    guard sessionId != nil else { return }
    if paused {
      if wantsResume { attemptResume() }
    } else {
      engineMayHaveStopped(engine)
    }
  }

  private func scheduleAlert() {
    let content = UNMutableNotificationContent()
    content.title = "Recording paused"
    content.body = "Tap to resume. Your audio so far is safe."
    content.sound = .default
    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: Self.alertDelay, repeats: false)
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: Self.alertId, content: content, trigger: trigger))
  }

  private func clearAlert() {
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: [Self.alertId])
    center.removeDeliveredNotifications(withIdentifiers: [Self.alertId])
  }
```

9. `finish()`: add at the start:

```swift
    retry?.cancel()
    retry = nil
    wantsResume = false
    clearAlert()
```

10. In `handle`, in the write-failure `control.async` block, call `self.scheduleAlert()` right after `self.pauseInControl(reason: "write_failed")`.

11. Replace the body of `addObservers()`:

```swift
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        let options = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
        self?.control.async {
          switch type {
          case .began: self?.interruptionBegan()
          case .ended: self?.interruptionEnded(shouldResume: options.contains(.shouldResume))
          @unknown default: break
          }
        }
      },
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        self?.control.async {
          guard let self else { return }
          self.engineMayHaveStopped(self.engine)
        }
      },
      center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: nil) { [weak self] note in
        guard let stopped = note.object as? AVAudioEngine else { return }
        self?.control.async { self?.engineMayHaveStopped(stopped) }
      },
      center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
        self?.control.async { self?.appBecameActive() }
      },
      center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { [weak self] _ in
        self?.control.async {
          guard let self else { return }
          if self.sessionId != nil, !self.paused {
            self.endRun()
            self.paused = true
            self.wantsResume = true
            self.emitState("paused", reason: "media_reset", recordedMs: nil)
            self.scheduleAlert()
          }
          self.engine = AVAudioEngine()
          if self.wantsResume { self.attemptResume() }
        }
      },
    ]
```

### useRecording.ts

1. Add `import { askForPush } from "../../platform/push.ts";` with the other platform imports.

2. Right after `setRecorder("recording");` in the start effect, add:

```ts
        // The pause alert needs this. iOS shows its prompt only once, and the recording runs on behind it.
        askForPush().catch(() => undefined);
```

3. Replace the `resume:` line in the returned object:

```ts
    resume: () => {
      resumeRecording().catch(() => Alert.alert("The microphone is still in use.", "Try again when the other app is finished."));
    },
```

### RecordScreen.tsx

1. Replace these three entries of `PAUSE_REASONS` (leave `write_failed`):

```ts
  interruption: "Another app took the microphone. We'll try to resume when it finishes.",
  route_change: "The microphone changed. We'll try to resume.",
  media_reset: "Audio restarted. We'll try to resume.",
```

2. In the pause card, change the symbol `phone.fill` to `mic.slash.fill`.

### push.ts

Replace the handler, so the pause alert does not show as a banner over the screen that already says it:

```ts
// Alerts show as banners while the app is open, too, except the recording pause alert: the recording screen shows it.
const RECORDING_PAUSED_ALERT = "waypoint.recording-paused"; // AudioRecorder.alertId

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = notification.request.identifier !== RECORDING_PAUSED_ALERT;
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});
```

---

## U2 · A speech failure part way through a part leaves no hole

Branch `fix/u2-transcript-holes`. Files, and no others:

- `apps/mobile/src/core/capture/transcript.ts`
- `apps/mobile/src/platform/transcription.ts`
- `apps/mobile/test/transcript.test.ts`

Today a part is skipped if even one segment overlaps it, so when live speech fails part way through a 5-minute part, the rest of that part is never written down.

### transcript.ts

Replace `partsNeedingTranscription` and its comment with:

```ts
// How much of start..end the segments cover, counting overlapping segments once.
function coveredMs(start: number, end: number, segments: SegmentSpan[]): number {
  const spans = segments
    .filter((s) => s.tStart < end && s.tEnd > start)
    .map((s) => ({ from: Math.max(s.tStart, start), to: Math.min(s.tEnd, end) }))
    .sort((a, b) => a.from - b.from);
  let covered = 0;
  let cursor = start;
  for (const span of spans) {
    if (span.to <= cursor) continue;
    covered += span.to - Math.max(span.from, cursor);
    cursor = span.to;
  }
  return covered;
}

// The longest stretch of the part that no segment covers.
function longestHole(part: PartSpan, segments: SegmentSpan[]): number {
  const end = part.startMs + part.durationMs;
  const spans = segments.filter((s) => s.tStart < end && s.tEnd > part.startMs).sort((a, b) => a.tStart - b.tStart);
  let longest = 0;
  let cursor = part.startMs;
  for (const span of spans) {
    longest = Math.max(longest, span.tStart - cursor);
    cursor = Math.max(cursor, span.tEnd);
  }
  return Math.max(longest, end - cursor);
}

// Parts at least `minMs` long with a stretch of at least `minMs` that no segment covers, so they need transcribeFile.
export function partsNeedingTranscription(parts: PartSpan[], segments: SegmentSpan[], minMs = 10_000): PartSpan[] {
  return parts.filter((part) => part.durationMs >= minMs && longestHole(part, segments) >= minMs);
}

// The pieces of a re-transcribed part that fill a hole: those with less than half their time already written down.
export function piecesToKeep<T extends SegmentSpan>(pieces: T[], existing: SegmentSpan[]): T[] {
  return pieces.filter((piece) => {
    const length = piece.tEnd - piece.tStart;
    if (length <= 0) return !existing.some((s) => s.tStart <= piece.tStart && s.tEnd >= piece.tEnd);
    return coveredMs(piece.tStart, piece.tEnd, existing) * 2 < length;
  });
}
```

### transcription.ts

Import `piecesToKeep` from `../core/capture/transcript.ts`, and in `transcribeSession` replace the save loop:

```ts
    writeDbIf(generation, (db) => {
      const existing = db
        .all<{ t_start: number; t_end: number }>("SELECT t_start, t_end FROM segments WHERE session_id = ?", [sessionId])
        .map((row) => ({ tStart: row.t_start, tEnd: row.t_end }));
      for (const piece of piecesToKeep(pieces, existing)) saveSegment(db, sessionId, piece);
    });
```

### transcript.test.ts

Keep the existing tests, except any that asserts a part with a small overlapping segment is skipped: change it to a segment that covers the part with no hole of 10 seconds. Add:

- A 300-second part with one segment over its first 60 seconds is returned (the hole case).
- A 60-second part covered by segments with gaps under 10 seconds is not returned.
- A part shorter than `minMs` is not returned.
- `piecesToKeep`: a piece inside a hole is kept; a piece fully covered is dropped; a piece covered exactly half is dropped; a piece covered under half is kept; overlapping existing segments are counted once; a zero-length piece inside a segment is dropped and outside one is kept.

---

## Changes from review

**U1.** The transcriber starts only after the engine has started, and each ended run waits for the one before it. Late buffers from an ended run are dropped. A part whose file never opened is not reported. Tapping Resume after an automatic resume is not an error, and a failed resume after a full disk says so.

**U2.** A re-transcribed part replaces the on-device segments that start inside it (`replacementFor`), when it covers more of the part than they do. Merging repeated or lost words at the edges. Only on-device segments count as coverage.
