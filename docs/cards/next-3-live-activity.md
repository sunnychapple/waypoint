# Next 3: recording on the Lock Screen

From the owner's class notes of 22 Nov 2026 (board S6, note 22): "Recording stays visible on the Lock Screen and Dynamic Island. A pause sends an alert right away." Written against `main` at `16e3bcc`. Paths are under `apps/mobile/` unless they start with `docs/`.

The pause alert already exists (`waypoint.recording-paused`, scheduled by `AudioRecorder.scheduleAlert` and kept out of the in-app banners by `src/platform/push.ts`). These cards do not change it.

What these cards add: an iOS Live Activity, shown while a recording runs, with a red dot and "Recording" (a pause sign and "Paused" while paused), the session title and its folder, and a clock. The clock counts by itself (`Text(timerInterval:pauseTime:)`), so the app sends an update only when the recording starts, pauses, resumes, moves folder, or ends. Tapping the activity opens NotePath, where the recording screen is still open (it is a full-screen modal that cannot be swiped away).

How it is built: the widget extension is added at prebuild by the config plugin `@bacons/apple-targets` 5.0.0 (the plugin Expo's own docs point to for Apple targets; `expo prebuild` makes `ios/`, which is not checked in). The activity is started, updated and ended by the native WaypointAudio module, on the recorder's control queue, so it follows the recorder even while the app's JavaScript is asleep.

Decided in these cards (the owner may disagree):
- **No buttons on the Lock Screen.** A Pause button needs an App Intent (`LiveActivityIntent`) that iOS runs inside the app. While paused, iOS suspends NotePath (background audio keeps it awake only while it records), so a Resume button would start a fresh copy of the app with no recorder in it, and iOS does not let an app in the background start the microphone. A Pause-only button would also need the intent to be found by Xcode's App Intents scan, which does not look inside our static pods. Instead the card says "Tap to pause or stop" (or "Tap to resume" while paused) and a tap opens the app.
- **No level strip.** It would need an update several times a second for an hour. iOS limits Live Activity updates and it would cost battery. The card shows no level strip at all; the recording screen keeps its waveform.
- **No tap link (`widgetURL`).** Opening `waypoint://recording` would push a second recording screen, which would try to start a second recording. Without a link, a tap just opens the app where it was.
- **The shared struct is two copies of one file**, checked by a test. iOS matches the app's activity to the widget's by the type name `RecordingActivityAttributes` and decodes the state from JSON, so the two must match exactly. The pod and the widget extension are compiled separately and cannot import each other, so the file is in both places, and `test/recording-activity.test.ts` fails if they differ.
- **No App Group.** The widget gets everything it shows in the activity's state, so it reads no shared storage.

How the cards were checked before writing: L1 and L2 together were applied to a scratch copy of `main` at `16e3bcc`. `npm run typecheck`, all 782 Vitest tests, `swift test`, `expo prebuild -p ios --no-install`, `pod install` and the simulator `xcodebuild` passed (`** BUILD SUCCEEDED **`, with `NotePath.app/PlugIns/RecordingActivity.appex`, bundle id `com.chapplestudios.waypoint.recording`, MinimumOSVersion 26.0, and `NSSupportsLiveActivities` true in the app). The new Swift files gave no warnings. With the autolinking exclusion, the `ExtensionStorage` pod is gone and the build still passes. `npx expo config` shows the extension under `extra.eas.build.experimental.ios.appExtensions`, which is how EAS learns it needs signing. Nothing was run on a device.

The deployment target is iOS 26.0 (`expo-build-properties` and every podspec), so Live Activities (iOS 16.1+), `Text(timerInterval:pauseTime:)` (16.2+) and `ActivityContent` (16.2+) need no `#available` checks. The widget target is also set to 26.0.

---

## L1 · The Live Activity widget extension

Branch `feat/l1-live-activity-widget`. Files, and no others:

- `package.json` (this is `apps/mobile/package.json`)
- `package-lock.json` (repo root, from `npm install`)
- `app.json`
- `targets/recording/expo-target.config.json` (new)
- `targets/recording/Info.plist` (new)
- `targets/recording/RecordingActivity.swift` (new)
- `targets/recording/RecordingLiveActivity.swift` (new)
- `modules/waypoint-audio/ios/Core/RecordingActivity.swift` (new)
- `modules/waypoint-audio/ios/Tests/RecordingActivityTests.swift` (new)
- `test/recording-activity.test.ts` (new)
- `docs/cards/next-3-live-activity.md` (new: this file, copied as it is)

This card adds the widget extension and the activity's data. Nothing starts an activity yet (L2 does), so the app behaves as before.

### package.json and package-lock.json

From the repo root:

```sh
npm install --save-exact @bacons/apple-targets@5.0.0 -w apps/mobile
```

`apps/mobile/package.json` gains `"@bacons/apple-targets": "5.0.0"` in `dependencies` (in alphabetical order, first). Do not hand-edit the lockfile. It adds about 55 packages, including an older `@expo/prebuild-config` used only inside the plugin.

The package also has a small native module (`ExtensionStorage`, for App Groups) that Expo would link into the app. NotePath does not use it, so add this top-level key to `apps/mobile/package.json`, after `"devDependencies"`:

```json
  "expo": {
    "autolinking": {
      "exclude": ["@bacons/apple-targets"]
    }
  }
```

### app.json

1. In `expo.ios.infoPlist`, after `"ITSAppUsesNonExemptEncryption": false`, add `"NSSupportsLiveActivities": true`.
2. In `expo.ios`, after `"usesAppleSignIn": true`, add `"appleTeamId": "84XFHFW7TP"` (the team in Xcode for local builds of the extension; EAS sets its own signing).
3. In `expo.plugins`, add `"@bacons/apple-targets"` as the last entry, after `"@clerk/expo"`.

### targets/recording/expo-target.config.json

The plugin reads every `targets/*/expo-target.config.json` at prebuild and adds a target named `RecordingActivity` with the bundle id `com.chapplestudios.waypoint.recording`. It also tells EAS about the extension (`extra.eas.build.experimental.ios.appExtensions`), so EAS can make its signing.

```json
{
  "type": "widget",
  "name": "RecordingActivity",
  "displayName": "NotePath Recording",
  "bundleIdentifier": ".recording",
  "deploymentTarget": "26.0"
}
```

### targets/recording/Info.plist

The plugin writes this file at the first prebuild when it is missing. Check it in so the repo holds what is built:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>NSExtension</key>
    <dict>
      <key>NSExtensionPointIdentifier</key>
      <string>com.apple.widgetkit-extension</string>
    </dict>
  </dict>
</plist>
```

### modules/waypoint-audio/ios/Core/RecordingActivity.swift

`Core/` is compiled into the pod and tested on the Mac by `swift test`. ActivityKit's protocol is added only on iOS, so the Mac test build has the plain struct.

```swift
// The recording's Live Activity data. This file is copied as it is to targets/recording/RecordingActivity.swift:
// iOS matches the app's activity to the widget's by this type's name and decodes ContentState from the same JSON keys.
// test/recording-activity.test.ts fails when the two copies differ.
import Foundation
#if os(iOS)
import ActivityKit
#endif

struct RecordingActivityAttributes: Codable, Hashable {
  /// What the Lock Screen and Dynamic Island show. It changes only on a pause, a resume or a move to another folder:
  /// while recording, the clock counts on its own from `clockStart`, so nothing is redrawn on a timer.
  struct ContentState: Codable, Hashable {
    var title: String
    var place: String
    var clockStart: Date   // the clock reads the time since this, so recorded time before a pause is counted
    var pausedAt: Date?    // set while paused: the clock stands still at pausedAt - clockStart

    init(title: String, place: String, paused: Bool, recordedMs: Int64, now: Date) {
      self.title = title
      self.place = place
      clockStart = now.addingTimeInterval(-Double(max(0, recordedMs)) / 1000)
      pausedAt = paused ? now : nil
    }

    var paused: Bool { pausedAt != nil }
  }
}

#if os(iOS)
extension RecordingActivityAttributes: ActivityAttributes {}
#endif
```

### targets/recording/RecordingActivity.swift

A byte-for-byte copy of `modules/waypoint-audio/ios/Core/RecordingActivity.swift` (`cp` it; do not retype it).

### targets/recording/RecordingLiveActivity.swift

```swift
import ActivityKit
import SwiftUI
import WidgetKit

@main
struct RecordingWidgets: WidgetBundle {
  var body: some Widget { RecordingLiveActivity() }
}

/// The recording on the Lock Screen and in the Dynamic Island. Tapping it opens NotePath, where the recording screen
/// is still open. It has no buttons and no level strip: both would need the app to send updates while recording.
struct RecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      LockScreenView(state: context.state)
        .activityBackgroundTint(nil)
        .activitySystemActionForegroundColor(.red)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          StatusLabel(state: context.state).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Clock(state: context.state).font(.title3.monospacedDigit()).padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(place(context.state)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
        }
      } compactLeading: {
        Dot(state: context.state)
      } compactTrailing: {
        Clock(state: context.state).font(.caption.monospacedDigit()).frame(maxWidth: 52)
      } minimal: {
        Dot(state: context.state)
      }
    }
  }
}

