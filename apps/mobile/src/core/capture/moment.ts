// The index of the transcript line a search hit at `t` (ms from the session start) lands on: the latest line that
// starts at or before t, else the first line after it. Returns -1 when there are no lines.
export function nearestSegmentIndex(starts: number[], t: number): number {
  let before = -1;
  let after = -1;
  starts.forEach((start, i) => {
    if (start <= t) {
      if (before === -1 || start > starts[before]!) before = i;
    } else if (after === -1 || start < starts[after]!) {
      after = i;
    }
  });
  return before !== -1 ? before : after;
}

// The `t` search parameter in milliseconds, or null when it is missing or not a non-negative number.
export function momentFromParam(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}
