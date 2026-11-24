import { z } from "zod";

// S3: what the model thinks was said where the transcript wrote `heard`. `original` is the term in its own script when
// that differs from `term`.
export type TermGuess = { heard: string; term: string; original: string | null; language: string; meaning: string };

const guessSchema = z.object({ misheard: z.boolean(), term: z.string(), original: z.string(), language: z.string(), meaning: z.string() });

// Letters and digits only, lower case, so "Naïve," and "naïve" compare the same.
const loose = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const tidy = (text: string): string => text.replace(/\s+/g, " ").trim().replace(/^["“”'‘’]+|["“”'‘’.]+$/g, "").trim();
const length = (text: string): number => [...text].length;

// Null when the model thinks the word was heard right, left a part empty or too long, or only repeated the word.
export function cleanTermGuess(raw: unknown, heard: string): TermGuess | null {
  const parsed = guessSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.misheard) return null;
  const term = tidy(parsed.data.term);
  const original = tidy(parsed.data.original);
  const language = tidy(parsed.data.language);
  const meaning = tidy(parsed.data.meaning);
  if (term === "" || length(term) > 60 || language === "" || length(language) > 40 || meaning === "" || length(meaning) > 120) return null;
  if (loose(term) === loose(heard)) return null;
  return { heard, term, original: original === "" || loose(original) === loose(term) ? null : original, language, meaning };
}

const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// Unicode isolates keep text in another script from reordering the words around it (right-to-left text, for one).
const isolate = (text: string): string => `\u2068${text}\u2069`;

// "Probably <term> (<original>)", as on board S3.
export function guessHeadline(guess: TermGuess): string {
  return guess.original === null ? `Probably ${guess.term}` : `Probably ${guess.term} (${isolate(guess.original)})`;
}

// What a screen reader says for the headline: "Probably mochi, Japanese, written もち". Parts that are null are left out.
export function guessLabel(guess: TermGuess): string {
  const written = guess.original === null ? "" : `, written ${isolate(guess.original)}`;
  return `Probably ${guess.term}, ${upper(guess.language)}${written}`;
}

// "The transcript wrote "<heard>". <Term> is the <Language> word for <meaning>."
export function guessSentence(guess: TermGuess): string {
  return `The transcript wrote "${guess.heard}". ${upper(guess.term)} is the ${upper(guess.language)} word for ${guess.meaning}.`;
}
