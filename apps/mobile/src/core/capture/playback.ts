// A recording plays as its audio parts in order (open question 54). startMs is where a part starts on the session's
// clock, the clock the transcript's times use; durationMs is 0 when it was never measured.
export type PlayPart = { startMs: number; durationMs: number };

// Where session time `ms` is in the parts: the part that holds it and how far into it. A time before the first part or
// in a gap between parts (a pause) goes to the start of the next part; a time after the end, to the end of the last.
// A part of unknown length runs until the next part starts. null when there are no parts.
export function partAt(parts: readonly PlayPart[], ms: number): { index: number; offsetMs: number } | null {
  for (const [index, part] of parts.entries()) {
    if (ms < part.startMs) return { index, offsetMs: 0 };
    const end = part.durationMs > 0 ? part.startMs + part.durationMs : (parts[index + 1]?.startMs ?? Number.POSITIVE_INFINITY);
    if (ms < end) return { index, offsetMs: ms - part.startMs };
  }
  const last = parts.length - 1;
  const part = parts[last];
  return part === undefined ? null : { index: last, offsetMs: part.durationMs };
}
