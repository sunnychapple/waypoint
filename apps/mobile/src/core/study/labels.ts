const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// The model states that are not "available". The caller narrows ModelAvailability to these.
export type Unavailable = "device_not_eligible" | "apple_intelligence_off" | "model_not_ready" | "unavailable";

// "<1m" up to one minute, minutes under an hour, hours under a day, days under 60 days, else months.
export function intervalLabel(ms: number): string {
  if (ms <= MINUTE_MS) return "<1m";
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(ms / HOUR_MS);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(ms / DAY_MS);
  if (days < 60) return `${days}d`;
  return `${Math.round(ms / (30 * DAY_MS))}mo`;
}

// Thirty seconds a card, rounded up to whole minutes.
export function minutesLabel(cards: number): string {
  return `About ${Math.ceil((cards * 30) / 60)} min`;
}

export function madeSummary(cards: { kind: "term" | "problem" | "question" }[]): { terms: number; problems: number } {
  return {
    terms: cards.filter((card) => card.kind === "term").length,
    problems: cards.filter((card) => card.kind === "problem").length,
  };
}

export function availabilityMessage(availability: Unavailable): string {
  switch (availability) {
    case "device_not_eligible":
      return "Flashcards, quizzes and help are made by Apple Intelligence, which this iPhone doesn't have. Recording, pages and search still work.";
    case "apple_intelligence_off":
      return "Turn on Apple Intelligence in Settings to make flashcards on this iPhone.";
    case "model_not_ready":
      return "Apple Intelligence is still getting ready on this iPhone. Try again in a little while.";
    case "unavailable":
      return "Flashcards can't be made on this iPhone right now.";
  }
}

// Under the cloud Practice set button, on devices that can't make the study sets on the iPhone.
export const CLOUD_PRACTICE_LINE = "You can still make a Practice set with NotePath's cloud (uses credits).";

// Shown instead of "Try again" when the on-device model rejects the notes' language.
export const UNSUPPORTED_LANGUAGE_LINE = "NotePath can't make this for notes in this language yet.";

// Shown when the session has no text to read at all. The model is not asked in that case.
export const NO_TEXT_TITLE = "NotePath couldn't find any words here.";
export const NO_TEXT_BODY = "Open your notes to read the pages again, or type in the words.";

// The on-device model's error code for notes in a language it doesn't support. Retrying the same notes cannot help.
export function isUnsupportedLanguage(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "unsupported_language";
}

// What VoiceOver says for each rating button, in plain words. The visible text stays "Again", "Hard", "Good", "Easy".
export const RATING_SPOKEN: Record<1 | 2 | 3 | 4, string> = {
  1: "Again — I didn't know it",
  2: "Hard — I barely knew it",
  3: "Good — I knew it",
  4: "Easy — I knew it right away",
};
