import { shortDay } from "../format.ts";
const DAY_MS = 86_400_000;
const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Whole days since 1970-01-01 in the given offset from UTC (minutes).
function localDay(ms: number, timeZoneOffsetMin: number): number {
  return Math.floor((ms + timeZoneOffsetMin * 60_000) / DAY_MS);
}

// "Used today" or "Used yesterday" by calendar day in the given offset; null for older or future times.
export function usedLabel(lastUsedAt: number, now: number, timeZoneOffsetMin: number): string | null {
  const days = localDay(now, timeZoneOffsetMin) - localDay(lastUsedAt, timeZoneOffsetMin);
  if (days === 0) return "Used today";
  if (days === 1) return "Used yesterday";
  return null;
}

// "Today", "Yesterday", or the short day, by calendar day in the given offset.
export function dayLabel(ms: number, now: number, timeZoneOffsetMin: number): string {
  const days = localDay(now, timeZoneOffsetMin) - localDay(ms, timeZoneOffsetMin);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return shortDay(ms);
}

export function sessionsLabel(n: number): string {
  return n === 1 ? "1 session" : `${n} sessions`;
}

export function greeting(hour: number): string {
  if (hour >= 5 && hour <= 11) return "Good morning";
  if (hour >= 12 && hour <= 17) return "Good afternoon";
  return "Good evening";
}

// "THURSDAY, NOV 19" for the day that ms falls on in the given offset.
export function dateLine(ms: number, timeZoneOffsetMin: number): string {
  const local = new Date(ms + timeZoneOffsetMin * 60_000);
  return `${WEEKDAYS[local.getUTCDay()]}, ${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`;
}
