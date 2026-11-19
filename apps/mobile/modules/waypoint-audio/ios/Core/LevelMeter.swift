import Foundation

enum LevelMeter {
  /// Root mean square of the samples, 0 for an empty buffer.
  static func rms(_ samples: UnsafeBufferPointer<Float>) -> Float {
    guard !samples.isEmpty else { return 0 }
    var sum: Float = 0
    for s in samples { sum += s * s }
    return (sum / Float(samples.count)).squareRoot()
  }

  /// Maps a level to 0...1 for the waveform: -50 dB or quieter is 0, 0 dB is 1, linear in dB between.
  static func normalized(rms: Float) -> Float {
    guard rms > 0 else { return 0 }
    let db = 20 * log10(rms)
    return min(1, max(0, (db + 50) / 50))
  }
}
