import Foundation

/// One audio file. Times are milliseconds since the session started (wall clock, so pauses leave gaps).
struct RecordingPart: Equatable {
  let index: Int
  let startMs: Int64
  var durationMs: Int64
}

/// Keeps track of runs (start or resume until pause or stop) and the part files inside them.
/// A run is split into parts of at most `maxPartMs`, so a crash loses at most one part.
/// All `now` values come from one monotonic clock, in milliseconds.
struct RecordingTimeline {
  let sessionStart: Int64
  let maxPartMs: Int64
  private(set) var finishedParts: [RecordingPart] = []
  private(set) var current: RecordingPart?
  private(set) var runStartMs: Int64?
  private var partStartedAt: Int64 = 0

  init(sessionStart: Int64, maxPartMs: Int64 = 300_000) {
    self.sessionStart = sessionStart
    self.maxPartMs = maxPartMs
  }

  var isRunning: Bool { current != nil }

  /// Recorded time so far, without gaps.
  func recordedMs(now: Int64) -> Int64 {
    finishedParts.reduce(0) { $0 + $1.durationMs } + (current == nil ? 0 : max(0, now - partStartedAt))
  }

  /// Starts a run (start or resume). Returns the new part, or nil if a run is already going.
  mutating func startRun(now: Int64) -> RecordingPart? {
    guard current == nil else { return nil }
    runStartMs = max(0, now - sessionStart)
    return openPart(now: now)
  }

  /// Ends the run (pause or stop). Returns the finished part, or nil if nothing was running.
  mutating func endRun(now: Int64) -> RecordingPart? {
    let part = closePart(now: now)
    runStartMs = nil
    return part
  }

  /// Call on every audio buffer. If the current part is full, closes it and opens the next one in the
  /// same run; returns (closed, opened). Otherwise returns nil.
  mutating func rollIfNeeded(now: Int64) -> (closed: RecordingPart, opened: RecordingPart)? {
    guard current != nil, now - partStartedAt >= maxPartMs else { return nil }
    guard let closed = closePart(now: now) else { return nil }
    return (closed, openPart(now: now))
  }

  private mutating func openPart(now: Int64) -> RecordingPart {
    let index = finishedParts.count
    let part = RecordingPart(index: index, startMs: max(0, now - sessionStart), durationMs: 0)
    current = part
    partStartedAt = now
    return part
  }

  private mutating func closePart(now: Int64) -> RecordingPart? {
    guard var part = current else { return nil }
    part.durationMs = max(0, now - partStartedAt)
    finishedParts.append(part)
    current = nil
    return part
  }
}
