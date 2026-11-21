import type { SqlDb } from "../db/sql.ts";

export type SegmentLine = { tStart: number; tEnd: number; text: string };

// The on-device transcript of a session, in time order.
export function listSegments(db: SqlDb, sessionId: string): SegmentLine[] {
  return db.all<SegmentLine>(
    "SELECT t_start AS tStart, t_end AS tEnd, text FROM segments WHERE session_id = ? AND source = 'device' ORDER BY t_start",
    [sessionId],
  );
}

// The transcript line a moment falls in (tStart <= t <= tEnd) that has text, in time order; null when there is none.
export function lineAt(segments: SegmentLine[], t: number): SegmentLine | null {
  return segments.find((s) => s.tStart <= t && t <= s.tEnd && s.text.trim() !== "") ?? null;
}
