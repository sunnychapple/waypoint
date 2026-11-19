import Testing
@testable import PagesCore

struct PageLineTests {
  @Test func fromVisionTrimsTextAndFlipsTheBox() {
    let line = PageLine.fromVision(text: " 3x + 7 = 22 ", x: 0.1, y: 0.8, width: 0.5, height: 0.05)
    #expect(line == PageLine(text: "3x + 7 = 22", x: 0.1, y: 0.15, width: 0.5, height: 0.05))
  }

  @Test func blankTextGivesNil() {
    #expect(PageLine.fromVision(text: "   ", x: 0.1, y: 0.1, width: 0.5, height: 0.05) == nil)
  }

  @Test func negativeXClampsToZero() {
    let line = PageLine.fromVision(text: "a", x: -0.1, y: 0.5, width: 0.2, height: 0.1)
    #expect(line?.x == 0)
  }

  @Test func readingOrderPutsRowsLeftToRightThenBelow() {
    let right = PageLine(text: "right", x: 0.6, y: 0.101, width: 0.3, height: 0.04)
    let left = PageLine(text: "left", x: 0.1, y: 0.1, width: 0.3, height: 0.04)
    let below = PageLine(text: "below", x: 0.1, y: 0.2, width: 0.3, height: 0.04)
    #expect(PageLine.readingOrder([right, below, left]).map(\.text) == ["left", "right", "below"])
  }
}
