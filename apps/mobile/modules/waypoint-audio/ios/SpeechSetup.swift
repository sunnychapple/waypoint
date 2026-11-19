import AVFoundation
import ExpoModulesCore
import Speech

enum SpeechSetup {
  static var engine: String { SpeechTranscriber.isAvailable ? "transcriber" : "dictation" }

  static func chooseLocale() async -> Locale? {
    let supported = SpeechTranscriber.isAvailable
      ? await SpeechTranscriber.supportedLocales
      : await DictationTranscriber.supportedLocales
    guard let id = LocaleChooser.choose(preferred: Locale.preferredLanguages, supported: supported.map(\.identifier)) else { return nil }
    return Locale(identifier: id)
  }

  static func isInstalled(_ locale: Locale) async -> Bool {
    let installed = SpeechTranscriber.isAvailable
      ? await SpeechTranscriber.installedLocales
      : await DictationTranscriber.installedLocales
    return installed.contains { $0.identifier(.bcp47) == locale.identifier(.bcp47) }
  }

  /// The chosen locale, but only when its speech pack is already installed.
  static func installedLocale() async -> Locale? {
    guard let locale = await chooseLocale(), await isInstalled(locale) else { return nil }
    return locale
  }

  /// One analysis module for this locale. `live` adds volatile results.
  static func makeModule(locale: Locale, live: Bool) -> any SpeechModule {
    let reporting: Set<SpeechTranscriber.ReportingOption> = live ? [.volatileResults] : []
    if SpeechTranscriber.isAvailable {
      return SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: reporting, attributeOptions: [.audioTimeRange])
    }
    let dictationReporting: Set<DictationTranscriber.ReportingOption> = live ? [.volatileResults] : []
    return DictationTranscriber(locale: locale, contentHints: [], transcriptionOptions: [], reportingOptions: dictationReporting, attributeOptions: [.audioTimeRange])
  }

  /// Downloads the speech pack, calling `progress` with 0...1 about twice a second.
  static func download(locale: Locale, progress: @escaping (Double) -> Void) async throws {
    let module = makeModule(locale: locale, live: false)
    guard let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) else { return }
    let poll = Task {
      while !Task.isCancelled {
        progress(request.progress.fractionCompleted)
        try? await Task.sleep(for: .milliseconds(500))
      }
    }
    defer { poll.cancel() }
    try await request.downloadAndInstall()
    progress(1)
  }

  /// Transcribes a finished part file from the documents folder. Returns only final pieces.
  static func transcribeFile(file: String, startMs: Double) async throws -> [[String: Any]] {
    guard let locale = await installedLocale() else {
      throw Exception(name: "SpeechPack", description: "speech pack not installed", code: "speech_pack_missing")
    }
    let audioFile = try AVAudioFile(forReading: AudioRecorder.documents.appendingPathComponent(file))
    let module = makeModule(locale: locale, live: false)
    let analyzer = SpeechAnalyzer(modules: [module])
    async let pieces = collectFinals(module: module, runStartMs: Int64(startMs))
    if let last = try await analyzer.analyzeSequence(from: audioFile) {
      try await analyzer.finalizeAndFinish(through: last)
    } else {
      await analyzer.cancelAndFinishNow()
    }
    return try await pieces
  }

  private static func collectFinals(module: any SpeechModule, runStartMs: Int64) async throws -> [[String: Any]] {
    var out: [[String: Any]] = []
    if let t = module as? SpeechTranscriber {
      for try await result in t.results where result.isFinal {
        if let piece = TranscriptPiece.make(text: String(result.text.characters), startSeconds: result.range.start.seconds, endSeconds: result.range.end.seconds, isFinal: true, runStartMs: runStartMs) {
          out.append(piece.event)
        }
      }
    } else if let d = module as? DictationTranscriber {
      for try await result in d.results where result.isFinal {
        if let piece = TranscriptPiece.make(text: String(result.text.characters), startSeconds: result.range.start.seconds, endSeconds: result.range.end.seconds, isFinal: true, runStartMs: runStartMs) {
          out.append(piece.event)
        }
      }
    }
    return out
  }
}
