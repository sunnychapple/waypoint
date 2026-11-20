import AVFoundation
import Foundation

// Every way a render can be refused. JavaScript sees the code (see WaypointVoicesModule).
enum VoiceError: Error {
  case noVoices, busy, cancelled, writeFailed, badInput

  var code: String {
    switch self {
    case .noVoices: return "no_voices"
    case .busy: return "busy"
    case .cancelled: return "cancelled"
    case .writeFailed: return "write_failed"
    case .badInput: return "bad_input"
    }
  }
}

// Renders a two-voice script to one AAC file (docs/architecture.md section 2). Thin: the choices are in VoicePick and
// ScriptTiming (Core, tested on the Mac). Renders while the app is in the foreground; this class does not set the audio session.
final class ScriptRenderer {
  struct Line { let voice: String; let text: String } // voice "A" or "B"
  struct RenderResult { let durationMs: Int; let lineStartsMs: [Int]; let voices: String }

  static let sampleRate: Double = 24_000
  private static let settings: [String: Any] = [
    AVFormatIDKey: kAudioFormatMPEG4AAC,
    AVSampleRateKey: sampleRate,
    AVNumberOfChannelsKey: 1,
    AVEncoderBitRateKey: 64_000,
  ]

  private let synthesizer = AVSpeechSynthesizer()
  private let stateLock = NSLock()
  private var rendering = false // stateLock
  private var cancelled = false // stateLock

  func render(lines: [Line], outURL: URL, language: String) async throws -> RenderResult {
    guard !lines.isEmpty else { throw VoiceError.badInput }
    try claim()
    defer { release() }

    let voices = AVSpeechSynthesisVoice.speechVoices().map(Self.info)
    guard let pair = VoicePick.hosts(from: voices, language: language),
          let voiceA = AVSpeechSynthesisVoice(identifier: pair.a.identifier),
          let voiceB = AVSpeechSynthesisVoice(identifier: pair.b.identifier) else { throw VoiceError.noVoices }
    guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Self.sampleRate, channels: 1, interleaved: false),
          let pause = Self.silence(format) else { throw VoiceError.writeFailed }

    let folder = outURL.deletingLastPathComponent()
    let partURL = folder.appendingPathComponent("\(outURL.deletingPathExtension().lastPathComponent).partial.m4a")
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let durations = try await writePart(lines: lines, voiceA: voiceA, voiceB: voiceB, format: format, pause: pause, to: partURL)
      try checkNotCancelled()
      let timing = ScriptTiming.lineStarts(durationsMs: durations)
      if FileManager.default.fileExists(atPath: outURL.path) { try FileManager.default.removeItem(at: outURL) }
      try FileManager.default.moveItem(at: partURL, to: outURL)
      return RenderResult(durationMs: timing.totalMs, lineStartsMs: timing.starts, voices: "system:\(pair.a.identifier)+\(pair.b.identifier)")
    } catch {
      try? FileManager.default.removeItem(at: partURL) // a cancelled or failed render leaves no file behind
      throw error
    }
  }

  // Stops the speaking and makes the running render end with "cancelled" at its next check.
  func cancel() {
    stateLock.withLock { cancelled = true }
    synthesizer.stopSpeaking(at: .immediate)
  }

  // Writes the lines and the pauses between them; returns each line's length in milliseconds. The file is closed on return.
  private func writePart(lines: [Line], voiceA: AVSpeechSynthesisVoice, voiceB: AVSpeechSynthesisVoice, format: AVAudioFormat, pause: AVAudioPCMBuffer, to url: URL) async throws -> [Int] {
    let file = try AVAudioFile(forWriting: url, settings: Self.settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    var durations: [Int] = []
    for (i, line) in lines.enumerated() {
      try checkNotCancelled()
      let chunks = try await speak(line.text, voice: line.voice == "A" ? voiceA : voiceB, format: format)
      var frames: AVAudioFrameCount = 0
      for chunk in chunks {
        try file.write(from: chunk)
        frames += chunk.frameLength
      }
      durations.append(Self.milliseconds(frames))
      if i < lines.count - 1 { try file.write(from: pause) }
    }
    return durations
  }

  // The line's audio as buffers in the common format. Each buffer arrives through the write callback; a zero-length one ends it.
  private func speak(_ text: String, voice: AVSpeechSynthesisVoice, format: AVAudioFormat) async throws -> [AVAudioPCMBuffer] {
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice = voice
    utterance.rate = AVSpeechUtteranceDefaultSpeechRate
    return try await withCheckedThrowingContinuation { continuation in
      var chunks: [AVAudioPCMBuffer] = []
      var finished = false
      synthesizer.write(utterance) { buffer in
        guard !finished, let pcm = buffer as? AVAudioPCMBuffer else { return }
        if self.isCancelled() {
          finished = true
          continuation.resume(throwing: VoiceError.cancelled)
        } else if pcm.frameLength == 0 {
          finished = true
          continuation.resume(returning: chunks)
        } else if let converted = Self.convert(pcm, to: format) {
          chunks.append(converted)
        } else {
          finished = true
          continuation.resume(throwing: VoiceError.writeFailed)
        }
      }
    }
  }

  private static func convert(_ input: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
    guard let converter = AVAudioConverter(from: input.format, to: format) else { return nil }
    let capacity = AVAudioFrameCount(Double(input.frameLength) * format.sampleRate / input.format.sampleRate) + 1024
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
    var supplied = false
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, inputStatus in
      if supplied {
        inputStatus.pointee = .endOfStream
        return nil
      }
      supplied = true
      inputStatus.pointee = .haveData
      return input
    }
    return status == .error || error != nil ? nil : output
  }

  private static func silence(_ format: AVAudioFormat) -> AVAudioPCMBuffer? {
    let frames = AVAudioFrameCount(ScriptTiming.pauseMs * Int(sampleRate) / 1000)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
    buffer.frameLength = frames
    buffer.floatChannelData?[0].update(repeating: 0, count: Int(frames))
    return buffer
  }

  private static func milliseconds(_ frames: AVAudioFrameCount) -> Int {
    Int((Double(frames) * 1000 / sampleRate).rounded())
  }

  private static func info(_ voice: AVSpeechSynthesisVoice) -> VoiceInfo {
    let gender: VoiceInfo.Gender
    switch voice.gender {
    case .female: gender = .female
    case .male: gender = .male
    default: gender = .unspecified
    }
    return VoiceInfo(identifier: voice.identifier, language: voice.language, quality: voice.quality.rawValue, gender: gender)
  }

  private func claim() throws {
    try stateLock.withLock {
      if rendering { throw VoiceError.busy }
      rendering = true
      cancelled = false
    }
  }

  private func release() { stateLock.withLock { rendering = false } }

  private func isCancelled() -> Bool { stateLock.withLock { cancelled } }

  private func checkNotCancelled() throws {
    if isCancelled() { throw VoiceError.cancelled }
  }
}
