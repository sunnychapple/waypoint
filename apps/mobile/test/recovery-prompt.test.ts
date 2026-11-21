import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import {
  RECOVERY_REMINDER_MS,
  clearRecoveryPromptShown,
  finishedSessionCount,
  markRecoveryPromptShown,
  recoveryPromptShownAt,
  shouldPromptRecovery,
} from "../src/core/device/recoveryPrompt.ts";
import { createMemoryDb } from "./helpers/db.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = 100 * DAY;

describe("shouldPromptRecovery", () => {
  it("first launch with no sessions does not prompt", () => {
    expect(shouldPromptRecovery({ saved: false, sessionCount: 0, lastShownAt: null, now })).toBe(false);
  });
  it("one session and never shown prompts", () => {
    expect(shouldPromptRecovery({ saved: false, sessionCount: 1, lastShownAt: null, now })).toBe(true);
  });
  it("shown 2 days ago does not prompt", () => {
    expect(shouldPromptRecovery({ saved: false, sessionCount: 3, lastShownAt: now - 2 * DAY, now })).toBe(false);
  });
  it("shown 8 days ago prompts", () => {
    expect(shouldPromptRecovery({ saved: false, sessionCount: 3, lastShownAt: now - 8 * DAY, now })).toBe(true);
  });
  it("exactly 7 days after the last push prompts again", () => {
    expect(shouldPromptRecovery({ saved: false, sessionCount: 1, lastShownAt: now - RECOVERY_REMINDER_MS, now })).toBe(true);
    expect(shouldPromptRecovery({ saved: false, sessionCount: 1, lastShownAt: now - RECOVERY_REMINDER_MS + 1, now })).toBe(false);
  });
  it("saved never prompts, whatever else is true", () => {
    expect(shouldPromptRecovery({ saved: true, sessionCount: 5, lastShownAt: null, now })).toBe(false);
    expect(shouldPromptRecovery({ saved: true, sessionCount: 5, lastShownAt: now - 30 * DAY, now })).toBe(false);
  });
});

describe("recovery prompt storage", () => {
  let db: SqlDb;
  beforeEach(() => {
    db = createMemoryDb();
    migrate(db);
  });

  it("counts finished sessions only, recordings and pages alike", () => {
    const space = ensureDefaultSpace(db, { now: () => 1, newId: () => "space-1" });
    const insert = (id: string, kind: string, state: string) =>
      db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES (?, ?, ?, 't', ?, 1)", [id, space.id, kind, state]);
    expect(finishedSessionCount(db)).toBe(0);
    insert("a", "recording", "recording");
    expect(finishedSessionCount(db)).toBe(0);
    insert("b", "recording", "saved");
    insert("c", "pages", "saved");
    insert("d", "pages", "interrupted");
    expect(finishedSessionCount(db)).toBe(3);
  });

  it("keeps the last time the prompt was pushed", () => {
    expect(recoveryPromptShownAt(db)).toBeNull();
    markRecoveryPromptShown(db, now);
    expect(recoveryPromptShownAt(db)).toBe(now);
  });

  it("forgets the last push once the words are saved", () => {
    markRecoveryPromptShown(db, now);
    clearRecoveryPromptShown(db);
    expect(recoveryPromptShownAt(db)).toBeNull();
  });
});
