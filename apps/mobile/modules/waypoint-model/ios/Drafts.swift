import FoundationModels

let studyInstructions = """
You help a school student study their own notes. Use only the text you are given. \
Do not add facts that are not in the text. Write short, plain sentences at the reading level of the text.
"""

@Generable enum DraftKind { case term, problem }

@Generable struct CardDraft {
  @Guide(description: "term for a word or idea and what it means; problem for a worked problem from the text")
  var kind: DraftKind
  @Guide(description: "The front of the card: the term, or the problem to solve")
  var front: String
  @Guide(description: "The back: what the term means in one or two sentences, or the steps and the answer")
  var back: String
}

@Generable struct CardSet {
  @Guide(description: "The flashcards, most important first")
  var cards: [CardDraft]
}

@Generable struct QuizDraft {
  var question: String
  @Guide(description: "Exactly four answer choices, only one of them right")
  var choices: [String]
  @Guide(description: "Position of the right choice, from 0 to 3")
  var answerIndex: Int
  @Guide(description: "One sentence saying why the right answer is right")
  var why: String
}

@Generable struct QuizSet { var questions: [QuizDraft] }

@Generable struct HelpStepDraft {
  @Guide(description: "A short name for this step")
  var title: String
  @Guide(description: "What to do in this step and why. Do not give the final answer here.")
  var detail: String
}

@Generable struct ProblemHelpDraft {
  @Guide(description: "The steps to solve the problem, in order, two to six of them")
  var steps: [HelpStepDraft]
  @Guide(description: "The final answer")
  var answer: String
}
