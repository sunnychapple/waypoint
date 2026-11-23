import ExpoModulesCore

public class WaypointAudioModule: Module {
  private let recorder = AudioRecorder()
  private let transcriber = LiveTranscriber()
  private let downloadLock = NSLock()
  private var downloads = 0  // downloadLock: downloads running now (a second tap starts a second one)

  public func definition() -> ModuleDefinition {
    Name("WaypointAudio")
    Events("onState", "onPart", "onLevel", "onTranscript", "onSpeechError", "onSpeechPack")

    OnCreate {
      self.recorder.onEvent = { [weak self] name, body in self?.sendEvent(name, body) }
      self.recorder.sink = self.transcriber
      self.transcriber.onEvent = { [weak self] name, body in self?.sendEvent(name, body) }
      Task { await self.transcriber.configure(locale: await SpeechSetup.installedLocale()) }
    }

    AsyncFunction("getMicPermission") { () -> String in AudioRecorder.micPermission() }
    AsyncFunction("requestMicPermission") { () async -> String in await AudioRecorder.requestMicPermission() }
    AsyncFunction("start") { (sessionId: String, elapsedMs: Double, firstIndex: Int, priorRecordedMs: Double) throws in
      try self.recorder.start(
        sessionId: sessionId, elapsedMs: Int64(elapsedMs), firstIndex: firstIndex, priorRecordedMs: Int64(priorRecordedMs))
    }
    AsyncFunction("pause") { () throws in try self.recorder.pause(reason: "user") }
    AsyncFunction("resume") { () throws in try self.recorder.resume() }
    AsyncFunction("stop") { () async throws -> Double in
      let recordedMs = try self.recorder.stop()
      await self.transcriber.waitForFinals(seconds: 5) // the last words reach the app before the recording screen closes
      return recordedMs
    }
    Function("getStatus") { () -> [String: Any] in self.recorder.status() }

    AsyncFunction("getSpeechStatus") { () async -> [String: Any] in await self.speechStatus() }
    AsyncFunction("downloadSpeechPack") { () async throws -> [String: Any] in
      guard let locale = await SpeechSetup.chooseLocale() else { return await self.speechStatus() }
      if await SpeechSetup.isInstalled(locale) { return await self.speechStatus() }
      self.changeDownloads(by: 1)
      defer { self.changeDownloads(by: -1) }
      try await SpeechSetup.download(locale: locale) { fraction in
        self.sendEvent("onSpeechPack", ["fraction": fraction])
      }
      await self.transcriber.configure(locale: locale)
      return await self.speechStatus()
    }
    AsyncFunction("transcribeFile") { (file: String, startMs: Double) async throws -> [[String: Any]] in
      try await SpeechSetup.transcribeFile(file: file, startMs: startMs)
    }
  }

  private func speechStatus() async -> [String: Any] {
    let locale = await SpeechSetup.chooseLocale()
    let pack: String
    if locale == nil {
      pack = "unsupported"
    } else if isDownloading() {
      pack = "downloading"
    } else if let locale, await SpeechSetup.isInstalled(locale) {
      pack = "installed"
    } else {
      pack = "not_installed"
    }
    return ["engine": SpeechSetup.engine, "locale": locale?.identifier ?? "", "pack": pack]
  }

  private func isDownloading() -> Bool { downloadLock.withLock { downloads > 0 } }

  private func changeDownloads(by delta: Int) { downloadLock.withLock { downloads += delta } }
}
