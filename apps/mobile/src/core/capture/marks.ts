import { z } from "zod";
import type { SqlDb } from "../db/sql.ts";

type Deps = { now: () => number };

// Who said lines that more than one person said (note 19). A typed name always has a letter or a digit, so it is never this.
export const SEVERAL = "*";
export const SPEAKER_MAX_CHARS = 40;
export const LINE_TEXT_MAX_CHARS = 2000;

// Highlighted words of one line: [first, last] word positions (from 0, counted as selection.ts counts them), inclusive.
export type Span = [number, number];
// What the person changed on one transcript line (Next 1). text null shows what was heard.
export type LineMark = { tStart: number; text: string | null; hidden: boolean; speaker: string | null; highlights: Span[] };
// One line's part of a selection: its start, and its first and last selected word.
export type LinePick = { at: number; from: number; to: number };

const SpanSchema = z.tuple([z.number().int().min(0), z.number().int().min(0)]);

// Words as selection counts them: whitespace-separated. selection.ts does not exist yet (T4), so this is the split for now.
const wordsOf = (text: string): string[] => text.split(/\s+/).filter((w) => w !== "");

// Spans stay sorted and merged: touching or overlapping spans become one.
function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last !== undefined && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

// Reads the stored spans one by one: a bad entry is dropped and the valid ones are kept. At most 500 entries are read.
function parseSpans(raw: string): Span[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const valid: Span[] = [];
  for (const item of parsed.slice(0, 500)) {
    const span = SpanSchema.safeParse(item);
    if (span.success && span.data[0] <= span.data[1]) valid.push(span.data);
  }
  return mergeSpans(valid);
}

type Row = { t_start: number; text: string | null; hidden: number; speaker: string | null; highlights: string };
const COLUMNS = "t_start, text, hidden, speaker, highlights";

function fromRow(row: Row): LineMark {
  return { tStart: row.t_start, text: row.text, hidden: row.hidden === 1, speaker: row.speaker, highlights: parseSpans(row.highlights) };
}

