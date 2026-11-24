import Foundation

/// The camera's zoom as people see it. On an iPhone with an ultra wide lens, device factor 1 is the ultra wide (.5) and
/// `wideFactor` (the first switch-over factor, usually 2) is the main lens (1).
struct ZoomScale: Equatable {
  let wideFactor: Double
  let minFactor: Double
  let maxFactor: Double

  /// maxShown caps the zoom (10 shows as 10x), so people cannot zoom into noise.
  init(wideFactor: Double, minFactor: Double, maxFactor: Double, maxShown: Double = 10) {
    self.wideFactor = max(1, wideFactor)
    self.minFactor = minFactor
    self.maxFactor = max(minFactor, min(maxFactor, self.wideFactor * maxShown))
  }

  var hasUltraWide: Bool { wideFactor > minFactor }
  /// The buttons: .5 only with an ultra wide lens, then 1 and 2.
  var presets: [Double] { (hasUltraWide ? [0.5] : []) + [1, 2] }

  func clamp(_ factor: Double) -> Double { min(maxFactor, max(minFactor, factor)) }
  func shown(_ factor: Double) -> Double { factor / wideFactor }
  func factor(shown: Double) -> Double { clamp(shown * wideFactor) }

  /// The preset whose button shows the zoom now: the largest one at or below it.
  func active(shown: Double) -> Double { presets.last { $0 <= shown + 0.05 } ?? presets[0] }

  /// ".5", "1", "2"; the active button shows the zoom now with an x ("2x", "1.4x").
  func label(_ preset: Double, shown: Double) -> String {
    preset == active(shown: shown) ? Self.number(shown) + "x" : Self.number(preset)
  }

  static func number(_ value: Double) -> String {
    let rounded = (value * 10).rounded() / 10
    if rounded == rounded.rounded() { return String(Int(rounded)) }
    let text = String(format: "%.1f", rounded)
    return text.hasPrefix("0") ? String(text.dropFirst()) : text
  }
}
