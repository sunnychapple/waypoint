import Foundation

/// One line of text found on a page. The box is in 0...1 page units with the origin at the top left.
struct PageLine: Equatable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double

  /// Vision gives boxes with the origin at the bottom left. Values are clamped to 0...1 and rounded to 4 places.
  static func fromVision(text: String, x: Double, y: Double, width: Double, height: Double) -> PageLine? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    func r(_ v: Double) -> Double { (min(1, max(0, v)) * 10_000).rounded() / 10_000 }
    return PageLine(text: trimmed, x: r(x), y: r(1 - y - height), width: r(width), height: r(height))
  }

  /// Reading order: top to bottom; lines whose tops are within half a line height count as one row, left to right.
  static func readingOrder(_ lines: [PageLine]) -> [PageLine] {
    lines.sorted { a, b in
      let tolerance = min(a.height, b.height) / 2
      if abs(a.y - b.y) <= tolerance { return a.x < b.x }
      return a.y < b.y
    }
  }

  var dictionary: [String: Any] { ["text": text, "x": x, "y": y, "width": width, "height": height] }
}