private struct LockScreenView: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        StatusLabel(state: state)
        Spacer()
        Clock(state: state).font(.title2.monospacedDigit().weight(.semibold))
      }
      Text(place(state)).font(.subheadline).lineLimit(1)
      Text(state.paused ? "Tap to resume" : "Tap to pause or stop").font(.caption).foregroundStyle(.secondary)
    }
    .padding(16)
    .accessibilityElement(children: .combine)
  }
}

private struct StatusLabel: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 6) {
      Dot(state: state)
      Text(state.paused ? "Paused" : "Recording").font(.headline)
    }
  }
}

/// Red while recording; a pause sign while paused.
private struct Dot: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    if state.paused {
      Image(systemName: "pause.circle.fill").foregroundStyle(.orange).accessibilityLabel("Paused")
    } else {
      Circle().fill(.red).frame(width: 10, height: 10).accessibilityLabel("Recording")
    }
  }
}

/// Counts by itself while recording and stands still while paused, so the app never sends an update for the clock.
private struct Clock: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    // The end of the range sets the widest time the text makes room for. iOS keeps an activity at most 12 hours.
    Text(
      timerInterval: state.clockStart...state.clockStart.addingTimeInterval(24 * 3600),
      pauseTime: state.pausedAt,
      countsDown: false,
      showsHours: true)
      .multilineTextAlignment(.trailing)
  }
}

