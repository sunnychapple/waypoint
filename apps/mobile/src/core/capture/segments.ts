import type { SqlDb } from "../db/sql.ts";

export type SegmentLine = { tStart: number; tEnd: number; text: string };

// The on-device transcript of a session, in time order.
export function listSegments(db: SqlDb, sessionId: string): SegmentLine[] {
  return db.all<SegmentLine>(
    "SELECT t_start AS tStart, t_end AS tEnd, text FROM segments WHERE session_id = ? AND source = 'device' ORDER BY t_start",
    [sessionId],
  );
}

// The transcript as the person keeps it (Next 1): their words in place of what was heard, with hidden lines and lines
// left empty taken out. Everything that reads the transcript to make or send something uses this: flashcards, quizzes,
// search, share links, Explain's excerpt and the cloud tasks.
export function studyLines(db: SqlDb, sessionId: string): SegmentLine[] {
  return db
    .all<SegmentLine>(
      `SELECT s.t_start AS tStart, s.t_end AS tEnd, COALESCE(m.text, s.text) AS text
       FROM segments s LEFT JOIN line_marks m ON m.session_id = s.session_id AND m.t_start = s.t_start
       WHERE s.session_id = ? AND s.source = 'device' AND COALESCE(m.hidden, 0) = 0 ORDER BY s.t_start`,
      [sessionId],
    )
    .filter((line) => line.text.trim() !== "");
}

// A flag is tapped just after something is heard, so the moment often falls in the pause after the line (D9 notes: the
// flag keeps about 10 s around it). Lines this close before the moment count.
export const LINE_LOOKBACK_MS = 10_000;

// The transcript line a moment falls in (tStart <= t <= tEnd) that has text; else the latest such line that ended no more
// than LINE_LOOKBACK_MS before it; null when there is none.
export function lineAt(segments: SegmentLine[], t: number): SegmentLine | null {
  const lines = segments.filter((s) => s.text.trim() !== "");
  const inside = lines.find((s) => s.tStart <= t && t <= s.tEnd);
  if (inside !== undefined) return inside;
  const before = lines.filter((s) => s.tEnd < t && t - s.tEnd <= LINE_LOOKBACK_MS).sort((a, b) => b.tEnd - a.tEnd);
  return before[0] ?? null;
}
