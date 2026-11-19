import Vision

enum PageReader {
  static func read(file: String) async throws -> [String: Any] {
    let url = PageStore.documents.appendingPathComponent(file)
    var request = RecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.automaticallyDetectsLanguage = true
    let observations = try await request.perform(on: url)
    let lines = observations.compactMap { o -> PageLine? in
      guard let text = o.topCandidates(1).first?.string else { return nil }
      let r = o.boundingBox.cgRect
      return PageLine.fromVision(text: text, x: r.origin.x, y: r.origin.y, width: r.width, height: r.height)
    }
    let ordered = PageLine.readingOrder(lines)
    return ["text": ordered.map(\.text).joined(separator: "\n"), "lines": ordered.map(\.dictionary)]
  }
}
