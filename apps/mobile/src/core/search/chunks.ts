export type ChunkDraft = { source: "transcript" | "page" | "photo"; captureId: string | null; tStart: number; tEnd: number; text: string };
export const CHUNK_WORDS = 120;

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

// Whole segments are added to the current chunk until it would pass CHUNK_WORDS words.
// A segment longer than that limit becomes a chunk of its own.
export function chunkTranscript(segments: { tStart: number; tEnd: number; text: string }[]): ChunkDraft[] {
  const ordered = segments
    .filter((segment) => segment.text.trim().length > 0)
    .sort((a, b) => a.tStart - b.tStart);
  const chunks: ChunkDraft[] = [];
  let current: ChunkDraft | null = null;
  let words = 0;
  for (const segment of ordered) {
    const text = segment.text.trim();
    const n = wordCount(text);
    if (current && words + n > CHUNK_WORDS) {
      chunks.push(current);
      current = null;
      words = 0;
    }
    if (current) {
      current.text += ` ${text}`;
      current.tEnd = segment.tEnd;
    } else {
      current = { source: "transcript", captureId: null, tStart: segment.tStart, tEnd: segment.tEnd, text };
    }
    words += n;
  }
  if (current) chunks.push(current);
  return chunks;
}

// Paragraphs (split at blank lines) are packed the same way; a paragraph over the limit is split by words.
export function chunkCapture(capture: { id: string; kind: "page" | "photo"; t: number; text: string }): ChunkDraft[] {
  const pieces: string[] = [];
  for (const paragraph of capture.text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0)) {
    const words = paragraph.split(/\s+/);
    if (words.length <= CHUNK_WORDS) pieces.push(paragraph);
    else for (let i = 0; i < words.length; i += CHUNK_WORDS) pieces.push(words.slice(i, i + CHUNK_WORDS).join(" "));
  }
  const chunks: ChunkDraft[] = [];
  let parts: string[] = [];
  let words = 0;
  const flush = (): void => {
    if (parts.length === 0) return;
    chunks.push({ source: capture.kind, captureId: capture.id, tStart: capture.t, tEnd: capture.t, text: parts.join("\n\n") });
    parts = [];
    words = 0;
  };
  for (const piece of pieces) {
    const n = wordCount(piece);
    if (words + n > CHUNK_WORDS) flush();
    parts.push(piece);
    words += n;
  }
  flush();
  return chunks;
}
