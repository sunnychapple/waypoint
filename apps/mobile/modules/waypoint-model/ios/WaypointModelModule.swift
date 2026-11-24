import ExpoModulesCore
import FoundationModels

public class WaypointModelModule: Module {
  // One request at a time. The lock is only held for the flag, never across an await.
  private let lock = NSLock()
  private var busy = false
  // The background likely-term suggestion, its Task and how many are running. Guarded by the same lock.
  private var termTask: Task<[String: Any], Error>?
  private var termActive = 0

  public func definition() -> ModuleDefinition {
    Name("WaypointModel")

    Function("getAvailability") { () -> String in
      switch SystemLanguageModel.default.availability {
      case .available:
        return "available"
      case .unavailable(let reason):
        switch reason {
        case .deviceNotEligible: return "device_not_eligible"
        case .appleIntelligenceNotEnabled: return "apple_intelligence_off"
        case .modelNotReady: return "model_not_ready"
        default: return "unavailable"
        }
      }
    }

    Function("getContextSize") { () -> Int in
      SystemLanguageModel.default.contextSize
    }

    AsyncFunction("makeCards") { (text: String, max: Int) async throws -> [[String: Any]] in
      try await self.runAfterTerm { () async throws -> [[String: Any]] in
        let prompt = "Make up to \(max) flashcards from this text.\n\nText:\n\(text)"
        do {
          let session = LanguageModelSession(instructions: studyInstructions)
          let response = try await session.respond(to: prompt, generating: CardSet.self)
          return response.content.cards.map { (card: CardDraft) -> [String: Any] in
            ["kind": card.kind == .term ? "term" : "problem", "front": card.front, "back": card.back]
          }
        } catch where modelErrorCode(error) == "declined" {
          let p = "Make up to \(max) flashcards from this text.\n\nText:\n\(text)\n\nWrite each flashcard as exactly two lines, with a blank line between flashcards:\nFRONT: the word, idea, or question\nBACK: what it means, or the answer, in one or two sentences\nWrite nothing else."
          return [["plainText": try await self.respondAsText(p)]]
        }
      }
    }

    AsyncFunction("makeQuiz") { (text: String, count: Int) async throws -> [[String: Any]] in
      try await self.runAfterTerm { () async throws -> [[String: Any]] in
        let prompt = "Make up to \(count) quiz questions from this text. Each has four choices. Ask only about things the text states.\n\nText:\n\(text)"
        do {
          let session = LanguageModelSession(instructions: studyInstructions)
          let response = try await session.respond(to: prompt, generating: QuizSet.self)
          return response.content.questions.map { (q: QuizDraft) -> [String: Any] in
            ["question": q.question, "evidence": q.evidence, "answer": q.answer, "wrongChoices": q.wrongChoices, "why": q.why]
          }
        } catch where modelErrorCode(error) == "declined" {
          return try await self.respondAsJSON(
            prompt,
            keys: "question, evidence (exact words copied from the text), answer (short, taken from the evidence), wrongChoices (three strings), why")
        }
      }
    }

    AsyncFunction("helpWithProblem") { (problem: String, context: String) async throws -> [String: Any] in
      try await self.runAfterTerm { () async throws -> [String: Any] in
        let prompt = "Help me solve this problem step by step.\n\nProblem:\n\(problem)\n\nThe page it is on:\n\(context)"
        do {
          let session = LanguageModelSession(instructions: studyInstructions)
          let response = try await session.respond(to: prompt, generating: ProblemHelpDraft.self)
          let steps = response.content.steps.map { (step: HelpStepDraft) -> [String: Any] in
            ["title": step.title, "detail": step.detail]
          }
          return ["steps": steps, "answer": response.content.answer]
        } catch where modelErrorCode(error) == "declined" {
          let p = prompt + "\n\nWrite two to six steps, then the answer, in exactly this form:\nSTEP: a short name for the step\nDO: what to do in this step and why, without giving the final answer\nANSWER: the final answer\nWrite nothing else."
          return ["plainText": try await self.respondAsText(p)]
        }
      }
    }

    AsyncFunction("summarize") { (text: String) async throws -> [String: Any] in
      try await self.runAfterTerm { () async throws -> [String: Any] in
        let prompt = "Give this text a short title and a short summary.\n\nText:\n\(text)"
        do {
          let session = LanguageModelSession(instructions: studyInstructions)
          let response = try await session.respond(to: prompt, generating: SummaryDraft.self)
          return ["title": response.content.title, "summary": response.content.summary]
        } catch where modelErrorCode(error) == "declined" {
          let p = prompt + "\n\nWrite exactly two lines:\nTITLE: a short title, at most eight words\nSUMMARY: two or three short sentences\nWrite nothing else."
          return ["plainText": try await self.respondAsText(p)]
        }
      }
    }

    // A background suggestion. It yields to every other request: those cancel it first (see runAfterTerm).
    AsyncFunction("likelyTerm") { (word: String, context: String) async throws -> [String: Any] in
      await self.stopLikelyTerm()
      let task = self.startTermTask(word: word, context: context)
      return try await task.value
    }

    // Cancels the suggestion in flight, if any. It resolves with an empty object instead of a guess.
    Function("cancelLikelyTerm") { () -> Void in
      self.currentTermTask()?.cancel()
    }
  }

