import { WORD_MAX_CHARS } from "@waypoint/contracts";
import { EDGE } from "../explain/excerpt.ts";
import type { LinePick } from "./marks.ts";

// The one word split for transcript lines. marks.ts uses it too, so highlight positions and selection positions always
// agree: whitespace-separated, empty words dropped. Punctuation stays on its word.
export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

// A word in a transcript: the start of its line and its place among the line's words, from 0.
export type WordRef = { at: number; index: number };
// From the first selected word to the last, in time order.
export type Selection = { from: WordRef; to: WordRef };
export type Picked = { text: string; lines: LinePick[] };

export function compareRefs(a: WordRef, b: WordRef): number {
  return a.at - b.at || a.index - b.index;
}

export function refKey(ref: WordRef): string {
  return `${ref.at}:${ref.index}`;
}

// S2, without dragging (React Native text gives no word positions): the first tap picks a word, a tap on another word
// selects everything between, a tap on the picked word clears it, and a tap after a range starts again.
export function nextSelection(current: Selection | null, tapped: WordRef): Selection | null {
  if (current === null || compareRefs(current.from, current.to) !== 0) return { from: tapped, to: tapped };
  const order = compareRefs(tapped, current.from);
  if (order === 0) return null;
  return order < 0 ? { from: tapped, to: current.from } : { from: current.from, to: tapped };
}

export function isSelected(selection: Selection | null, ref: WordRef): boolean {
  return selection !== null && compareRefs(selection.from, ref) <= 0 && compareRefs(ref, selection.to) <= 0;
}

export function lineWordCount(text: string): number {
  return wordsOf(text).length;
}

// Every word of a paragraph: VoiceOver's "Select this paragraph". Null when it has no words.
export function paragraphSelection(lines: { at: number; text: string }[]): Selection | null {
  const worded = lines.filter((line) => lineWordCount(line.text) > 0);
  const first = worded[0];
  const last = worded.at(-1);
  if (first === undefined || last === undefined) return null;
  return { from: { at: first.at, index: 0 }, to: { at: last.at, index: lineWordCount(last.text) - 1 } };
}

// What a selection holds in the shown lines (in time order): its words as written, with spaces collapsed and punctuation
// trimmed from both ends, and each line's first and last selected word. A position past a line's end (the line was
// edited) stops at its last word.
export function pickedText(lines: { at: number; text: string }[], selection: Selection): Picked {
  const texts: string[] = [];
  const picked: LinePick[] = [];
  for (const line of lines) {
    if (line.at < selection.from.at || line.at > selection.to.at) continue;
    const words = wordsOf(line.text);
    const from = line.at === selection.from.at ? selection.from.index : 0;
    const to = Math.min(line.at === selection.to.at ? selection.to.index : words.length - 1, words.length - 1);
    if (from > to || from >= words.length) continue;
    texts.push(words.slice(from, to + 1).join(" "));
    picked.push({ at: line.at, from, to });
  }
  return { text: texts.join(" ").replace(/\s+/g, " ").replace(EDGE, ""), lines: picked };
}

// Explain takes a word or a phrase of up to 100 characters (the explain request's limit).
export function canExplain(text: string): boolean {
  return text !== "" && text.length <= WORD_MAX_CHARS;
}

// Case and punctuation at the edges are ignored when matching words.
const matchKey = (word: string): string => word.replace(EDGE, "").toLowerCase();

// Note 1: saved explanations marked on the words they explain. An explanation is looked for in the line it was asked
// from (t is that line's start): the first place there where its words start, read on into the next lines for a phrase.
// Case and punctuation are ignored. Not found (the line was changed) means not marked. Returns refKey → explanation id.
export function explainedWords(lines: { at: number; text: string }[], explanations: { id: string; t: number; term: string }[]): Map<string, string> {
  const words: { ref: WordRef; key: string }[] = [];
  for (const line of lines) {
    wordsOf(line.text).forEach((word, index) => words.push({ ref: { at: line.at, index }, key: matchKey(word) }));
  }
  const marked = new Map<string, string>();
  for (const explanation of explanations) {
    const term = wordsOf(explanation.term).map(matchKey).filter((key) => key !== "");
    if (term.length === 0) continue;
    for (let p = 0; p < words.length; p += 1) {
      if (words[p]?.ref.at !== explanation.t) continue;
      if (!term.every((word, i) => words[p + i]?.key === word)) continue;
      for (let i = 0; i < term.length; i += 1) {
        const hit = words[p + i];
        if (hit !== undefined) marked.set(refKey(hit.ref), explanation.id);
      }
      break;
    }
  }
  return marked;
}