export function lineMarks(db: SqlDb, sessionId: string): LineMark[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM line_marks WHERE session_id = ? ORDER BY t_start`, [sessionId]).map(fromRow);
}

function markAt(db: SqlDb, sessionId: string, tStart: number): LineMark {
  const row = db.get<Row>(`SELECT ${COLUMNS} FROM line_marks WHERE session_id = ? AND t_start = ?`, [sessionId, tStart]);
  return row === null ? { tStart, text: null, hidden: false, speaker: null, highlights: [] } : fromRow(row);
}

const sameMark = (a: LineMark, b: LineMark): boolean =>
  a.text === b.text && a.hidden === b.hidden && a.speaker === b.speaker && JSON.stringify(a.highlights) === JSON.stringify(b.highlights);

// The lines among tStarts that are device lines of this session. Only whole-number starts are looked up, in one query.
function existingLines(db: SqlDb, sessionId: string, tStarts: number[]): number[] {
  const wanted = [...new Set(tStarts.filter((t) => Number.isInteger(t)))];
  if (wanted.length === 0) return [];
  const slots = wanted.map(() => "?").join(", ");
  return db
    .all<{ t_start: number }>(
      `SELECT t_start FROM segments WHERE session_id = ? AND source = 'device' AND t_start IN (${slots})`,
      [sessionId, ...wanted],
    )
    .map((row) => row.t_start);
}

// Keeps one line's mark, or removes its row when nothing is left on it. `reread`: the line's words or hidden state changed,
// so search indexes the session again.
function writeMark(db: SqlDb, deps: Deps, sessionId: string, mark: LineMark, reread: boolean): void {
  const id = `${sessionId}:${mark.tStart}`;
  if (mark.text === null && !mark.hidden && mark.speaker === null && mark.highlights.length === 0) {
    db.run("DELETE FROM line_marks WHERE id = ?", [id]);
  } else {
    db.run(
      `INSERT INTO line_marks (id, session_id, t_start, text, hidden, speaker, highlights, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET text = excluded.text, hidden = excluded.hidden, speaker = excluded.speaker,
         highlights = excluded.highlights, updated_at = excluded.updated_at`,
      [id, sessionId, mark.tStart, mark.text, mark.hidden ? 1 : 0, mark.speaker, JSON.stringify(mark.highlights), deps.now()],
    );
  }
  if (reread) db.run("UPDATE sessions SET indexed_at = NULL WHERE id = ?", [sessionId]);
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

// Highlights are word positions in the shown text: spans that start past its last word are dropped, and the others end at
// its last word at most.
function fitSpans(spans: Span[], shown: string): Span[] {
  const last = wordsOf(shown).length - 1;
  return spans.filter(([from]) => from <= last).map(([from, to]): Span => [from, Math.min(to, last)]);
}

// The person's words for a line (Edit, note 12). The heard line in segments never changes. null, or the heard words,
// removes the edit, so Undo brings back what was heard. Clearing every word hides the line instead, so nothing is lost.
// Any edit that leaves words shows the line again. A line that is not in the transcript is left alone.
export function editLine(db: SqlDb, deps: Deps, sessionId: string, tStart: number, text: string | null): void {
  const heard = db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = ? AND source = 'device' AND t_start = ?", [sessionId, tStart]);
  if (heard === null) return;
  const mark = markAt(db, sessionId, tStart);
  const clean = text === null ? null : collapse(text).slice(0, LINE_TEXT_MAX_CHARS);
  if (clean === "") {
    // The stored words stay as they are; the line is hidden, so its highlights are checked against those words.
    writeMark(db, deps, sessionId, { ...mark, hidden: true, highlights: fitSpans(mark.highlights, mark.text ?? heard.text) }, true);
    return;
  }
  const edited = clean === null || clean === collapse(heard.text) ? null : clean;
  writeMark(db, deps, sessionId, { ...mark, text: edited, hidden: false, highlights: fitSpans(mark.highlights, edited ?? heard.text) }, true);
}

// Hides lines, or shows them again (S10). Only the person does this; nothing is hidden on its own.
export function setHidden(db: SqlDb, deps: Deps, sessionId: string, tStarts: number[], hidden: boolean): void {
  db.transaction(() => {
    let changed = false;
    for (const t of existingLines(db, sessionId, tStarts)) {
      const mark = markAt(db, sessionId, t);
      const next = { ...mark, hidden };
      if (sameMark(mark, next)) continue;
      writeMark(db, deps, sessionId, next, false);
      changed = true;
    }
    if (changed) db.run("UPDATE sessions SET indexed_at = NULL WHERE id = ?", [sessionId]);
  });
}

// A typed name with spaces collapsed, cut to 40 characters. null when it has no letter or digit.
export function cleanName(name: string): string | null {
  const clean = collapse(name).slice(0, SPEAKER_MAX_CHARS).trim();
  return /[\p{L}\p{N}]/u.test(clean) ? clean : null;
}

// Who said these lines (S14): a name, SEVERAL, or null to remove the name. A name with no letter or digit is ignored.
export function setSpeaker(db: SqlDb, deps: Deps, sessionId: string, tStarts: number[], speaker: string | null): void {
  const name = speaker === null || speaker === SEVERAL ? speaker : cleanName(speaker);
  if (speaker !== null && name === null) return;
  db.transaction(() => {
    for (const t of existingLines(db, sessionId, tStarts)) {
      const mark = markAt(db, sessionId, t);
      const next = { ...mark, speaker: name };
      if (!sameMark(mark, next)) writeMark(db, deps, sessionId, next, false);
    }
  });
}

export function speakerLabel(speaker: string): string {
  return speaker === SEVERAL ? "Several people" : speaker;
}

// The names used in a space, newest first: "Saved in <space>". Only names are kept, never anything about a voice.
export function speakerNames(db: SqlDb, spaceId: string): string[] {
  return db
    .all<{ name: string }>(
      `SELECT m.speaker AS name FROM line_marks m JOIN sessions s ON s.id = m.session_id
       WHERE s.space_id = ? AND m.speaker IS NOT NULL AND m.speaker <> ? GROUP BY m.speaker ORDER BY MAX(m.updated_at) DESC LIMIT 30`,
      [spaceId, SEVERAL],
    )
    .map((row) => row.name);
}

// "Until the next name": the chosen lines, then every line after the last of them, up to the next line that already has
// a name. `lines` must be sorted by tStart (the session's lines in time order).
export function linesToName(lines: { tStart: number; speaker: string | null }[], chosen: number[]): number[] {
  if (chosen.length === 0) return [];
  const last = Math.max(...chosen);
  const out = new Set(chosen);
  for (const line of lines) {
    if (line.tStart <= last) continue;
    if (line.speaker !== null) break;
    out.add(line.tStart);
  }
  return [...out].sort((a, b) => a - b);
}

// The run of lines around `at` that share its name, for changing a name from its label. Just `at` when it has no name.
export function speakerRun(lines: { tStart: number; speaker: string | null }[], at: number): number[] {
  const i = lines.findIndex((line) => line.tStart === at);
  const name = lines[i]?.speaker ?? null;
  if (i === -1 || name === null) return [at];
  let from = i;
  while (from > 0 && lines[from - 1]?.speaker === name) from -= 1;
  let to = i;
  while (to < lines.length - 1 && lines[to + 1]?.speaker === name) to += 1;
  return lines.slice(from, to + 1).map((line) => line.tStart);
}

// Spans stay sorted and merged: touching or overlapping spans become one.
export function addSpan(spans: Span[], add: Span): Span[] {
  return mergeSpans([...spans, add]);
}

export function removeSpan(spans: Span[], [from, to]: Span): Span[] {
  return spans.flatMap(([a, b]): Span[] => {
    if (b < from || a > to) return [[a, b]];
    const kept: Span[] = [];
    if (a < from) kept.push([a, from - 1]);
    if (b > to) kept.push([to + 1, b]);
    return kept;
  });
}

export function coversSpan(spans: Span[], [from, to]: Span): boolean {
  return spans.some(([a, b]) => a <= from && b >= to);
}

const isWhole = (n: number): boolean => Number.isInteger(n) && n >= 0;

// Highlight (note 11): the picked words are highlighted, or, when every one of them already is, the highlight is removed.
// Picks with a number that is not a whole number >= 0 are ignored, and reversed ones are put in order. Returns true when
// the picked words are highlighted now.
export function toggleHighlight(db: SqlDb, deps: Deps, sessionId: string, picks: LinePick[]): boolean {
  const usable = picks
    .filter((pick) => isWhole(pick.at) && isWhole(pick.from) && isWhole(pick.to))
    .map((pick): LinePick => ({ at: pick.at, from: Math.min(pick.from, pick.to), to: Math.max(pick.from, pick.to) }));
  if (usable.length === 0) return false;
  let highlighted = false;
  db.transaction(() => {
    const here = new Set(existingLines(db, sessionId, usable.map((pick) => pick.at)));
    // Picks grouped by line; each line's mark is read once, before any write, so every pick on it applies.
    const lines = new Map<number, { mark: LineMark; spans: Span[] }>();
    for (const pick of usable) {
      if (!here.has(pick.at)) continue;
      const line = lines.get(pick.at) ?? { mark: markAt(db, sessionId, pick.at), spans: [] };
      line.spans.push([pick.from, pick.to]);
      lines.set(pick.at, line);
    }
    if (lines.size === 0) return;
    const remove = [...lines.values()].every(({ mark, spans }) => spans.every((span) => coversSpan(mark.highlights, span)));
    for (const { mark, spans } of lines.values()) {
      let highlights = mark.highlights;
      for (const span of spans) highlights = remove ? removeSpan(highlights, span) : addSpan(highlights, span);
      const next = { ...mark, highlights };
      if (!sameMark(mark, next)) writeMark(db, deps, sessionId, next, false);
    }
    highlighted = !remove;
  });
  return highlighted;
}
