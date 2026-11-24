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
