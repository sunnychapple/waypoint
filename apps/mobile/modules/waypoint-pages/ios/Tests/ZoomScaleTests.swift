import Testing
@testable import PagesCore

struct ZoomScaleTests {
  private let withUltraWide = ZoomScale(wideFactor: 2, minFactor: 1, maxFactor: 123)

  @Test func zoomIsCappedTenTimesTheWideLens() {
    #expect(withUltraWide.maxFactor == 20)
  }

  @Test func ultraWideGivesAHalfPreset() {
    #expect(withUltraWide.presets == [0.5, 1, 2])
    #expect(withUltraWide.shown(1) == 0.5)
    #expect(withUltraWide.factor(shown: 2) == 4)
    #expect(withUltraWide.clamp(0.5) == 1)
    #expect(withUltraWide.clamp(50) == 20)
  }

  @Test func noUltraWideHasNoHalfPreset() {
    let scale = ZoomScale(wideFactor: 1, minFactor: 1, maxFactor: 16)
    #expect(scale.presets == [1, 2])
    #expect(scale.factor(shown: 0.5) == 1)
  }

  @Test func labelsShowTheZoomOnTheActiveButton() {
    #expect(withUltraWide.presets.map { withUltraWide.label($0, shown: 2) } == [".5", "1", "2x"])
    #expect(withUltraWide.presets.map { withUltraWide.label($0, shown: 1.4) } == [".5", "1.4x", "2"])
    #expect(withUltraWide.presets.map { withUltraWide.label($0, shown: 0.5) } == [".5x", "1", "2"])
    #expect(withUltraWide.presets.map { withUltraWide.label($0, shown: 7) } == [".5", "1", "7x"])
  }

  @Test func numbersDropTheLeadingZeroAndRoundToOnePlace() {
    #expect(ZoomScale.number(0.5) == ".5")
    #expect(ZoomScale.number(1) == "1")
    #expect(ZoomScale.number(2.04) == "2")
    #expect(ZoomScale.number(1.36) == "1.4")
  }
}
