import ExpoModulesCore

// On-device voices (M22b). Thin: the work is in ScriptRenderer.swift and Core/.
public class WaypointVoicesModule: Module {
  private let renderer = ScriptRenderer()

  public func definition() -> ModuleDefinition {
    Name("WaypointVoices")

    AsyncFunction("renderScript") { (lines: [[String: String]], outPath: String, language: String) async throws -> [String: Any] in
      do {
        let outURL = try Self.documentsURL(for: outPath)
        let parsed = try lines.map { line -> ScriptRenderer.Line in
          guard let voice = line["voice"], voice == "A" || voice == "B", let text = line["text"] else { throw VoiceError.badInput }
          return ScriptRenderer.Line(voice: voice, text: text)
        }
        let result = try await self.renderer.render(lines: parsed, outURL: outURL, language: language)
        return ["durationMs": result.durationMs, "lineStartsMs": result.lineStartsMs, "voices": result.voices]
      } catch let error as VoiceError {
        throw Exception(name: "WaypointVoices", description: error.code, code: error.code)
      } catch {
        throw Exception(name: "WaypointVoices", description: "\(error)", code: VoiceError.writeFailed.code)
      }
    }
    Function("cancelRender") { self.renderer.cancel() }
  }

  // Paths are relative to Documents; ".." and absolute paths are refused.
  private static func documentsURL(for path: String) throws -> URL {
    guard !path.isEmpty, !path.hasPrefix("/"), !path.split(separator: "/", omittingEmptySubsequences: false).contains("..") else {
      throw VoiceError.writeFailed
    }
    guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
      throw VoiceError.writeFailed
    }
    return documents.appendingPathComponent(path)
  }
}
