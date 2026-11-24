import { studyLines } from "../capture/segments.ts";
import type { SqlDb } from "../db/sql.ts";
import type { Unit } from "./generate.ts";

const TRANSCRIPT_CHARS = 1200;

// The text the model reads for one session: each page with text in order, then the transcript in
// about-1,200-character units, then the text read from photos.
export function studyUnits(db: SqlDb, sessionId: string): Unit[] {
  const pages = db
    .all<{ id: string; found_text: string }>(
      "SELECT id, found_text FROM captures WHERE session_id = ? AND kind = 'page' AND found_text IS NOT NULL ORDER BY position, id",
      [sessionId],
    )
    .filter((row) => row.found_text.trim() !== "")
    .map((row) => ({ text: row.found_text.trim(), captureId: row.id, t: null }));
  const segments = studyLines(db, sessionId).map((line) => ({ t_start: line.tStart, text: line.text }));
  const photos = db
    .all<{ id: string; t: number; found_text: string }>(
      "SELECT id, t, found_text FROM captures WHERE session_id = ? AND kind = 'photo' AND found_text IS NOT NULL ORDER BY t, id",
      [sessionId],
    )
    .filter((row) => row.found_text.trim() !== "")
    .map((row) => ({ text: row.found_text.trim(), captureId: row.id, t: row.t }));
  return [...pages, ...groupTranscript(segments), ...photos];
}

// Consecutive segments join into one unit while it stays within about 1,200 characters. Each unit starts at its first segment.
function groupTranscript(segments: { t_start: number; text: string }[]): Unit[] {
  const units: Unit[] = [];
  let current: { t: number; text: string } | null = null;
  for (const segment of segments) {
    const piece = segment.text.trim();
    if (piece === "") continue;
    if (current !== null && current.text.length + 1 + piece.length > TRANSCRIPT_CHARS) {
      units.push({ text: current.text, captureId: null, t: current.t });
      current = null;
    }
    current = current === null ? { t: segment.t_start, text: piece } : { t: current.t, text: `${current.text} ${piece}` };
  }
  if (current !== null) units.push({ text: current.text, captureId: null, t: current.t });
  return units;
}
