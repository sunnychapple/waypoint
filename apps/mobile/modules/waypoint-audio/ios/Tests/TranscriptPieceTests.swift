import Testing
@testable import AudioCore

@Test func makeOffsetsTheTimesFromTheRunStart() {
  let piece = TranscriptPiece.make(text: " hi there ", startSeconds: 1.2344, endSeconds: 2.0, isFinal: true, runStartMs: 90_000)
  #expect(piece == TranscriptPiece(tStart: 91_234, tEnd: 92_000, text: "hi there", isFinal: true))
}

@Test func makeReturnsNilForWhitespaceOnlyText() {
  #expect(TranscriptPiece.make(text: " \n\t ", startSeconds: 0, endSeconds: 1, isFinal: true, runStartMs: 0) == nil)
}

@Test func makeKeepsAnEndBeforeTheStartAtTheStart() {
  let piece = TranscriptPiece.make(text: "word", startSeconds: 5, endSeconds: 3, isFinal: false, runStartMs: 0)
  #expect(piece?.tStart == 5_000)
  #expect(piece?.tEnd == piece?.tStart)
}

@Test func chooseLocalePrefersAnExactMatch() {
  #expect(LocaleChooser.choose(preferred: ["en-GB"], supported: ["en_US", "en_GB"]) == "en_GB")
}

@Test func chooseLocaleFallsBackToTheSameLanguage() {
  #expect(LocaleChooser.choose(preferred: ["en-AU", "fr-FR"], supported: ["fr_FR", "en_US"]) == "en_US")
}

@Test func chooseLocaleReturnsNilWhenNothingMatches() {
  #expect(LocaleChooser.choose(preferred: ["xx"], supported: ["en_US"]) == nil)
}
