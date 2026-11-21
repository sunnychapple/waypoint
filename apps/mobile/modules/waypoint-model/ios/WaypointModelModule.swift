import ExpoModulesCore
import FoundationModels

public class WaypointModelModule: Module {
  // One request at a time. The lock is only held for the flag, never across an await.
  private let lock = NSLock()
  private var busy = false

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
      try await self.run {
        let session = LanguageModelSession(instructions: studyInstructions)
        let response = try await session.respond(
          to: "Make up to \(max) flashcards from this text.\n\nText:\n\(text)",
          generating: CardSet.self)
        return response.content.cards.map { (card: CardDraft) -> [String: Any] in
          ["kind": card.kind == .term ? "term" : "problem", "front": card.front, "back": card.back]
        }
      }
    }

    AsyncFunction("makeQuiz") { (text: String, count: Int) async throws -> [[String: Any]] in
      try await self.run {
        let session = LanguageModelSession(instructions: studyInstructions)
        let response = try await session.respond(
          to: "Make \(count) quiz questions from this text. Each has four choices.\n\nText:\n\(text)",
          generating: QuizSet.self)
        return response.content.questions.map { (q: QuizDraft) -> [String: Any] in
          ["question": q.question, "evidence": q.evidence, "answer": q.answer, "wrongChoices": q.wrongChoices, "why": q.why]
        }
      }
    }

    AsyncFunction("helpWithProblem") { (problem: String, context: String) async throws -> [String: Any] in
      try await self.run {
        let session = LanguageModelSession(instructions: studyInstructions)
        let response = try await session.respond(
          to: "Help me solve this problem step by step.\n\nProblem:\n\(problem)\n\nThe page it is on:\n\(context)",
          generating: ProblemHelpDraft.self)
        let steps = response.content.steps.map { (step: HelpStepDraft) -> [String: Any] in
          ["title": step.title, "detail": step.detail]
        }
        return ["steps": steps, "answer": response.content.answer]
      }
    }
  }

  private func claim() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if busy { return false }
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
