import Foundation

/// What the speech module sends to JavaScript for one result.
struct TranscriptPiece: Equatable {
  let tStart: Int64
  let tEnd: Int64
  let text: String
  let isFinal: Bool

  /// `startSeconds`/`endSeconds` are the analyzer's times, counted from the start of the run.
  /// `runStartMs` is when the run started, in ms since the session started.
  /// Returns nil when the text is only whitespace.
  static func make(text: String, startSeconds: Double, endSeconds: Double, isFinal: Bool, runStartMs: Int64) -> TranscriptPiece? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let start = runStartMs + Int64((max(0, startSeconds) * 1000).rounded())
    let end = max(start, runStartMs + Int64((max(0, endSeconds) * 1000).rounded()))
    return TranscriptPiece(tStart: start, tEnd: end, text: trimmed, isFinal: isFinal)
  }

  var event: [String: Any] {
    ["tStart": Double(tStart), "tEnd": Double(tEnd), "text": text, "isFinal": isFinal]
  }
}

enum LocaleChooser {
  /// Picks the first preferred language the transcriber supports. Identifiers may use "-" or "_".
  /// An exact match ("en-GB") wins; otherwise the first supported locale with the same language ("en").
  static func choose(preferred: [String], supported: [String]) -> String? {
    func norm(_ id: String) -> String { id.replacingOccurrences(of: "_", with: "-").lowercased() }
    func lang(_ id: String) -> String { String(norm(id).split(separator: "-").first ?? "") }
    for p in preferred {
      if let exact = supported.first(where: { norm($0) == norm(p) }) { return exact }
      if let same = supported.first(where: { lang($0) == lang(p) }) { return same }
    }
    return nil
  }
}
