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

  /// Reading order: top to bottom, then into rows. A line joins the current row when its top is within half a
  /// line height of the row's first line; each row is read left to right. Sorting first makes the result the same
  /// for any input order (a pairwise "same row" test is not transitive on a slanted page).
  static func readingOrder(_ lines: [PageLine]) -> [PageLine] {
    let byTop = lines.sorted { ($0.y, $0.x, $0.text) < ($1.y, $1.x, $1.text) }
    var rows: [[PageLine]] = []
    for line in byTop {
      if let first = rows.last?.first, line.y - first.y <= min(first.height, line.height) / 2 {
        rows[rows.count - 1].append(line)
      } else {
        rows.append([line])
      }
    }
    return rows.flatMap { row in row.sorted { ($0.x, $0.y, $0.text) < ($1.x, $1.y, $1.text) } }
  }

  var dictionary: [String: Any] { ["text": text, "x": x, "y": y, "width": width, "height": height] }
}
