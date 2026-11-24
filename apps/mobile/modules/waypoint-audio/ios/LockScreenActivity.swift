import ActivityKit
import Foundation

/// The recording on the Lock Screen and in the Dynamic Island. AudioRecorder calls it on its control queue only.
/// Updates run one after another, so a quick pause then resume can never show the pause last.
final class LockScreenActivity {
  /// Longest title or folder name sent to the activity. Keeps every update well under ActivityKit's 4 KB limit.
  static let maxLabelLength = 100

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
    self.title = Self.capped(title)
    self.place = Self.capped(place)
    guard activity == nil, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    let state = RecordingActivityAttributes.ContentState(
      title: self.title, place: self.place, paused: false, recordedMs: recordedMs, now: Date())
    activity = try? Activity.request(attributes: RecordingActivityAttributes(), content: ActivityContent(state: state, staleDate: nil))
    shown = activity == nil ? nil : state
  }

  /// A pause or a resume.
  func show(paused: Bool, recordedMs: Int64) {
    send(RecordingActivityAttributes.ContentState(
      title: title, place: place, paused: paused, recordedMs: recordedMs, now: Date()))
  }

  /// The recording was moved to another folder, or renamed. The clock is kept as it is.
  func rename(title: String, place: String) {
    self.title = Self.capped(title)
    self.place = Self.capped(place)
    guard var state = shown else { return }
    state.title = self.title
    state.place = self.place
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

  private static func capped(_ text: String) -> String {
    String(text.prefix(maxLabelLength))
  }
}
