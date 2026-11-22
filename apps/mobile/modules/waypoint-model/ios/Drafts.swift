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
  @Guide(description: "The exact words from the text that answer the question, copied word for word")
  var evidence: String
  @Guide(description: "The right answer, short, taken from the evidence")
  var answer: String
  @Guide(description: "Three wrong answers that sound possible but are not supported by the text, each different from the right answer")
  var wrongChoices: [String]
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

let mathPlanInstructions = """
You turn a school word problem into one math expression. Decide what the question asks for, then use only the numbers needed for it. \
A problem can include a number that is not needed. A percent such as 25% is written 25/100. Do not calculate.

Examples:
Problem: 30 players each ran 4 miles a day for 5 days. How many miles did each player run?
Expression: 4 * 5
Problem: 2 cups of sugar make 3 cakes. How many cups make 12 cakes?
Expression: 2 / 3 * 12
Problem: A yard is 8 m by 5 m. Fence costs $2 per meter. What does it cost to fence the yard?
Expression: 2 * (8 + 5) * 2
Problem: Lee had $50 and spent $4 on each of 6 books. How much is left?
Expression: 50 - 4 * 6
Problem: A $60 coat is 10% off. What is the sale price?
Expression: 60 - 60 * 10/100
Problem: A number times 3 plus 4 is 19. What is the number?
Expression: (19 - 4) / 3
"""

@Generable struct MathPlanDraft {
  @Guide(description: "What the question asks for, in a few words")
  var asks: String
  @Guide(description: "Each number the answer needs and what it means. Leave out numbers the answer does not need.")
  var given: [String]
  @Guide(description: "One math expression that gives the answer, using only numbers, + - * / and parentheses. Do not work it out.")
  var expression: String
  @Guide(description: "The unit of the answer, such as miles or dollars. Empty if there is none.")
  var unit: String
}
