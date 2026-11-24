import { TRANSCRIPT_MAX_CHARS, WORD_MAX_CHARS } from "@waypoint/contracts";
import { listPages } from "../capture/pages.ts";
import type { SegmentLine } from "../capture/segments.ts";
import type { SqlDb } from "../db/sql.ts";

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
    .join(" ");
  return trimExcerpt(text, maxChars);
}

// Text with spaces collapsed, cut to maxChars from the start at a word boundary (the end is kept).
export function trimExcerpt(text: string, maxChars: number = TRANSCRIPT_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  const cut = collapsed.slice(collapsed.length - maxChars);
  const space = cut.indexOf(" ");
  return space === -1 ? cut : cut.slice(space + 1);
}

// A page the person tapped in: its number in the session (from 1) and its found text, or null when the session has no such page.
export function pageContext(db: SqlDb, sessionId: string, pageId: string): { number: number; text: string } | null {
  const pages = listPages(db, sessionId);
  const index = pages.findIndex((page) => page.id === pageId);
  if (index === -1) return null;
  return { number: index + 1, text: pages[index]?.foundText ?? "" };
}

// What the Explain sheet says is sent and what it says when there is nothing to send, for a recording line or a page.
// A phrase (selected words) says "these words".
export function contextCopy(isPage: boolean, phrase = false): { sent: string; missing: string } {
  const what = phrase ? "these words" : "this word";
  return isPage
    ? { sent: `NotePath sends ${what} and the text of this page, for this task only.`, missing: `There isn't any text from this page to explain ${what} with.` }
    : {
        sent: `NotePath sends ${what} and about a minute of the transcript around ${phrase ? "them" : "it"}, for this task only.`,
        missing: `There isn't enough of the transcript around ${what} yet.`,
      };
}

export type Token = { text: string; word: string | null };

export const EDGE = /^[\s"'“”‘’()[\]{}.,;:!?…—–-]+|[\s"'“”‘’()[\]{}.,;:!?…—–-]+$/g;

// The tappable word inside a token: punctuation trimmed from both ends; null when nothing is left or it is too long.
export function cleanWord(token: string): string | null {
  const word = token.replace(EDGE, "");
  return word === "" || word.length > WORD_MAX_CHARS ? null : word;
}

// Splits a line into tokens that keep every character, so joining their text gives the line back.
export function splitWords(line: string): Token[] {
  return (line.match(/\S+|\s+/g) ?? []).map((text) => ({ text, word: /^\s+$/.test(text) ? null : cleanWord(text) }));
}
