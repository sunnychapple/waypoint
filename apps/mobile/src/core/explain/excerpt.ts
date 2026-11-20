import { TRANSCRIPT_MAX_CHARS, WORD_MAX_CHARS } from "@waypoint/contracts";
import type { SegmentLine } from "../capture/segments.ts";

// About 54 seconds of transcript around the tapped word: 45 s before it, 9 s after (docs/architecture.md flow 1).
export const EXCERPT_BEFORE_MS = 45_000;
export const EXCERPT_AFTER_MS = 9_000;

// The text of every segment that overlaps [t − 45 s, t + 9 s], in time order, with spaces collapsed. When it is longer
// than maxChars, words are dropped from the start, so the end (where the word was said) is kept.
export function excerptAround(segments: SegmentLine[], t: number, maxChars: number = TRANSCRIPT_MAX_CHARS): string {
  const from = t - EXCERPT_BEFORE_MS;
  const to = t + EXCERPT_AFTER_MS;
  const text = segments
    .filter((s) => s.tEnd >= from && s.tStart <= to)
    .sort((a, b) => a.tStart - b.tStart)
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(text.length - maxChars);
  const space = cut.indexOf(" ");
  return space === -1 ? cut : cut.slice(space + 1);
}

export type Token = { text: string; word: string | null };

const EDGE = /^[\s"'“”‘’()[\]{}.,;:!?…—–-]+|[\s"'“”‘’()[\]{}.,;:!?…—–-]+$/g;

// The tappable word inside a token: punctuation trimmed from both ends; null when nothing is left or it is too long.
export function cleanWord(token: string): string | null {
  const word = token.replace(EDGE, "");
  return word === "" || word.length > WORD_MAX_CHARS ? null : word;
}

// Splits a line into tokens that keep every character, so joining their text gives the line back.
export function splitWords(line: string): Token[] {
  return (line.match(/\S+|\s+/g) ?? []).map((text) => ({ text, word: /^\s+$/.test(text) ? null : cleanWord(text) }));
}
