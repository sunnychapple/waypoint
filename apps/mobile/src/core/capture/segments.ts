import type { SqlDb } from "../db/sql.ts";

export type SegmentLine = { tStart: number; tEnd: number; text: string };

// The on-device transcript of a session, in time order.
export function listSegments(db: SqlDb, sessionId: string): SegmentLine[] {
  return db.all<SegmentLine>(
    "SELECT t_start AS tStart, t_end AS tEnd, text FROM segments WHERE session_id = ? AND source = 'device' ORDER BY t_start",
    [sessionId],
  );
}
