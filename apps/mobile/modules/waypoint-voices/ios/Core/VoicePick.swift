import Foundation

// A system voice as AVSpeechSynthesisVoice describes it, without importing AVFoundation (so it is tested on the Mac).
public struct VoiceInfo: Equatable, Sendable {
  public enum Gender: Sendable { case female, male, unspecified }
  public let identifier: String
  public let language: String // BCP 47, for example "en-US"
  public let quality: Int // 1 default, 2 enhanced, 3 premium
  public let gender: Gender
  public init(identifier: String, language: String, quality: Int, gender: Gender) {
    self.identifier = identifier; self.language = language; self.quality = quality; self.gender = gender
  }
}

public enum VoicePick {
  // Two different voices for hosts A and B: same language as wanted (else the same base language, else en-US), best
  // quality first, and a female and a male voice when both exist. nil when no voice fits.
  public static func hosts(from installed: [VoiceInfo], language: String) -> (a: VoiceInfo, b: VoiceInfo)? {
    // Only the speech voices (compact, enhanced, premium); novelty voices such as com.apple.eloquence.* are left out.
    let voices = installed.filter { $0.identifier.hasPrefix("com.apple.voice.") || $0.identifier.hasPrefix("com.apple.ttsbundle.") }
    let base = language.split(separator: "-").first.map(String.init) ?? language
    let candidates = [
      voices.filter { $0.language == language },
      voices.filter { $0.language.hasPrefix(base + "-") || $0.language == base },
      voices.filter { $0.language == "en-US" },
    ].first { $0.count >= 2 } ?? []
    let ranked = candidates.sorted { ($0.quality, $1.identifier) > ($1.quality, $0.identifier) }
    guard let first = ranked.first else { return nil }
    let other = ranked.first { $0.identifier != first.identifier && $0.gender != first.gender && $0.gender != .unspecified && first.gender != .unspecified }
      ?? ranked.first { $0.identifier != first.identifier }
    guard let second = other else { return nil }
    return first.gender == .male && second.gender == .female ? (second, first) : (first, second)
  }
}

// Where each line of a rendered script starts, with a fixed pause between lines.
public enum ScriptTiming {
  public static let pauseMs = 350

  public static func lineStarts(durationsMs: [Int]) -> (starts: [Int], totalMs: Int) {
    var starts: [Int] = []
    var at = 0
    for (i, d) in durationsMs.enumerated() {
      starts.append(at)
      at += max(0, d) + (i == durationsMs.count - 1 ? 0 : pauseMs)
    }
    return (starts, at)
  }
}
