import { deleteSetting, getSetting, setSetting } from "../db/settings.ts";
import type { SqlDb } from "../db/sql.ts";

// The reminder to write down the recovery words waits for the first finished session, and comes back at most once a
// week. The last time it was pushed is kept per person, in that person's notes (settings table).
export const RECOVERY_PROMPT_KEY = "recovery.prompt_shown_at";
export const RECOVERY_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

// Pure decision. `saved`: the words are already saved on the server. `lastShownAt`: ms when the prompt was last pushed,
// null when never. Never prompts once saved, with no saved session, or within 7 days of the last push.
export function shouldPromptRecovery(input: {
  saved: boolean;
  sessionCount: number;
  lastShownAt: number | null;
  now: number;
}): boolean {
  if (input.saved) return false;
  if (input.sessionCount < 1) return false;
  if (input.lastShownAt !== null && input.now - input.lastShownAt < RECOVERY_REMINDER_MS) return false;
  return true;
}

// Finished sessions (saved or interrupted), recordings and pages alike: the same rule as latestSession.
export function finishedSessionCount(db: SqlDb): number {
  return db.get<{ n: number }>("SELECT count(*) AS n FROM sessions WHERE state IN ('saved', 'interrupted')")?.n ?? 0;
}

export function recoveryPromptShownAt(db: SqlDb): number | null {
  const value = getSetting(db, RECOVERY_PROMPT_KEY);
  if (value === null) return null;
  const at = Number(value);
  return Number.isFinite(at) ? at : null;
}

export function markRecoveryPromptShown(db: SqlDb, now: number): void {
  setSetting(db, RECOVERY_PROMPT_KEY, String(now));
}

// The words are saved: forget the last push, so a removal that later deletes them prompts at once.
export function clearRecoveryPromptShown(db: SqlDb): void {
  deleteSetting(db, RECOVERY_PROMPT_KEY);
}
