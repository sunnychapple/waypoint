import type { RetranscribeResult } from "@waypoint/contracts";
import type { SqlDb } from "../db/sql.ts";

// A recording part as the second transcript uploads it: chunk n is the n-th audio capture in position order.
export type UploadPart = { n: number; file: string; startMs: number; durationMs: number };

export function uploadParts(db: SqlDb, sessionId: string): UploadPart[] {
  return db
    .all<{ file: string; t: number; duration_ms: number | null }>(
      "SELECT file, t, duration_ms FROM captures WHERE session_id = ? AND kind = 'audio' ORDER BY t, position, id",
      [sessionId],
    )
    .map((row, n) => ({ n, file: row.file, startMs: row.t, durationMs: row.duration_ms ?? 0 }));
}

// The quote's minutes: every started minute of audio, at least 1 (the server settles per started minute, PR 23).
export function audioMinutes(parts: UploadPart[]): number {
  const ms = parts.reduce((sum, p) => sum + Math.max(0, p.durationMs), 0);
  return Math.max(1, Math.ceil(ms / 60_000));
}

// Replaces the session's cloud segments with the job's result. Whisper's times are seconds from the start of each
// chunk; the part's own start is added. Returns how many segments were written.
export function saveCloudTranscript(db: SqlDb, sessionId: string, parts: UploadPart[], result: RetranscribeResult): number {
  const start = new Map(parts.map((p) => [p.n, p.startMs]));
  const rows: { tStart: number; tEnd: number; text: string }[] = [];
  for (const chunk of result.chunks) {
    const base = start.get(chunk.n);
    if (base === undefined) continue;
    const pieces = chunk.segments.length > 0 ? chunk.segments : [{ start: 0, end: chunk.duration ?? 0, text: chunk.text }];
    for (const s of pieces) {
      const text = s.text.trim();
      if (text === "") continue;
      const tStart = base + Math.round(s.start * 1000);
      rows.push({ tStart, tEnd: Math.max(tStart, base + Math.round(s.end * 1000)), text });
    }
  }
  db.transaction(() => {
    db.run("DELETE FROM segments WHERE session_id = ? AND source = 'cloud'", [sessionId]);
    for (const r of rows) {
      db.run("INSERT OR IGNORE INTO segments (session_id, t_start, t_end, text, source) VALUES (?, ?, ?, ?, 'cloud')", [sessionId, r.tStart, r.tEnd, r.text]);
    }
  });
  return rows.length;
}

export type DiffWord = { text: string; changed: boolean };
export const MAX_DIFF_CELLS = 4_000_000;

// Lowercase letters and digits only, so "Mitochondria," and "mitochondria" are the same word.
function key(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "");
}

// The cloud words with the ones that differ from the device's marked, from a longest common subsequence of word
// keys. O(a·b) memory, so callers diff one recording part (about 750 words) at a time. Counts above 65,535 cannot
// happen below MAX_DIFF_CELLS.
export function diffWords(device: string, cloud: string): DiffWord[] {
  const a = device.split(/\s+/).filter((w) => w !== "");
  const b = cloud.split(/\s+/).filter((w) => w !== "");
  const ka = a.map(key);
  const kb = b.map(key);
  // Too big to compare in memory (a part far longer than 5 minutes): show the cloud words unmarked.
  if ((ka.length + 1) * (kb.length + 1) > MAX_DIFF_CELLS) return b.map((text) => ({ text, changed: false }));
  const width = kb.length + 1;
  const lcs = new Uint16Array((ka.length + 1) * width);
  for (let i = ka.length - 1; i >= 0; i--) {
    for (let j = kb.length - 1; j >= 0; j--) {
      lcs[i * width + j] = ka[i] === kb[j] ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }
  const out: DiffWord[] = [];
  let i = 0;
  let j = 0;
  while (j < kb.length) {
    if (i < ka.length && ka[i] === kb[j]) {
      out.push({ text: b[j] ?? "", changed: false });
      i++;
      j++;
    } else if (i < ka.length && (lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
      i++;
    } else {
      out.push({ text: b[j] ?? "", changed: true });
      j++;
    }
  }
  return out;
}

// Both transcripts of one part: the segments that start inside [startMs, startMs + durationMs).
export function partText(db: SqlDb, sessionId: string, source: "device" | "cloud", part: { startMs: number; durationMs: number }): string {
  return db
    .all<{ text: string }>(
      "SELECT text FROM segments WHERE session_id = ? AND source = ? AND t_start >= ? AND t_start < ? ORDER BY t_start",
      [sessionId, source, part.startMs, part.startMs + Math.max(1, part.durationMs)],
    )
    .map((r) => r.text)
    .join(" ");
}

// Settings key: "1" when every new recording should be offered a second transcript right after it is saved.
export const SECOND_ALWAYS_KEY = "second_transcript_always";
