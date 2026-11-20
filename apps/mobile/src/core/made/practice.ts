import type { PracticeSetResult } from "@waypoint/contracts";

export type PracticeQuestion = PracticeSetResult["questions"][number];

// Lowercase words without punctuation or a leading article, for comparing a typed answer with the model's.
export function answerKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/(\d)\.(?=\d)/g, "$1DOT")
    .replace(/[.-]/g, " ")
    .replace(/DOT/g, ".")
    .split(/\s+/)
    .filter((w) => w !== "")
    .filter((w, i) => !(i === 0 && (w === "a" || w === "an" || w === "the")))
    .join(" ");
}

// "right": exact choice or the same answer key; "check": a short answer that differs, which the student marks
// themselves after seeing the answer; "wrong": a wrong choice or an empty answer.
export type Grade = "right" | "wrong" | "check";

export function grade(question: PracticeQuestion, given: string | number): Grade {
  if (question.kind === "multiple_choice") return given === question.answer ? "right" : "wrong";
  const typed = typeof given === "string" ? answerKey(given) : "";
  if (typed === "") return "wrong";
  return typed === answerKey(question.answer) ? "right" : "check";
}

export function score(grades: Grade[]): { right: number; total: number } {
  return { right: grades.filter((g) => g === "right").length, total: grades.length };
}
