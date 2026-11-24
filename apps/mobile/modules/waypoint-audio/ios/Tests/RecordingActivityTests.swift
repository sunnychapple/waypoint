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