private func place(_ state: RecordingActivityAttributes.ContentState) -> String {
  state.place.isEmpty ? state.title : "\(state.title) · \(state.place)"
}
```

Text uses system text styles, so it follows Dynamic Type. There is no animation, so Reduce Motion needs nothing.

### modules/waypoint-audio/ios/Tests/RecordingActivityTests.swift

```swift
import Foundation
import Testing
@testable import AudioCore

private let now = Date(timeIntervalSince1970: 1_000_000)

@Test func recordingClockStartsTheRecordedTimeAgo() {
  let state = RecordingActivityAttributes.ContentState(title: "Science", place: "Class", paused: false, recordedMs: 90_000, now: now)
  #expect(state.clockStart == now.addingTimeInterval(-90))
  #expect(state.pausedAt == nil)
  #expect(!state.paused)
}

@Test func pausedClockStandsAtTheRecordedTime() {
  let state = RecordingActivityAttributes.ContentState(title: "Science", place: "Class", paused: true, recordedMs: 90_500, now: now)
  #expect(state.pausedAt == now)
  #expect(state.paused)
  #expect(state.pausedAt!.timeIntervalSince(state.clockStart) == 90.5)
}

@Test func negativeRecordedTimeCountsAsZero() {
  let state = RecordingActivityAttributes.ContentState(title: "", place: "", paused: false, recordedMs: -5, now: now)
  #expect(state.clockStart == now)
}

@Test func sameInputsMakeEqualStatesSoNoUpdateIsSent() {
  let a = RecordingActivityAttributes.ContentState(title: "A", place: "P", paused: true, recordedMs: 1_000, now: now)
  let b = RecordingActivityAttributes.ContentState(title: "A", place: "P", paused: true, recordedMs: 1_000, now: now)
  var moved = b
  moved.place = "Q"
  #expect(a == b)
  #expect(a != moved)
}

