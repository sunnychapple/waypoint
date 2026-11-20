import Testing
@testable import VideoCore

@Test func spansCoverTheAudioFromZero() {
  let spans = SlideTimeline.spans(slideStartsMs: [200, 5000, 9000], totalMs: 12000)
  #expect(spans == [SlideSpan(index: 0, startMs: 0, endMs: 5000), SlideSpan(index: 1, startMs: 5000, endMs: 9000), SlideSpan(index: 2, startMs: 9000, endMs: 12000)])
  #expect(SlideTimeline.slide(at: 4999, in: spans) == 0)
  #expect(SlideTimeline.slide(at: 12000, in: spans) == nil)
}

@Test func outOfOrderOrLateStartsNeverGoBackwards() {
  let spans = SlideTimeline.spans(slideStartsMs: [0, 8000, 6000, 20000], totalMs: 10000)
  #expect(spans.map(\.index) == [0, 2])
  #expect(spans.last?.endMs == 10000)
  #expect(SlideTimeline.spans(slideStartsMs: [], totalMs: 10).isEmpty)
}
