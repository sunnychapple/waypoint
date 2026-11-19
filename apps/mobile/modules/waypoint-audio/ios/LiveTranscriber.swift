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
  private var missed = false                        // lock
  private var analyzer: SpeechAnalyzer?             // lock
  private var converter: AVAudioConverter?          // lock
  private var continuation: AsyncStream<AnalyzerInput>.Continuation? // lock

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
    guard let locale, let analyzerFormat else {
      lock.withLock { missed = true }
      return
    }
    let module = SpeechSetup.makeModule(locale: locale, live: true)
    let analyzer = SpeechAnalyzer(modules: [module])
    let converter = AVAudioConverter(from: format, to: analyzerFormat)
    let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
    lock.withLock {
      self.analyzer = analyzer
      self.converter = converter
      self.continuation = continuation
    }
    Task {
      do { try await analyzer.start(inputSequence: stream) } catch { self.speechFailed(sessionId, error) }
    }
    Task {
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
    let (analyzer, continuation) = lock.withLock { (self.analyzer, self.continuation) }
    continuation?.finish()
    if let analyzer {
      Task { try? await analyzer.finalizeAndFinishThroughEndOfInput() }
    }
    lock.withLock {
      self.analyzer = nil
      self.converter = nil
      self.continuation = nil
    }
  }

  private func emit(_ sessionId: String, _ runStartMs: Int64, _ text: AttributedString, _ range: CMTimeRange, _ isFinal: Bool) {
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
