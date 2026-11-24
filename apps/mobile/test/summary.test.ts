import { beforeEach, describe, expect, it } from "vitest";
import { nameRecording, saveSegment, startRecordingSession } from "../src/core/capture/recording.ts";
import { renameSession, getSession } from "../src/core/capture/sessions.ts";
import { startPagesSession } from "../src/core/capture/pages.ts";
import {
  applySummary,
  cleanSummary,
  editSummary,
  getSummary,
  needsSummary,
  staleSummary,
  SUMMARY_EDIT_MAX_CHARS,
  summarizeUnits,
  type SummaryPort,
} from "../src/core/capture/summary.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import type { Unit } from "../src/core/study/generate.ts";
import { createMemoryDb } from "./helpers/db.ts";

const startedAt = new Date(2026, 10, 20, 16, 5).getTime();

describe("summary store", () => {
  let db: SqlDb;
  let ids: number;
  let spaceId: string;
  const deps = { now: () => startedAt, newId: () => `s-${++ids}` };

  beforeEach(() => {
    db = createMemoryDb();
    migrate(db);
    ids = 0;
    spaceId = ensureDefaultSpace(db, deps).id;
  });

  function recording(words: string | null): string {
    const session = startRecordingSession(db, deps, spaceId, true);
    if (words !== null) saveSegment(db, session.id, { tStart: 0, tEnd: 1000, text: words });
    return session.id;
  }

  function finish(id: string, transcript = "done"): void {
    db.run("UPDATE sessions SET state = 'saved', transcript = ?, ended_at = ? WHERE id = ?", [transcript, startedAt + 1000, id]);
  }

  it("a new session has no summary, the app writes it, and the title is not the app's", () => {
    const row = startRecordingSession(db, deps, spaceId, true);
    expect(getSummary(db, row.id)).toEqual({ summary: null, summaryAuto: true, titleAuto: false });
  });

  it("applySummary replaces the title of a session named by nameRecording, and sets the summary", () => {
    const id = recording("Welcome to biology");
    nameRecording(db, id);
    applySummary(db, id, { title: "Cell parts", summary: "Cells have parts." });
    expect(getSession(db, id)?.title).toBe("Cell parts");
    expect(getSummary(db, id)?.summary).toBe("Cells have parts.");
  });

  it("after renameSession, applySummary keeps the typed title but still writes the summary", () => {
    const id = recording("Welcome to biology");
    renameSession(db, id, "Bio class");
    applySummary(db, id, { title: "Cell parts", summary: "Cells have parts." });
    expect(getSession(db, id)?.title).toBe("Bio class");
    expect(getSummary(db, id)).toEqual({ summary: "Cells have parts.", summaryAuto: true, titleAuto: false });
  });

  it("after editSummary, applySummary keeps the edited summary, and the title is still replaced when it is the app's", () => {
    const id = recording("Welcome to biology");
    nameRecording(db, id);
    editSummary(db, id, "My own words");
    applySummary(db, id, { title: "Cell parts", summary: "Cells have parts." });
    expect(getSummary(db, id)).toEqual({ summary: "My own words", summaryAuto: false, titleAuto: true });
    expect(getSession(db, id)?.title).toBe("Cell parts");
  });

  it("applySummary when both are the person's leaves no dirty row in a synced space", () => {
    const id = recording("Welcome to biology");
    db.run("INSERT INTO groups (id, kind, role, key_version, updated_at) VALUES ('g1', 'personal', 'owner', 1, 0)");
    db.run("INSERT INTO space_groups (space_id, group_id) VALUES (?, 'g1')", [spaceId]);
    renameSession(db, id, "Bio class");
    editSummary(db, id, "My words");
    db.run("DELETE FROM dirty");
    applySummary(db, id, { title: "Cell parts", summary: "Cells have parts." });
    expect(db.all("SELECT 1 FROM dirty")).toHaveLength(0);
    expect(getSession(db, id)?.title).toBe("Bio class");
    expect(getSummary(db, id)?.summary).toBe("My words");
  });

  it("editSummary trims, cuts to 2,000 characters, and does nothing for blank text", () => {
    const id = recording("Welcome");
    editSummary(db, id, "  Kept  ");
    expect(getSummary(db, id)?.summary).toBe("Kept");
    editSummary(db, id, "x".repeat(SUMMARY_EDIT_MAX_CHARS + 50));
    expect(getSummary(db, id)?.summary).toBe("x".repeat(SUMMARY_EDIT_MAX_CHARS));
    editSummary(db, id, "  ");
    expect(getSummary(db, id)?.summary).toBe("x".repeat(SUMMARY_EDIT_MAX_CHARS));
  });

  it("staleSummary clears an app summary and keeps an edited one", () => {
    const app = recording("Welcome");
    applySummary(db, app, { title: "T", summary: "App words" });
    staleSummary(db, app);
    expect(getSummary(db, app)?.summary).toBeNull();

    const edited = recording("Hello");
    editSummary(db, edited, "Mine");
    staleSummary(db, edited);
    expect(getSummary(db, edited)?.summary).toBe("Mine");
  });

  it("needsSummary is true only for a finished recording with words and no summary yet", () => {
    const id = recording("Cells have membranes");
    expect(needsSummary(db, id)).toBe(false);
    finish(id, "waiting");
    expect(needsSummary(db, id)).toBe(false);
    finish(id, "done");
    expect(needsSummary(db, id)).toBe(true);
    applySummary(db, id, { title: "T", summary: "S" });
    expect(needsSummary(db, id)).toBe(false);
  });

  it("needsSummary is false for a pages session, a session with no words, blank words, or after editSummary", () => {
    const pages = startPagesSession(db, deps, spaceId, "Pages").id;
    saveSegment(db, pages, { tStart: 0, tEnd: 1000, text: "Words" });
    finish(pages);
    expect(needsSummary(db, pages)).toBe(false);

    const none = recording(null);
    finish(none);
    expect(needsSummary(db, none)).toBe(false);

    const blank = recording("   ");
    finish(blank);
    expect(needsSummary(db, blank)).toBe(false);

    const edited = recording("Words here");
    finish(edited);
    editSummary(db, edited, "Mine");
    expect(needsSummary(db, edited)).toBe(false);
  });
});

