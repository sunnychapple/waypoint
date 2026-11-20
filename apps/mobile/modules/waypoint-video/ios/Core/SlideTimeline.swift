import Foundation

// When each slide shows in the video: from the start of its narration to the start of the next slide's; the first
// from 0, the last to the end of the audio. Times in milliseconds. Starts are made non-decreasing first, so a slide
// whose narration does not start after the one before it gets no time.
public struct SlideSpan: Equatable, Sendable {
  public let index: Int
  public let startMs: Int
  public let endMs: Int
}

public enum SlideTimeline {
  public static func spans(slideStartsMs: [Int], totalMs: Int) -> [SlideSpan] {
    guard !slideStartsMs.isEmpty, totalMs > 0 else { return [] }
    var starts: [Int] = []
    for (i, start) in slideStartsMs.enumerated() {
      starts.append(i == 0 ? 0 : min(max(starts[i - 1], start), totalMs))
    }
    return starts.enumerated().compactMap { i, start in
      let end = i + 1 < starts.count ? starts[i + 1] : totalMs
      return end > start ? SlideSpan(index: i, startMs: start, endMs: end) : nil
    }
  }

  // The slide on screen at a moment (for the player's slide list), or nil past the end.
  public static func slide(at ms: Int, in spans: [SlideSpan]) -> Int? {
    spans.first { ms >= $0.startMs && ms < $0.endMs }?.index
  }
}
