import ExpoModulesCore
import NaturalLanguage

public class WaypointEmbedModule: Module {
  private func embedding() -> (NLEmbedding, NLLanguage)? {
    let preferred = NLLanguage(rawValue: String(Locale.preferredLanguages.first?.prefix(2) ?? "en"))
    if let e = NLEmbedding.sentenceEmbedding(for: preferred) { return (e, preferred) }
    if let e = NLEmbedding.sentenceEmbedding(for: .english) { return (e, .english) }
    return nil
  }

  public func definition() -> ModuleDefinition {
    Name("WaypointEmbed")

    Function("getModel") { () -> [String: Any] in
      guard let (e, lang) = self.embedding() else { return ["available": false, "modelVersion": "", "dimension": 0] }
      return ["available": true, "modelVersion": "nl-sentence:\(lang.rawValue):\(e.revision)", "dimension": e.dimension]
    }

    AsyncFunction("embed") { (texts: [String]) -> [[Double]] in
      guard let found = self.embedding() else { throw Exception(name: "Embed", description: "no sentence embedding", code: "unavailable") }
      let e = found.0
      return texts.map { e.vector(for: $0) ?? [] }
    }
  }
}