@Test func stateSurvivesTheJsonTheWidgetReads() throws {
  let state = RecordingActivityAttributes.ContentState(title: "Talk", place: "Home", paused: true, recordedMs: 61_000, now: now)
  let data = try JSONEncoder().encode(state)
  #expect(try JSONDecoder().decode(RecordingActivityAttributes.ContentState.self, from: data) == state)
}
```

`Package.swift` needs no change: the `AudioCore` target already takes every file in `waypoint-audio/ios/Core`.

### test/recording-activity.test.ts

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("recording Live Activity", () => {
  // iOS hands the app's activity to the widget by the attributes' type name and decodes the state from the same JSON.
  it("the app and the widget use the same RecordingActivity.swift", () => {
    const app = readFileSync(join(MOBILE, "modules/waypoint-audio/ios/Core/RecordingActivity.swift"), "utf8");
    const widget = readFileSync(join(MOBILE, "targets/recording/RecordingActivity.swift"), "utf8");
    expect(widget).toBe(app);
  });

  it("the app says it has Live Activities and builds the widget target", () => {
    const config = JSON.parse(readFileSync(join(MOBILE, "app.json"), "utf8")) as {
      expo: { ios: { infoPlist: Record<string, unknown> }; plugins: unknown[] };
    };
    expect(config.expo.ios.infoPlist["NSSupportsLiveActivities"]).toBe(true);
    expect(config.expo.plugins).toContain("@bacons/apple-targets");
  });
});
```

### Checks

From `apps/mobile`: `npm run typecheck`, `npm test`, `npm run test:swift`, `npm run export:ios`. Then the native compile check (it needs `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` for CocoaPods):

```sh
npx expo prebuild -p ios --no-install
cd ios && pod install && cd ..
xcodebuild -workspace ios/NotePath.xcworkspace -scheme NotePath -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
```

The build must list `RecordingActivity.appex` and end with `** BUILD SUCCEEDED **`. Then remove `ios/` (it is gitignored; `rm -rf ios`). If prebuild changed `package.json`, put it back with `git checkout -- package.json` and re-apply this card's two edits. `targets/recording/Info.plist` must stay exactly as above.

Known limits: on the Simulator the activity can be seen, but signing, the Dynamic Island on a real phone and the App Store upload can only be checked with a real build (see "Before the next build" below).

---

## L2 · Start, update and end the activity from the recorder

After L1 is merged. Branch `feat/l2-live-activity-recorder`. Files, and no others:

- `modules/waypoint-audio/ios/LockScreenActivity.swift` (new)
- `modules/waypoint-audio/ios/AudioRecorder.swift`
- `modules/waypoint-audio/ios/WaypointAudioModule.swift`
- `modules/waypoint-audio/src/WaypointAudio.ts`
- `src/features/capture/useRecording.ts`
- `src/features/capture/RecordScreen.tsx`

When a recording starts, the activity appears. Every pause and resume (by the person, by a call, by a route change, by a full disk, by an automatic resume) changes it, because they all go through `AudioRecorder.emitState`. Stop, Discard, the screen closing, and a start that fails all go through `finish()`, which ends it. An activity left by a crash or by iOS closing the app is ended the next time the module is created, at launch, when no recording can be running yet.

ActivityKit lets an app start an activity only while it is open (it is: Record was just tapped). Updates and ending work in the background. If the person turned Live Activities off in Settings, nothing is shown and the recording goes on.

### LockScreenActivity.swift

```swift
import ActivityKit
import Foundation

/// The recording on the Lock Screen and in the Dynamic Island. AudioRecorder calls it on its control queue only.
/// Updates run one after another, so a quick pause then resume can never show the pause last.
final class LockScreenActivity {
  private var activity: Activity<RecordingActivityAttributes>?
  private var shown: RecordingActivityAttributes.ContentState?
  private var title = ""
  private var place = ""
  private var last: Task<Void, Never>?

  /// Ends activities left by an earlier launch (a crash, or iOS closing the app). Called when the module is created,
  /// before any recording can start in this launch.
  static func endLeftovers() {
    let leftovers = Activity<RecordingActivityAttributes>.activities
    guard !leftovers.isEmpty else { return }
    Task {
      for activity in leftovers { await activity.end(nil, dismissalPolicy: .immediate) }
    }
  }

  /// Shows the activity when a recording starts. iOS allows this only while NotePath is open, which it is when
  /// Record is tapped. Turned off in Settings, or refused: the recording goes on without it.
  func begin(title: String, place: String, recordedMs: Int64) {
    self.title = title
    self.place = place
    guard activity == nil, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let state = RecordingActivityAttributes.ContentState(title: title, place: place, paused: false, recordedMs: recordedMs, now: Date())
    activity = try? Activity.request(attributes: RecordingActivityAttributes(), content: ActivityContent(state: state, staleDate: nil))
    shown = activity == nil ? nil : state
  }

  /// A pause or a resume.
  func show(paused: Bool, recordedMs: Int64) {
    send(RecordingActivityAttributes.ContentState(title: title, place: place, paused: paused, recordedMs: recordedMs, now: Date()))
  }

  /// The recording was moved to another folder, or renamed. The clock is kept as it is.
  func rename(title: String, place: String) {
    self.title = title
    self.place = place
    guard var state = shown else { return }
    state.title = title
    state.place = place
    send(state)
  }

  /// Stop, discard, or a start that failed: the activity leaves the Lock Screen at once.
  func end() {
    guard let activity else { return }
    self.activity = nil
    shown = nil
    let previous = last
    last = Task {
      await previous?.value
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  private func send(_ state: RecordingActivityAttributes.ContentState) {
    guard let activity, state != shown else { return }
    shown = state
    let previous = last
    last = Task {
      await previous?.value
      await activity.update(ActivityContent(state: state, staleDate: nil))
    }
  }
}
```

