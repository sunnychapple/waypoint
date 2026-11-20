import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { getOverview, lineAt, overviewsToRender, saveOverview, scriptLines, setRendered, setRendering } from "../src/core/overviews/overviews.ts";
import { createMemoryDb } from "./helpers/db.ts";

const AUDIO = { v: 1, title: "Cells", lines: [{ host: "A", text: "Hi" }, { host: "B", text: "Hello" }, { host: "A", text: "Cells" }, { host: "B", text: "Yes" }] };
const VIDEO = { v: 1, title: "Cells", slides: [1, 2, 3].map((n) => ({ heading: `S${n}`, bullets: [], narration: `Slide ${n}` })) };

describe("overviews", () => {
  it("an audio script goes from script to ready", () => {
    const db = createMemoryDb();
    migrate(db);
    saveOverview(db, "audio", { id: "job_1", sessionId: null }, JSON.stringify(AUDIO), 5);
    const saved = getOverview(db, "job_1");
    expect(saved?.state).toBe("script");
    expect(scriptLines(saved!).map((l) => l.voice)).toEqual(["A", "B", "A", "B"]);
    expect(overviewsToRender(db)).toHaveLength(1);
    setRendering(db, "job_1");
    setRendered(db, "job_1", { file: "overviews/job_1.m4a", durationMs: 9000, lineStarts: [0, 2000, 4000, 6000], voices: "system:a+b" });
    expect(getOverview(db, "job_1")).toMatchObject({ state: "ready", durationMs: 9000, lineStarts: [0, 2000, 4000, 6000] });
    expect(overviewsToRender(db)).toHaveLength(0);
  });
  it("a video's lines are its narration, all host A; a wrong contract throws", () => {
    const db = createMemoryDb();
    migrate(db);
    saveOverview(db, "video", { id: "job_2", sessionId: null }, JSON.stringify(VIDEO), 5);
    expect(scriptLines(getOverview(db, "job_2")!)).toEqual([{ voice: "A", text: "Slide 1" }, { voice: "A", text: "Slide 2" }, { voice: "A", text: "Slide 3" }]);
    expect(() => saveOverview(db, "video", { id: "job_3", sessionId: null }, JSON.stringify(AUDIO), 5)).toThrow();
  });
  it("lineAt", () => {
    expect(lineAt([0, 2000, 4000], 0)).toBe(0);
    expect(lineAt([0, 2000, 4000], 3999)).toBe(1);
    expect(lineAt([0, 2000, 4000], 99999)).toBe(2);
    expect(lineAt([], 5)).toBe(0);
  });
});
