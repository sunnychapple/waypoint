import AVFoundation
import Foundation
import UIKit
import UserNotifications

/// Gets every recorded buffer. The speech part (M6) implements it. Called on the recorder's io queue.
protocol AudioBufferSink: AnyObject {
  func runStarted(sessionId: String, runStartMs: Int64, format: AVAudioFormat)
  func append(_ buffer: AVAudioPCMBuffer)
  func runEnded()
  func setPartialsEnabled(_ on: Bool)
}

enum RecorderError: Error { case busy, notRecording, notPaused, micDenied, writeFailed, micBusy }

/// Two serial queues:
/// - `control` runs start, pause, resume and stop.
/// - `io` owns the timeline, the open file and the sink, and the tap runs its work on it.
/// The engine is stopped on `control` and never inside `io.sync`, so stopping cannot deadlock with the tap.
final class AudioRecorder {
  static let maxPartMs: Int64 = 120_000
  private static let resumeDelays: [TimeInterval] = [0, 1, 3]
  private static let alertId = "waypoint.recording-paused"
  private static let alertDelay: TimeInterval = 3   // a pause shorter than this never shows an alert
  var onEvent: ((String, [String: Any]) -> Void)?
  weak var sink: AudioBufferSink?

  private let control = DispatchQueue(label: "waypoint.audio.control")
  private let io = DispatchQueue(label: "waypoint.audio.io")
  private var engine = AVAudioEngine()
  private var sessionId: String? { didSet { publishStatus() } }   // control
  private var paused = false { didSet { publishStatus() } }        // control
  private var wantsResume = false         // control: the system paused us, and the person has not paused or stopped
  private var retry: DispatchWorkItem?    // control: the next resume attempt
  private var observers: [NSObjectProtocol] = []
  private var ioSessionId: String?        // io
  private var timeline: RecordingTimeline? // io
  private var file: AVAudioFile?          // io
  private var lastLevelAt: Int64 = 0      // io
  private var writeFailed = false         // io: set on the first failed write of a run, so it pauses once
  private var runId = 0                   // io: the current run, so a late buffer from an earlier run is dropped
  private var levelsOn = true             // io: off while nobody can see the level bars
  private let statusLock = NSLock()
  private var statusSnapshot: (sessionId: String?, paused: Bool) = (nil, false)   // statusLock

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

  func start(sessionId: String, elapsedMs: Int64 = 0, firstIndex: Int = 0, priorRecordedMs: Int64 = 0) throws {
    try control.sync {
      guard self.sessionId == nil else { throw RecorderError.busy }
      guard AVAudioApplication.shared.recordPermission == .granted else { throw RecorderError.micDenied }
      self.sessionId = sessionId   // first, so status() never reports idle while this start is under way
      do {
        try Self.configureSession()
        // A fresh engine: the last one can hold a format from before a route change or a call.
        engine = AVAudioEngine()
        try FileManager.default.createDirectory(
          at: Self.documents.appendingPathComponent("sessions/\(sessionId)", isDirectory: true),
          withIntermediateDirectories: true)
      } catch {
        self.sessionId = nil
        throw error
      }
      io.sync {
        self.ioSessionId = sessionId
        self.timeline = RecordingTimeline(
          sessionStart: Self.now() - elapsedMs, maxPartMs: Self.maxPartMs, firstIndex: firstIndex, priorRecordedMs: priorRecordedMs)
      }
      addObservers()
      do { try startRun() } catch { finish(); throw error }
    }
  }

  func pause(reason: String) throws {
    try control.sync {
      guard sessionId != nil, !paused else { throw RecorderError.notRecording }
      wantsResume = false
      pauseInControl(reason: reason)
    }
  }