### AudioRecorder.swift

1. After `weak var sink: AudioBufferSink?`, add:

```swift
  private let lockScreen = LockScreenActivity()   // control
```

2. Replace the first line of `start`:

```swift
  func start(
    sessionId: String, elapsedMs: Int64 = 0, firstIndex: Int = 0, priorRecordedMs: Int64 = 0, title: String = "", place: String = ""
  ) throws {
```

3. In `start`, right after `do { try startRun() } catch { finish(); throw error }`, add:

```swift
      lockScreen.begin(title: title, place: place, recordedMs: priorRecordedMs)
```

4. After the end of `start` (before `func pause`), add:

```swift
  /// The recording's title or folder changed: the Lock Screen shows the new one.
  func rename(title: String, place: String) {
    control.async { self.lockScreen.rename(title: title, place: place) }
  }
```

5. In `finish()`, right after `clearAlert()`, add `lockScreen.end()`.

6. In `emitState`, right after the `let recorded = …` line, add:

```swift
    if state != "idle" { lockScreen.show(paused: state == "paused", recordedMs: Int64(recorded)) }
```

   (`emitState` runs on the control queue in every caller. The first `"recording"` from `startRun` comes before `begin`, finds no activity and sends nothing.)

### WaypointAudioModule.swift

1. First line inside `OnCreate { … }`: `LockScreenActivity.endLeftovers()`.

2. Replace the `start` function and add `setRecordingLabel` after it:

```swift
    AsyncFunction("start") {
      (sessionId: String, elapsedMs: Double, firstIndex: Int, priorRecordedMs: Double, title: String, place: String) throws in
      try self.recorder.start(
        sessionId: sessionId, elapsedMs: Int64(elapsedMs), firstIndex: firstIndex, priorRecordedMs: Int64(priorRecordedMs),
        title: title, place: place)
    }
    Function("setRecordingLabel") { (title: String, place: String) in self.recorder.rename(title: title, place: place) }
```

### WaypointAudio.ts

1. After the `ContinueFrom` type:

```ts
// What the Lock Screen shows under "Recording": the session's title and the folder it is saved to.
export type RecordingLabel = { title: string; place: string };
```

2. In `WaypointAudioNative`: replace `start(…)` with
   `start(sessionId: string, elapsedMs: number, firstIndex: number, priorRecordedMs: number, title: string, place: string): Promise<void>;`
   and add after `setLevelsEnabled(on: boolean): void;`:
   `setRecordingLabel(title: string, place: string): void;`

3. Replace `startRecording`, and add `setRecordingLabel` after `setRecorderLevelsEnabled`:

```ts
export const startRecording = (
  sessionId: string,
  from: ContinueFrom = { elapsedMs: 0, firstIndex: 0, priorRecordedMs: 0 },
  label: RecordingLabel = { title: "", place: "" },
): Promise<void> => native.start(sessionId, from.elapsedMs, from.firstIndex, from.priorRecordedMs, label.title, label.place);
```

```ts
export const setRecordingLabel = (label: RecordingLabel): void => native.setRecordingLabel(label.title, label.place);
```

   `src/app/dev/audio.tsx` calls `startRecording(SESSION_ID)` and needs no change.

### useRecording.ts

