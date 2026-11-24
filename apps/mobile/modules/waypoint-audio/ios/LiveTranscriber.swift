import AVFoundation
import Foundation
import Speech

/// Gets the live buffers from the recorder and sends `onTranscript` events.
/// Called on the recorder's io queue; the stored values are guarded by `lock`.
final class LiveTranscriber: AudioBufferSink {
  var onEvent: ((String, [String: Any]) -> Void)?

  private let lock = NSLock()
  private var locale: Locale?                       // lock
  private var analyzerFormat: AVAudioFormat?        // lock
  private var analyzer: SpeechAnalyzer?             // lock
  private var converter: AVAudioConverter?          // lock
  private var continuation: AsyncStream<AnalyzerInput>.Continuation? // lock
  private var results: Task<Void, Never>?           // lock: the running run's results loop
  private var finishing: Task<Void, Never>?         // lock: the last ended run, until its final words are sent
  private var partialsOn = true                     // lock: in-progress words are sent only while someone can see them

  func setPartialsEnabled(_ on: Bool) {
    lock.withLock { partialsOn = on }
  }

  /// Stores the locale and the analyzer format for it. A nil locale means no speech pack, so nothing runs live.
  func configure(locale: Locale?) async {
    var format: AVAudioFormat?
    if let locale {
      let module = SpeechSetup.makeModule(locale: locale, live: true)
      format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module])
    }
    lock.withLock {
      self.locale = locale
      self.analyzerFormat = format
    }
  }

  func runStarted(sessionId: String, runStartMs: Int64, format: AVAudioFormat) {
    let (locale, analyzerFormat) = lock.withLock { (self.locale, self.analyzerFormat) }
    guard let locale, let analyzerFormat else { return }
    let module = SpeechSetup.makeModule(locale: locale, live: true)
    let analyzer = SpeechAnalyzer(modules: [module])
    let converter = AVAudioConverter(from: format, to: analyzerFormat)
    let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
    Task {
      do { try await analyzer.start(inputSequence: stream) } catch { self.speechFailed(sessionId, error) }
    }
    let results = Task {
      do {
        if let t = module as? SpeechTranscriber {
          for try await result in t.results {
            self.emit(sessionId, runStartMs, result.text, result.range, result.isFinal)
          }
        } else if let d = module as? DictationTranscriber {
          for try await result in d.results {
            self.emit(sessionId, runStartMs, result.text, result.range, result.isFinal)
          }
        }
      } catch {
        self.speechFailed(sessionId, error)
      }
    }
    lock.withLock {
      self.analyzer = analyzer
      self.converter = converter
      self.continuation = continuation
      self.results = results
    }
  }

  func append(_ buffer: AVAudioPCMBuffer) {
    let (converter, analyzerFormat, continuation) = lock.withLock { (self.converter, self.analyzerFormat, self.continuation) }
    guard let converter, let analyzerFormat, let continuation else { return }
    let ratio = analyzerFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1
    guard let out = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: capacity) else { return }
    var fed = false
    var error: NSError?
    converter.convert(to: out, error: &error) { _, status in
      if fed { status.pointee = .noDataNow; return nil }
      fed = true
      status.pointee = .haveData
      return buffer
    }
    if out.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: out)) }
  }

  func runEnded() {
    let (analyzer, continuation, results, previous) = lock.withLock { (self.analyzer, self.continuation, self.results, self.finishing) }
    continuation?.finish()
    // Done once the analyzer has finished the input and the results loop has sent the last final words. It also waits
    // for the run before it, because a quick automatic restart can end two runs close together.
    let finishing = Task {
      if let analyzer { try? await analyzer.finalizeAndFinishThroughEndOfInput() }
      await results?.value
      await previous?.value
    }
    lock.withLock {
      self.analyzer = nil
      self.converter = nil
      self.continuation = nil
      self.results = nil
      self.finishing = finishing
    }
  }

  /// Waits until the last ended run's final words have been sent as onTranscript events, at most `seconds`.
  /// stop() calls it before it resolves, so the app still listens when the last words arrive.
  func waitForFinals(seconds: Double) async {
    guard let finishing = lock.withLock({ self.finishing }) else { return }
    // Not a task group: a group waits for every child, and `finishing.value` ignores cancellation, so a run that
    // never ends would hold stop() for ever. Whichever comes first resumes; the other is ignored.
    let once = ResumeOnce()
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      once.set(continuation)
      Task { await finishing.value; once.resume() }
      Task { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)); once.resume() }
    }
    lock.withLock { if self.finishing == finishing { self.finishing = nil } }
  }

  private func emit(_ sessionId: String, _ runStartMs: Int64, _ text: AttributedString, _ range: CMTimeRange, _ isFinal: Bool) {
    if !isFinal && !lock.withLock({ partialsOn }) { return }
    guard let piece = TranscriptPiece.make(
      text: String(text.characters),
      startSeconds: range.start.seconds,
      endSeconds: range.end.seconds,
      isFinal: isFinal,
      runStartMs: runStartMs
    ) else { return }
    onEvent?("onTranscript", ["sessionId": sessionId].merging(piece.event) { $1 })
  }

  private func speechFailed(_ sessionId: String, _ error: Error) {
    onEvent?("onSpeechError", ["sessionId": sessionId, "message": String(describing: error)])
  }
}

/// Resumes a continuation exactly once, from whichever caller gets there first.
private final class ResumeOnce: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Void, Never>?
  private var done = false

  func set(_ continuation: CheckedContinuation<Void, Never>) {
    lock.withLock {
      if done { continuation.resume() } else { self.continuation = continuation }
    }
  }

  func resume() {
    let c: CheckedContinuation<Void, Never>? = lock.withLock {
      if done { return nil }
      done = true
      defer { continuation = nil }
      return continuation
    }
    c?.resume()
  }
}
