import AVFoundation
import Foundation

/// Gets every recorded buffer. The speech part (M6) implements it. Called on the recorder's io queue.
protocol AudioBufferSink: AnyObject {
  func runStarted(sessionId: String, runStartMs: Int64, format: AVAudioFormat)
  func append(_ buffer: AVAudioPCMBuffer)
  func runEnded()
}

enum RecorderError: Error { case busy, notRecording, notPaused, micDenied }

/// Two serial queues:
/// - `control` runs start, pause, resume and stop.
/// - `io` owns the timeline, the open file and the sink, and the tap runs its work on it.
/// The engine is stopped on `control` and never inside `io.sync`, so stopping cannot deadlock with the tap.
final class AudioRecorder {
  static let maxPartMs: Int64 = 300_000
  var onEvent: ((String, [String: Any]) -> Void)?
  weak var sink: AudioBufferSink?

  private let control = DispatchQueue(label: "waypoint.audio.control")
  private let io = DispatchQueue(label: "waypoint.audio.io")
  private var engine = AVAudioEngine()
  private var sessionId: String?          // control
  private var paused = false              // control
  private var observers: [NSObjectProtocol] = []
  private var ioSessionId: String?        // io
  private var timeline: RecordingTimeline? // io
  private var file: AVAudioFile?          // io
  private var lastLevelAt: Int64 = 0      // io

  static func now() -> Int64 { Int64(clock_gettime_nsec_np(CLOCK_MONOTONIC) / 1_000_000) }

  static var documents: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

  static func partPath(sessionId: String, index: Int) -> String { "sessions/\(sessionId)/audio-\(index).m4a" }

  static func micPermission() -> String {
    switch AVAudioApplication.shared.recordPermission {
    case .granted: return "granted"
    case .denied: return "denied"
    default: return "undetermined"
    }
  }

  static func requestMicPermission() async -> String {
    _ = await AVAudioApplication.requestRecordPermission()
    return micPermission()
  }

  func start(sessionId: String) throws {
    try control.sync {
      guard self.sessionId == nil else { throw RecorderError.busy }
      guard AVAudioApplication.shared.recordPermission == .granted else { throw RecorderError.micDenied }
      let audio = AVAudioSession.sharedInstance()
      try audio.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothHFP])
      try audio.setActive(true)
      try FileManager.default.createDirectory(
        at: Self.documents.appendingPathComponent("sessions/\(sessionId)", isDirectory: true),
        withIntermediateDirectories: true)
      self.sessionId = sessionId
      io.sync {
        self.ioSessionId = sessionId
        self.timeline = RecordingTimeline(sessionStart: Self.now(), maxPartMs: Self.maxPartMs)
      }
      addObservers()
      do { try startRun() } catch { finish(); throw error }
    }
  }

  func pause(reason: String) throws {
    try control.sync {
      guard sessionId != nil, !paused else { throw RecorderError.notRecording }
      pauseInControl(reason: reason)
    }
  }

  func resume() throws {
    try control.sync {
      guard sessionId != nil, paused else { throw RecorderError.notPaused }
      try startRun()
    }
  }

  /// Stops and returns the recorded time in ms. Every onPart event is sent before this returns.
  func stop() throws -> Double {
    try control.sync {
      guard sessionId != nil else { throw RecorderError.notRecording }
      if !paused { stopEngine(); endRun() }
      let total = io.sync { Double(timeline?.recordedMs(now: Self.now()) ?? 0) }
      emitState("idle", reason: "none", recordedMs: total)
      finish()
      return total
    }
  }

  func status() -> [String: Any] {
    control.sync {
      let recorded = io.sync { Double(timeline?.recordedMs(now: Self.now()) ?? 0) }
      let state = sessionId == nil ? "idle" : (paused ? "paused" : "recording")
      return ["sessionId": sessionId ?? "", "state": state, "recordedMs": recorded]
    }
  }

  // MARK: control queue only

  private func startRun() throws {
    guard let id = sessionId else { throw RecorderError.notRecording }
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    try io.sync {
      guard var t = timeline, let part = t.startRun(now: Self.now()) else { throw RecorderError.busy }
      timeline = t
      file = try Self.openFile(sessionId: id, index: part.index, format: format)
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
      endRun()
      throw error
    }
    paused = false
    emitState("recording", reason: "none", recordedMs: nil)
  }

  private func pauseInControl(reason: String) {
    stopEngine()
    endRun()
    paused = true
    emitState("paused", reason: reason, recordedMs: nil)
  }

  private func stopEngine() {
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
  }

  private func endRun() {
    io.sync {
      guard var t = timeline, let id = ioSessionId else { return }
      let closed = t.endRun(now: Self.now())
      timeline = t
      file = nil   // AVAudioFile finishes and closes the file when it is released
      if let closed { emitPart(closed, sessionId: id) }
      sink?.runEnded()
    }
  }

  private func finish() {
    removeObservers()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    io.sync { timeline = nil; ioSessionId = nil; file = nil }
    sessionId = nil
    paused = false
  }

  // MARK: io queue (called from the tap)

  private func handle(_ buffer: AVAudioPCMBuffer) {
    io.sync {
      guard var t = timeline, let id = ioSessionId else { return }
      let now = Self.now()
      if let rolled = t.rollIfNeeded(now: now) {
        timeline = t
        file = nil
        emitPart(rolled.closed, sessionId: id)
        file = try? Self.openFile(sessionId: id, index: rolled.opened.index, format: buffer.format)
      }
      try? file?.write(from: buffer)
      sink?.append(buffer)
      if now - lastLevelAt >= 100, let channels = buffer.floatChannelData {
        lastLevelAt = now
        let samples = UnsafeBufferPointer(start: channels[0], count: Int(buffer.frameLength))
        onEvent?("onLevel", ["level": Double(LevelMeter.normalized(rms: LevelMeter.rms(samples)))])
      }
    }
  }

  private static func openFile(sessionId: String, index: Int, format: AVAudioFormat) throws -> AVAudioFile {
    let url = documents.appendingPathComponent(partPath(sessionId: sessionId, index: index))
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: format.channelCount,
      AVEncoderBitRateKey: 64_000,
    ]
    return try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
  }

  private func emitPart(_ part: RecordingPart, sessionId: String) {
    onEvent?("onPart", [
      "sessionId": sessionId, "index": part.index, "startMs": Double(part.startMs),
      "durationMs": Double(part.durationMs), "file": Self.partPath(sessionId: sessionId, index: part.index),
    ])
  }

  private func emitState(_ state: String, reason: String, recordedMs: Double?) {
    let recorded = recordedMs ?? io.sync { Double(timeline?.recordedMs(now: Self.now()) ?? 0) }
    onEvent?("onState", ["sessionId": sessionId ?? "", "state": state, "reason": reason, "recordedMs": recorded])
  }

  // MARK: system notices

  private func addObservers() {
    let center = NotificationCenter.default
    observers = [
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        self?.control.async { if self?.sessionId != nil, self?.paused == false { self?.pauseInControl(reason: "interruption") } }
      },
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        self?.control.async { if self?.sessionId != nil, self?.paused == false { self?.pauseInControl(reason: "route_change") } }
      },
      center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil) { [weak self] _ in
        self?.control.async {
          guard let self else { return }
          if self.sessionId != nil, !self.paused {
            self.endRun()
            self.paused = true
            self.emitState("paused", reason: "media_reset", recordedMs: nil)
          }
          self.engine = AVAudioEngine()
        }
      },
    ]
  }

  private func removeObservers() {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
  }
}