Replace `await startRecording(created.session.id, created.continued?.from);` with:

```ts
        await startRecording(created.session.id, created.continued?.from, { title: created.session.title, place: created.spaceName });
```

(A new recording shows "New recording · <folder>"; a continued one shows its own title.)

### RecordScreen.tsx

The folder can change while recording (the folder pill opens the space picker). The pill already reads the current folder name, so it tells the Lock Screen.

1. Add `useEffect` to the `react` import, and add `import { setRecordingLabel } from "../../../modules/waypoint-audio/index.ts";` after the `expo-symbols` import.

2. In `Transcript`, pass the title: `<FolderPill sessionId={model.sessionId} fallback={model.spaceName} title={model.title} />`.

3. In `FolderPill`, take `title` (`{ sessionId, fallback, title }: { sessionId: string | null; fallback: string; title: string }`) and add right after the `useQuery` call:

```tsx
  // The Lock Screen shows the folder too. The native side sends nothing when the words did not change.
  useEffect(() => {
    if (sessionId !== null) setRecordingLabel({ title, place: name });
  }, [sessionId, title, name]);
```

This runs only when the name changes, never on a timer. Nothing polls.

### Checks

From `apps/mobile`: `npm run typecheck`, `npm test`, `npm run test:swift`, `npm run export:ios`, and the native compile check from L1 (prebuild, `pod install`, `xcodebuild … build`, then `rm -rf ios`). No new JS or Swift unit test: the only new logic is `ContentState`, tested in L1; the rest calls ActivityKit, which needs a real iPhone.

Check on a real iPhone (cannot be checked on the Simulator or in tests):
1. Start a recording, lock the phone: the Lock Screen shows the red dot, "Recording", "New recording · <folder>", and a clock that matches the recording screen.
2. On an iPhone with a Dynamic Island, go to the Home Screen: the dot and clock show; a long press shows the expanded view.
3. Pause on the recording screen: the activity shows "Paused" and the clock stops at the same time as the screen. Resume: it counts on from there.
4. Start a phone call during a recording: the activity shows "Paused", and the "Recording paused" alert comes as before. After the call, it shows "Recording" again.
5. Move the recording to another folder while recording: the activity shows the new folder.
6. Stop, and Discard: the activity goes away at once.
7. Tap the activity while locked: NotePath opens on the recording screen, and no second recording starts.
8. Force-quit NotePath while recording, then open it: the old activity is gone.
9. Settings > NotePath > Live Activities off: recording works with no activity.
10. Continue recording on a saved session: the clock starts at the session's recorded time, not 0:00.
11. An hour-long locked recording: battery use is no higher than before (Settings > Battery).

Known limits:
- After a crash, the activity keeps saying "Recording" with a running clock until NotePath is opened again, or iOS removes it (at most 12 hours). Nothing can end it from outside the app.
- iOS ends any Live Activity after 8 hours; a longer recording goes on without it.
- The compact Dynamic Island clock is given 52 points; check on a phone that "1:02:03" fits.

---

## Before the next build (the owner, once)

The widget extension has its own bundle id, `com.chapplestudios.waypoint.recording`, which needs its own App ID and provisioning profile. EAS makes both, but only while signed in to Apple, so a non-interactive build fails with "credentials are not set up for target RecordingActivity" until this is done once:

1. From `apps/mobile`, run `eas credentials -p ios`, choose the `production` profile, then "Build Credentials: set up all the required credentials", and sign in to Apple (team 84XFHFW7TP) when asked. EAS registers `com.chapplestudios.waypoint.recording` and makes a distribution profile for it with the existing certificate. Do the same for the `development` profile if a development build is wanted.
2. No capability or entitlement needs turning on: Live Activities need none (no App Group, no push updates).
3. Then run the next `eas build -p ios --profile production` as usual (only when the owner asks for a build).
4. After the build, check in App Store Connect that the upload had no warning about the extension's version or build number not matching the app's (EAS sets both from the remote build number; if one is reported, it can be fixed in a follow-up card).

---

## Not in these cards

- Pause and Resume buttons on the Lock Screen (see the decision above; a paused NotePath is suspended and cannot restart the microphone from the background).
- A live level strip (an update several times a second for the whole recording).
- Home Screen widgets and the share extension (M35); this target holds only the Live Activity.
- Updating the activity by push.
