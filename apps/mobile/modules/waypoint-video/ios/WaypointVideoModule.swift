import ExpoModulesCore

// Video overviews (M24a). Thin: the work is in SlideVideoWriter.swift and Core/.
public class WaypointVideoModule: Module {
  private let writer = SlideVideoWriter()

  public func definition() -> ModuleDefinition {
    Name("WaypointVideo")

    AsyncFunction("renderSlides") { (title: String, slides: [[String: Any]], slideStartsMs: [Double], audioPath: String, outPath: String) async throws -> [String: Any] in
      do {
        guard slideStartsMs.allSatisfy({ $0.isFinite }) else { throw VideoError.badInput }
        let content = try slides.map { slide -> SlideContent in
          guard let heading = slide["heading"] as? String, let bullets = slide["bullets"] as? [String] else { throw VideoError.badInput }
          return SlideContent(heading: heading, bullets: bullets)
        }
        let audioURL = try Self.documentsURL(for: audioPath)
        let outURL = try Self.documentsURL(for: outPath)
        let durationMs = try await self.writer.render(title: title, slides: content, slideStartsMs: slideStartsMs.map { Int($0.rounded()) }, audioURL: audioURL, outURL: outURL)
        return ["durationMs": durationMs]
      } catch let error as VideoError {
        throw Exception(name: "WaypointVideo", description: error.code, code: error.code)
      } catch {
        throw Exception(name: "WaypointVideo", description: "\(error)", code: VideoError.writeFailed.code)
      }
    }
  }

  // Paths are relative to Documents; ".." and absolute paths are refused.
  private static func documentsURL(for path: String) throws -> URL {
    guard !path.isEmpty, !path.hasPrefix("/"), !path.split(separator: "/", omittingEmptySubsequences: false).contains("..") else {
      throw VideoError.badInput
    }
    guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
      throw VideoError.writeFailed
    }
    return documents.appendingPathComponent(path)
  }
}
