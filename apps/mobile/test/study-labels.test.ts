import { describe, expect, it } from "vitest";
import {
  availabilityMessage,
  CLOUD_PRACTICE_LINE,
  intervalLabel,
  isUnsupportedLanguage,
  madeSummary,
  minutesLabel,
  RATING_SPOKEN,
  UNSUPPORTED_LANGUAGE_LINE,
} from "../src/core/study/labels.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("study labels", () => {
  it("intervalLabel reads each boundary: under a minute, minutes, hours, days, months", () => {
    expect(intervalLabel(0)).toBe("<1m");
    expect(intervalLabel(MIN)).toBe("<1m");
    expect(intervalLabel(MIN + 1)).toBe("1m");
    expect(intervalLabel(6 * MIN)).toBe("6m");
    expect(intervalLabel(59 * MIN + 29_000)).toBe("59m");
    expect(intervalLabel(59.5 * MIN)).toBe("1h");
    expect(intervalLabel(HOUR)).toBe("1h");
    expect(intervalLabel(23 * HOUR)).toBe("23h");
    expect(intervalLabel(23.6 * HOUR)).toBe("1d");
    expect(intervalLabel(2 * DAY)).toBe("2d");
    expect(intervalLabel(5 * DAY)).toBe("5d");
    expect(intervalLabel(59 * DAY)).toBe("59d");
    expect(intervalLabel(60 * DAY)).toBe("2mo");
    expect(intervalLabel(90 * DAY)).toBe("3mo");
  });

  it("minutesLabel counts thirty seconds a card, rounded up", () => {
    expect(minutesLabel(14)).toBe("About 7 min");
    expect(minutesLabel(1)).toBe("About 1 min");
    expect(minutesLabel(3)).toBe("About 2 min");
  });

  it("madeSummary counts terms and problems and leaves out questions", () => {
    expect(madeSummary([{ kind: "term" }, { kind: "problem" }, { kind: "term" }, { kind: "question" }])).toEqual({ terms: 2, problems: 1 });
    expect(madeSummary([])).toEqual({ terms: 0, problems: 0 });
  });

  it("availabilityMessage gives the copy for device_not_eligible", () => {
    expect(availabilityMessage("device_not_eligible")).toBe(
      "Flashcards, quizzes and help are made by Apple Intelligence, which this iPhone doesn't have. Recording, pages and search still work.",
    );
  });

  it("availabilityMessage gives the copy for apple_intelligence_off", () => {
    expect(availabilityMessage("apple_intelligence_off")).toBe("Turn on Apple Intelligence in Settings to make flashcards on this iPhone.");
  });

  it("availabilityMessage gives the copy for model_not_ready", () => {
    expect(availabilityMessage("model_not_ready")).toBe("Apple Intelligence is still getting ready on this iPhone. Try again in a little while.");
  });

  it("availabilityMessage gives the copy for unavailable", () => {
    expect(availabilityMessage("unavailable")).toBe("Flashcards can't be made on this iPhone right now.");
  });

  it("the cloud Practice set line says it uses credits", () => {
    expect(CLOUD_PRACTICE_LINE).toBe("You can still make a Practice set with NotePath's cloud (uses credits).");
  });

  it("each rating is spoken in plain words", () => {
    expect([1, 2, 3, 4].map((rating) => RATING_SPOKEN[rating as 1 | 2 | 3 | 4])).toEqual([
      "Again — I didn't know it",
      "Hard — I barely knew it",
      "Good — I knew it",
      "Easy — I knew it right away",
    ]);
  });

  it("the unsupported language line says the language is not supported yet", () => {
    expect(UNSUPPORTED_LANGUAGE_LINE).toBe("NotePath can't make this for notes in this language yet.");
  });

  it("isUnsupportedLanguage matches only the on-device unsupported_language code", () => {
    expect(isUnsupportedLanguage({ code: "unsupported_language" })).toBe(true);
    expect(isUnsupportedLanguage({ code: "failed" })).toBe(false);
    expect(isUnsupportedLanguage(new Error("boom"))).toBe(false);
    expect(isUnsupportedLanguage(null)).toBe(false);
    expect(isUnsupportedLanguage("unsupported_language")).toBe(false);
  });
});
