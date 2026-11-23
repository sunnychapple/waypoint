import Testing
@testable import AudioCore

@Test func runsPauseAndResumeLeaveAGap() {
  var t = RecordingTimeline(sessionStart: 1_000)
  #expect(t.startRun(now: 1_000) == RecordingPart(index: 0, startMs: 0, durationMs: 0))
  #expect(t.startRun(now: 5_000) == nil)
  #expect(t.endRun(now: 61_000) == RecordingPart(index: 0, startMs: 0, durationMs: 60_000))
  #expect(t.endRun(now: 62_000) == nil)
  #expect(t.startRun(now: 91_000) == RecordingPart(index: 1, startMs: 90_000, durationMs: 0))
  #expect(t.runStartMs == 90_000)
  #expect(t.recordedMs(now: 101_000) == 70_000)
}

@Test func longRunRollsToANewPartAtTheLimit() {
  var t = RecordingTimeline(sessionStart: 0, maxPartMs: 300_000)
  _ = t.startRun(now: 0)
  #expect(t.rollIfNeeded(now: 299_999) == nil)
  let rolled = t.rollIfNeeded(now: 300_000)
  #expect(rolled?.closed == RecordingPart(index: 0, startMs: 0, durationMs: 300_000))
  #expect(rolled?.opened == RecordingPart(index: 1, startMs: 300_000, durationMs: 0))
  #expect(t.runStartMs == 0)
}

@Test func cancelRunDropsThePartAndReusesItsIndex() {
  var t = RecordingTimeline(sessionStart: 0)
  _ = t.startRun(now: 0)
  _ = t.endRun(now: 60_000)
  let recorded = t.recordedMs(now: 60_000)
  #expect(t.startRun(now: 90_000) == RecordingPart(index: 1, startMs: 90_000, durationMs: 0))
  #expect(t.cancelRun() == RecordingPart(index: 1, startMs: 90_000, durationMs: 0))
  #expect(t.isRunning == false)
  #expect(t.recordedMs(now: 95_000) == recorded)
  #expect(t.startRun(now: 95_000) == RecordingPart(index: 1, startMs: 95_000, durationMs: 0))
}

@Test func cancelRunWithNothingRunningReturnsNil() {
  var t = RecordingTimeline(sessionStart: 0)
  #expect(t.cancelRun() == nil)
}

@Test func continuedTimelineNumbersPartsAfterTheSavedOnes() {
  var t = RecordingTimeline(sessionStart: 0, maxPartMs: 300_000, firstIndex: 3)
  #expect(t.startRun(now: 0) == RecordingPart(index: 3, startMs: 0, durationMs: 0))
  let rolled = t.rollIfNeeded(now: 300_000)
  #expect(rolled?.closed == RecordingPart(index: 3, startMs: 0, durationMs: 300_000))
  #expect(rolled?.opened == RecordingPart(index: 4, startMs: 300_000, durationMs: 0))
  _ = t.endRun(now: 310_000)
  var u = RecordingTimeline(sessionStart: 0, firstIndex: 3)
  _ = u.startRun(now: 0)
  #expect(u.cancelRun() == RecordingPart(index: 3, startMs: 0, durationMs: 0))
  #expect(u.startRun(now: 5_000) == RecordingPart(index: 3, startMs: 5_000, durationMs: 0))
}

@Test func continuedTimelineCountsTheTimeAlreadyRecorded() {
  var t = RecordingTimeline(sessionStart: 0, priorRecordedMs: 60_000)
  #expect(t.recordedMs(now: 0) == 60_000)
  _ = t.startRun(now: 0)
  #expect(t.recordedMs(now: 10_000) == 70_000)
}

@Test func continuedRunStartsAtItsPlaceOnTheSessionClock() {
  let now: Int64 = 9_000_000
  var t = RecordingTimeline(sessionStart: now - 500_000)
  #expect(t.startRun(now: now) == RecordingPart(index: 0, startMs: 500_000, durationMs: 0))
  #expect(t.runStartMs == 500_000)
}

@Test func levelMeterMapsDecibelsToZeroToOne() {
  #expect(LevelMeter.normalized(rms: 0) == 0)
  #expect(LevelMeter.normalized(rms: 1) == 1)
  #expect(LevelMeter.normalized(rms: 0.001) == 0)
  #expect(abs(LevelMeter.normalized(rms: 0.0316227766) - 0.4) < 0.001)
  let samples: [Float] = [0.5, -0.5, 0.5, -0.5]
  #expect(samples.withUnsafeBufferPointer { LevelMeter.rms($0) } == 0.5)
}
