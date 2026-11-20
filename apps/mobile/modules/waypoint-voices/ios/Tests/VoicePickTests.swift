import Testing
@testable import VoicesCore

// Test voices get a real speech-voice identifier prefix, so VoicePick's filter keeps them.
private func v(_ name: String, _ lang: String, _ q: Int, _ g: VoiceInfo.Gender) -> VoiceInfo {
  VoiceInfo(identifier: "com.apple.voice.compact.\(name)", language: lang, quality: q, gender: g)
}

@Test func picksTheBestFemaleAndMaleVoiceOfTheLanguage() {
  let voices = [v("f1", "en-US", 1, .female), v("f2", "en-US", 3, .female), v("m1", "en-US", 2, .male), v("x", "fr-FR", 3, .male)]
  let pick = VoicePick.hosts(from: voices, language: "en-US")
  #expect(pick?.a.identifier == "com.apple.voice.compact.f2")
  #expect(pick?.b.identifier == "com.apple.voice.compact.m1")
}

@Test func fallsBackToTheBaseLanguageThenEnglish() {
  #expect(VoicePick.hosts(from: [v("a", "en-GB", 1, .male), v("b", "en-AU", 1, .female)], language: "en-US")?.a.identifier == "com.apple.voice.compact.b")
  #expect(VoicePick.hosts(from: [v("a", "en-US", 1, .male), v("b", "en-US", 1, .male)], language: "de-DE") != nil)
  #expect(VoicePick.hosts(from: [v("a", "en-US", 1, .male)], language: "en-US") == nil)
  #expect(VoicePick.hosts(from: [], language: "en-US") == nil)
}

@Test func twoDifferentVoicesEvenWithoutGenders() {
  let pick = VoicePick.hosts(from: [v("a", "en-US", 1, .unspecified), v("b", "en-US", 1, .unspecified)], language: "en-US")
  #expect(pick != nil && pick?.a.identifier != pick?.b.identifier)
}

@Test func neverPicksNoveltyVoices() {
  let eddy = VoiceInfo(identifier: "com.apple.eloquence.en-US.Eddy", language: "en-US", quality: 1, gender: .male)
  let flo = VoiceInfo(identifier: "com.apple.eloquence.en-US.Flo", language: "en-US", quality: 1, gender: .female)
  let samantha = VoiceInfo(identifier: "com.apple.voice.compact.en-US.Samantha", language: "en-US", quality: 1, gender: .female)
  let aaron = VoiceInfo(identifier: "com.apple.ttsbundle.siri_aaron_en-US_compact", language: "en-US", quality: 1, gender: .male)
  let pick = VoicePick.hosts(from: [eddy, flo, samantha, aaron], language: "en-US")
  #expect(pick?.a.identifier == "com.apple.voice.compact.en-US.Samantha")
  #expect(pick?.b.identifier == "com.apple.ttsbundle.siri_aaron_en-US_compact")
  #expect(VoicePick.hosts(from: [eddy, flo], language: "en-US") == nil)
}

@Test func lineStartsAddAPauseBetweenLines() {
  let t = ScriptTiming.lineStarts(durationsMs: [1000, 500, 2000])
  #expect(t.starts == [0, 1350, 2200])
  #expect(t.totalMs == 4200)
  #expect(ScriptTiming.lineStarts(durationsMs: []).totalMs == 0)
}