  func resume() throws {
    try control.sync {
      guard sessionId != nil else { throw RecorderError.notPaused }
      guard paused else { return }   // an automatic resume got there first
      retry?.cancel()
      retry = nil
      try restart()
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
    let (sessionId, paused) = statusLock.withLock { statusSnapshot }
    let recorded = io.sync { Double(timeline?.recordedMs(now: Self.now()) ?? 0) }
    let state = sessionId == nil ? "idle" : (paused ? "paused" : "recording")
    return ["sessionId": sessionId ?? "", "state": state, "recordedMs": recorded]
  }

  func setLevelsEnabled(_ on: Bool) {
    io.async {
      self.levelsOn = on
      self.sink?.setPartialsEnabled(on)
    }
  }

  // MARK: control queue only

  private func publishStatus() {
    let snapshot = (sessionId: sessionId, paused: paused)
    statusLock.withLock { statusSnapshot = snapshot }
  }

  private func startRun() throws {
    guard let id = sessionId else { throw RecorderError.notRecording }
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    // During a call iOS can report no input at all, and installing a tap on that format crashes the app.
    guard format.sampleRate > 0, format.channelCount > 0 else { throw RecorderError.micBusy }
    let run: Int = try io.sync {
      guard var t = timeline, let part = t.startRun(now: Self.now()) else { throw RecorderError.busy }
      file = try Self.openFile(sessionId: id, index: part.index, format: format)
      timeline = t   // only after the file opened, so a failed start leaves the timeline as it was
      writeFailed = false
      runId += 1
      return runId
    }
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      self?.handle(buffer, run: run)
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      abandonRun()
      throw error
    }
    // Only now: a start that failed must not reach the transcriber, which would end the previous run's wait for words.
    io.sync { sink?.runStarted(sessionId: id, runStartMs: timeline?.runStartMs ?? 0, format: format) }
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
    }
  }

  private static func configureSession() throws {
    let audio = AVAudioSession.sharedInstance()
    // mixWithOthers: another app's sound no longer stops the recording. defaultToSpeaker: that sound plays from the
    // speaker and not the earpiece. allowBluetoothA2DP: headphones play sound but the iPhone's own microphone keeps
    // recording. A Bluetooth headset microphone (HFP) runs at 8 to 16 kHz, which the part file cannot encode at 64 kbps.
    try audio.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothA2DP, .mixWithOthers, .defaultToSpeaker])
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
    guard index < Self.resumeDelays.count else {
      scheduleAlert()   // iOS would not let it restart: say so now, because the first alert may have come during a call
      return
    }
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
      // A part whose file never opened (a roll on a full disk) has no audio to report.
      let hasFile = file != nil
      let closed = hasFile ? t.endRun(now: Self.now()) : t.cancelRun()
      timeline = t
      file = nil   // AVAudioFile finishes and closes the file when it is released
      if hasFile, let closed { emitPart(closed, sessionId: id) }
      sink?.runEnded()
    }
  }

  private func finish() {
    retry?.cancel()
    retry = nil
    wantsResume = false
    clearAlert()
    removeObservers()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    io.sync { timeline = nil; ioSessionId = nil; file = nil }
    sessionId = nil
    paused = false
  }

  // MARK: io queue (called from the tap)

  private func handle(_ buffer: AVAudioPCMBuffer, run: Int) {
    io.sync {
      // A late buffer from a run that has ended is dropped: it has no file, and must not read as a failed write.
      guard var t = timeline, t.isRunning, run == runId, let id = ioSessionId, !writeFailed else { return }
      let now = Self.now()
      if let rolled = t.rollIfNeeded(now: now) {
        timeline = t
        file = nil
        emitPart(rolled.closed, sessionId: id)
        file = try? Self.openFile(sessionId: id, index: rolled.opened.index, format: buffer.format)
      }
      do {
        guard let file else { throw RecorderError.writeFailed }
        try file.write(from: buffer)
      } catch {
        // A full disk, or a part file that could not be opened: pause (reason "write_failed") so the screen
        // does not show a live recording that is not being saved. The pause runs on the control queue.
        writeFailed = true
        control.async { [weak self] in
          guard let self, self.sessionId == id, !self.paused, self.io.sync(execute: { self.runId }) == run else { return }
          self.pauseInControl(reason: "write_failed")
          self.scheduleAlert()
        }
        return
      }
      sink?.append(buffer)
      if levelsOn, now - lastLevelAt >= 100, let channels = buffer.floatChannelData {
        lastLevelAt = now
        let samples = UnsafeBufferPointer(start: channels[0], count: Int(buffer.frameLength))
        onEvent?("onLevel", ["level": Double(LevelMeter.normalized(rms: LevelMeter.rms(samples)))])
      }
    }
  }

  private static func openFile(sessionId: String, index: Int, format: AVAudioFormat) throws -> AVAudioFile {
    let url = documents.appendingPathComponent(partPath(sessionId: sessionId, index: index))
    var settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: format.channelCount,
    ]
    if format.sampleRate >= 24_000 { settings[AVEncoderBitRateKey] = 64_000 }   // refused below 24 kHz
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
  }

  private func removeObservers() {
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
  }
}