describe("cleanSummary", () => {
  it("keeps a structured reply as it is", () => {
    expect(cleanSummary({ title: "Cell parts", summary: "Cells have parts." })).toEqual({ title: "Cell parts", summary: "Cells have parts." });
  });

  it("reads a plain-text reply", () => {
    expect(cleanSummary({ plainText: "TITLE: Cell parts\nSUMMARY: Cells have\nparts." })?.summary).toBe("Cells have parts.");
  });

  it("removes bold markers and quotes from the title", () => {
    expect(cleanSummary({ plainText: '**TITLE:** "Cell parts."\n**SUMMARY:** Cells.' })?.title).toBe("Cell parts");
  });

  it("cuts a long title to at most 60 characters at a word boundary", () => {
    const title = "word ".repeat(18).trim();
    const made = cleanSummary({ title, summary: "S" });
    expect(made?.title.length).toBeLessThanOrEqual(60);
    expect(made?.title.endsWith(" ")).toBe(false);
    expect(title.startsWith(made?.title ?? "")).toBe(true);
  });

  it("cuts a long summary to at most 600 characters, ending with an ellipsis", () => {
    const made = cleanSummary({ title: "Cell parts", summary: "sentence one. ".repeat(60) });
    expect(made?.summary.length).toBeLessThanOrEqual(600);
    expect(made?.summary.endsWith("…")).toBe(true);
  });

  it("gives null when the title or the summary is empty, or the reply is unusable", () => {
    for (const raw of [{ title: "", summary: "S" }, { title: "T", summary: "" }, null, [], { plainText: "nothing" }]) {
      expect(cleanSummary(raw)).toBeNull();
    }
  });
});

