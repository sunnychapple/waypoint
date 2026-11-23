import type { Piece } from "./transcript.ts";

export type TimelineItem =
  | { kind: "line"; key: string; at: number; end: number; text: string }
  | { kind: "gap"; key: string; at: number; gapMs: number }
  | { kind: "flag"; key: string; at: number }
  | { kind: "photo"; key: string; at: number; file: string };

export type PartSpan = { index: number; startMs: number; durationMs: number };

const GAP_MIN_MS = 1000;

// Finals, gaps, flags and photos, in time order. All times are ms since the session started.
// A gap is drawn as soon as recording resumes: from the end of the last part that started before the resume
// to the resume time. Parts close (and are reported) on pause, so that part is known by then.
export function buildTimeline(
  finals: Piece[],
  parts: PartSpan[],
  resumes: number[],
  flags: number[],
  photos: { id: string; t: number; file: string }[],
): TimelineItem[] {
  const items: TimelineItem[] = finals.map((piece) => ({ kind: "line", key: `line-${piece.tStart}`, at: piece.tStart, end: piece.tEnd, text: piece.text }));
  for (const resumedAt of resumes) {
    const before = parts.filter((part) => part.startMs < resumedAt).at(-1);
    if (before === undefined) continue;
    const gapStart = before.startMs + before.durationMs;
    const gapMs = resumedAt - gapStart;
    if (gapMs >= GAP_MIN_MS) items.push({ kind: "gap", key: `gap-${resumedAt}`, at: gapStart, gapMs });
  }
  flags.forEach((t, i) => items.push({ kind: "flag", key: `flag-${i}`, at: t }));
  photos.forEach((p) => items.push({ kind: "photo", key: `photo-${p.id}`, at: p.t, file: p.file }));
  return items.sort((a, b) => a.at - b.at);
}

export type TimelineLine = Extract<TimelineItem, { kind: "line" }>;
export type TimelineRow = { kind: "paragraph"; key: string; at: number; lines: TimelineLine[] } | Exclude<TimelineItem, { kind: "line" }>;

export const PARAGRAPH_PAUSE_MS = 3000;
const PARAGRAPH_MAX_MS = 30_000;

// Lines said close together become one paragraph, shown with one time. A pause of 3 seconds, 30 seconds of speech, or a
// gap, flag or photo starts a new one. Every line keeps its own time, so a tapped word still knows when it was said.
export function groupTimeline(items: TimelineItem[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const item of items) {
    if (item.kind !== "line") {
      rows.push(item);
      continue;
    }
    const last = rows.at(-1);
    const previous = last?.kind === "paragraph" ? last.lines.at(-1) : undefined;
    if (last?.kind === "paragraph" && previous !== undefined && item.at - previous.end < PARAGRAPH_PAUSE_MS && item.end - last.at <= PARAGRAPH_MAX_MS) {
      last.lines.push(item);
    } else {
      rows.push({ kind: "paragraph", key: item.key, at: item.at, lines: [item] });
    }
  }
  return rows;
}
