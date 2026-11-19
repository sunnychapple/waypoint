import ExpoModulesCore

public class WaypointAudioModule: Module {
  private let recorder = AudioRecorder()

  public func definition() -> ModuleDefinition {
    Name("WaypointAudio")
    Events("onState", "onPart", "onLevel")

    OnCreate {
      self.recorder.onEvent = { [weak self] name, body in self?.sendEvent(name, body) }
    }

    AsyncFunction("getMicPermission") { () -> String in AudioRecorder.micPermission() }
    AsyncFunction("requestMicPermission") { () async -> String in await AudioRecorder.requestMicPermission() }
    AsyncFunction("start") { (sessionId: String) throws in try self.recorder.start(sessionId: sessionId) }
    AsyncFunction("pause") { () throws in try self.recorder.pause(reason: "user") }
    AsyncFunction("resume") { () throws in try self.recorder.resume() }
    AsyncFunction("stop") { () throws -> Double in try self.recorder.stop() }
    Function("getStatus") { () -> [String: Any] in self.recorder.status() }
  }
}