describe("summarizeUnits", () => {
  function fakePort(contextSize: number, reply: (text: string) => unknown = () => ({ title: "Cell parts", summary: "S" })) {
    const calls: string[] = [];
    const port: SummaryPort = {
      contextSize: () => contextSize,
      summarize: async (text) => {
        calls.push(text);
        return reply(text);
      },
    };
    return { port, calls };
  }
  const unit = (text: string): Unit => ({ text, captureId: null, t: null });

  it("one short unit is one call", async () => {
    const { port, calls } = fakePort(4096);
    expect(await summarizeUnits(port, [unit("Cells have membranes.")])).toEqual({ title: "Cell parts", summary: "S" });
    expect(calls).toHaveLength(1);
  });

  it("no units, and only blank units, give null with no call", async () => {
    const { port, calls } = fakePort(4096);
    expect(await summarizeUnits(port, [])).toBeNull();
    expect(await summarizeUnits(port, [unit("  "), unit("")])).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("long text is summarized in pieces, then the summaries are summarized", async () => {
    const { port, calls } = fakePort(600);
    const long = "a".repeat(1200);
    const result = await summarizeUnits(port, [unit(long), unit(long), unit(long)]);
    expect(calls).toHaveLength(4);
    expect(result).toEqual({ title: "Cell parts", summary: "S" });
  });

  it("gives null when every reply is unusable", async () => {
    const { port } = fakePort(4096, () => ({ title: "", summary: "" }));
    expect(await summarizeUnits(port, [unit("Words")])).toBeNull();
  });

  it("throws a model error", async () => {
    const { port } = fakePort(4096, () => {
      throw { code: "unsupported_language" };
    });
    await expect(summarizeUnits(port, [unit("Words")])).rejects.toEqual({ code: "unsupported_language" });
  });
});

describe("summary review fixes", () => {
  let db: SqlDb;
  let ids: number;
  let spaceId: string;
  const deps = { now: () => startedAt, newId: () => `r-${++ids}` };

  beforeEach(() => {
    db = createMemoryDb();
    migrate(db);
    ids = 0;
    spaceId = ensureDefaultSpace(db, deps).id;
  });

  it("applySummary does not overwrite a summary that already exists (one synced from another phone)", () => {
    const session = startRecordingSession(db, deps, spaceId, true);
    saveSegment(db, session.id, { tStart: 0, tEnd: 1000, text: "Welcome to biology" });
    db.run("UPDATE sessions SET state = 'saved', transcript = 'done', ended_at = ? WHERE id = ?", [startedAt + 1000, session.id]);
    nameRecording(db, session.id);
    db.run("UPDATE sessions SET summary = 'Written on the other phone.' WHERE id = ?", [session.id]);
    applySummary(db, session.id, { title: "Cell parts", summary: "Cells have parts." });
    expect(getSummary(db, session.id)?.summary).toBe("Written on the other phone.");
    expect(getSession(db, session.id)?.title).toBe("Cell parts");
  });

  it("summarizeUnits halves a chunk that is too long and makes the summary from the halves", async () => {
    const units: Unit[] = [
      { text: "Alpha cells", captureId: null, t: null },
      { text: "Beta organs", captureId: null, t: null },
    ];
    const asked: string[] = [];
    const port: SummaryPort = {
      contextSize: () => 4096,
      summarize: async (text: string) => {
        asked.push(text);
        if (text.includes("Alpha") && text.includes("Beta")) throw Object.assign(new Error("long"), { code: "context_too_long" });
        return { title: "Cells", summary: text };
      },
    };
    const made = await summarizeUnits(port, units);
    expect(asked).toContain("Alpha cells");
    expect(asked).toContain("Beta organs");
    expect(made?.summary).toContain("Alpha");
  });
});