  // Apple's default filter refuses ordinary schoolwork such as a page about a war. The text is the student's own page, so a
  // refused request is asked again in the mode meant for transforming the person's text. Quizzes ask that mode for JSON;
  // flashcards and problem help ask for labeled plain lines instead, because that mode does not reliably follow JSON keys.
  private func respondAsText(_ prompt: String) async throws -> String {
    let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)
    let session = LanguageModelSession(model: model, instructions: studyInstructions)
    return try await session.respond(to: prompt).content
  }

  private func respondAsJSON(_ prompt: String, keys: String) async throws -> [[String: Any]] {
    let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)
    let session = LanguageModelSession(model: model, instructions: studyInstructions)
    let reply = try await session.respond(to: "\(prompt)\n\nReply with only a JSON array. Each item has the keys \(keys).").content
    guard let start = reply.firstIndex(of: "["), let end = reply.lastIndex(of: "]"), start < end,
      let data = String(reply[start...end]).data(using: .utf8),
      let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
    else { throw Exception(name: "Model", description: "The reply was not a list", code: "failed") }
    return list
  }

  // The likely-term suggestion is cheap to lose and must never make the student's own request fail as busy. It is
  // cancelled, and given up to one second to release the request lock, before any other request runs.
  private func stopLikelyTerm() async {
    guard let task = currentTermTask() else { return }
    task.cancel()
    let deadline = Date().addingTimeInterval(1)
    while activeTerms() > 0 && Date() < deadline {
      try? await Task.sleep(nanoseconds: 20_000_000)
    }
  }

  private func runAfterTerm<T>(_ body: () async throws -> T) async throws -> T {
    await stopLikelyTerm()
    return try await run(body)
  }

  // Empty when the suggestion was cancelled, so the TypeScript side reads it as "no guess".
  private func runTerm(word: String, context: String) async throws -> [String: Any] {
    guard claim(skipIfCancelled: true) else {
      if Task.isCancelled { return [:] }
      throw Exception(name: "Model", description: "Another request is still running", code: "busy")
    }
    defer { release() }
    if Task.isCancelled { return [:] }
    // A quote would end the word early in the prompt, and a line break would split it, so both are replaced.
    let safeWord = String(word.compactMap { (c: Character) -> Character? in c.isNewline ? nil : (c == "\"" ? "'" : c) })
    let prompt = "The transcript wrote the word \"\(safeWord)\". Did the speaker probably say a different term?\n\nTranscript:\n\(context)"
    do {
      let session = LanguageModelSession(instructions: termInstructions)
      let options = GenerationOptions(samplingMode: .greedy, maximumResponseTokens: 120)
      let guess = try await session.respond(to: prompt, generating: TermGuessDraft.self, options: options).content
      if Task.isCancelled { return [:] }
      return ["misheard": guess.misheard, "term": guess.term, "original": guess.original, "language": guess.language, "meaning": guess.meaning]
    } catch {
      // A cancelled suggestion is "no guess", whatever error the model threw while it was stopped.
      if Task.isCancelled { return [:] }
      throw Exception(name: "Model", description: String(describing: error), code: modelErrorCode(error))
    }
  }

  private func currentTermTask() -> Task<[String: Any], Error>? {
    lock.lock()
    defer { lock.unlock() }
    return termTask
  }

  // The count and the stored Task are set under one lock acquisition. A stop that runs next therefore never sees an
  // active suggestion without its Task to cancel, which would leave it waiting on a count that nothing lowers.
  private func startTermTask(word: String, context: String) -> Task<[String: Any], Error> {
    lock.lock()
    defer { lock.unlock() }
    termActive += 1
    let task = Task { () async throws -> [String: Any] in
      defer { self.markTermEnded() }
      return try await self.runTerm(word: word, context: context)
    }
    termTask = task
    return task
  }

  private func activeTerms() -> Int {
    lock.lock()
    defer { lock.unlock() }
    return termActive
  }

  private func markTermEnded() {
    lock.lock()
    defer { lock.unlock() }
    termActive -= 1
  }

  // skipIfCancelled makes the suggestion's claim fail once it is cancelled, so it cannot take the lock after a stop.
  private func claim(skipIfCancelled: Bool = false) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if busy || (skipIfCancelled && Task.isCancelled) { return false }
    busy = true
    return true
  }

  private func release() {
    lock.lock()
    defer { lock.unlock() }
    busy = false
  }

  private func run<T>(_ body: () async throws -> T) async throws -> T {
    guard claim() else {
      throw Exception(name: "Model", description: "Another request is still running", code: "busy")
    }
    defer { release() }
    do {
      return try await body()
    } catch {
      throw Exception(name: "Model", description: String(describing: error), code: modelErrorCode(error))
    }
  }
}
