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

// Parts at least `minMs` long that no segment overlaps, so they need transcribeFile.
// A segment overlaps when tStart < part end and tEnd > part start.
export function partsNeedingTranscription(parts: PartSpan[], segments: SegmentSpan[], minMs = 10_000): PartSpan[] {
  return parts.filter((part) => {
    if (part.durationMs < minMs) return false;
    const end = part.startMs + part.durationMs;
    return !segments.some((s) => s.tStart < end && s.tEnd > part.startMs);
  });
}
