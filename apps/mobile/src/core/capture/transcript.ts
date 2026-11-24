export type Piece = { tStart: number; tEnd: number; text: string; isFinal: boolean };
export type LiveTranscript = { finals: Piece[]; volatile: Piece | null };
export const EMPTY_LIVE: LiveTranscript = { finals: [], volatile: null };

// A final replaces the volatile and is appended (ignored if a final with the same tStart is already there).
// A volatile replaces the previous volatile. Finals stay sorted by tStart.
export function addPiece(live: LiveTranscript, piece: Piece): LiveTranscript {
  if (!piece.isFinal) return { finals: live.finals, volatile: piece };
  if (live.finals.some((f) => f.tStart === piece.tStart)) return live;
  const finals = [...live.finals, piece].sort((a, b) => a.tStart - b.tStart);
  return { finals, volatile: null };
}

export type PartSpan = { startMs: number; durationMs: number };
export type SegmentSpan = { tStart: number; tEnd: number };

// How much of start..end the segments cover, counting overlapping segments once.
function coveredMs(start: number, end: number, segments: SegmentSpan[]): number {
  const spans = segments
    .filter((s) => s.tStart < end && s.tEnd > start)
    .map((s) => ({ from: Math.max(s.tStart, start), to: Math.min(s.tEnd, end) }))
    .sort((a, b) => a.from - b.from);
  let covered = 0;
  let cursor = start;
  for (const span of spans) {
    if (span.to <= cursor) continue;
    covered += span.to - Math.max(span.from, cursor);
    cursor = span.to;
  }
  return covered;
}

// The longest stretch of the part that no segment covers.
function longestHole(part: PartSpan, segments: SegmentSpan[]): number {
  const end = part.startMs + part.durationMs;
  const spans = segments.filter((s) => s.tStart < end && s.tEnd > part.startMs).sort((a, b) => a.tStart - b.tStart);
  let longest = 0;
  let cursor = part.startMs;
  for (const span of spans) {
    longest = Math.max(longest, span.tStart - cursor);
    cursor = Math.max(cursor, span.tEnd);
  }
  return Math.max(longest, end - cursor);
}

// Parts at least `minMs` long with a stretch of at least `minMs` that no segment covers, so they need transcribeFile.
export function partsNeedingTranscription(parts: PartSpan[], segments: SegmentSpan[], minMs = 10_000): PartSpan[] {
  return parts.filter((part) => part.durationMs >= minMs && longestHole(part, segments) >= minMs);
}

// The pieces of a re-transcribed part that fill a hole: those with less than half their time already written down.
export function piecesToKeep<T extends SegmentSpan>(pieces: T[], existing: SegmentSpan[]): T[] {
  return pieces.filter((piece) => {
    const length = piece.tEnd - piece.tStart;
    if (length <= 0) return !existing.some((s) => s.tStart <= piece.tStart && s.tEnd >= piece.tEnd);
    return coveredMs(piece.tStart, piece.tEnd, existing) * 2 < length;
  });
}

// What to write for a re-transcribed part, in place of its own segments: those that start and end inside it. A segment
// that starts in the part and runs on into the next one is kept, because the next part may not be redone. The second pass
// splits sentences differently, so merging the two would repeat or lose words at each edge. Pieces that mostly repeat a
// segment kept around the part are left out. Null unless the second pass writes down at least `minGainMs` more of the part.
export function replacementFor<T extends SegmentSpan>(part: PartSpan, pieces: T[], existing: SegmentSpan[], minGainMs = 2_000): T[] | null {
  const end = part.startMs + part.durationMs;
  const own = existing.filter((s) => s.tStart >= part.startMs && s.tStart < end && s.tEnd <= end);
  const kept = existing.filter((s) => !own.includes(s));
  const fresh = piecesToKeep(pieces, kept);
  return coveredMs(part.startMs, end, [...fresh, ...kept]) >= coveredMs(part.startMs, end, [...own, ...kept]) + minGainMs ? fresh : null;
}
