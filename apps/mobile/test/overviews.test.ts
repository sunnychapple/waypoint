import { describe, expect, it } from "vitest";
import { migrate } from "../src/core/db/migrate.ts";
import { getOverview, lineAt, overviewsToRender, saveOverview, scriptLines, setRenderFailed, setRenderPending, setRendered, setRendering, spokenLines } from "../src/core/overviews/overviews.ts";
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
    expect(lineAt([0, 2000, 4000], 2000)).toBe(1);
    expect(lineAt([0, 2000, 4000], 4000)).toBe(2);
  });
  it("a render cut off by the app closing is listed again", () => {
    const db = createMemoryDb();
    migrate(db);
    saveOverview(db, "audio", { id: "job_4", sessionId: null }, JSON.stringify(AUDIO), 5);
    setRendering(db, "job_4");
    expect(overviewsToRender(db).map((o) => o.id)).toEqual(["job_4"]);
  });
  it("a failed render keeps the script; no_voices is its own state", () => {
    const db = createMemoryDb();
    migrate(db);
    saveOverview(db, "audio", { id: "job_5", sessionId: null }, JSON.stringify(AUDIO), 5);
    const script = getOverview(db, "job_5")!.script;
    setRenderFailed(db, "job_5", "failed");
    expect(getOverview(db, "job_5")).toMatchObject({ state: "failed", script });
    expect(overviewsToRender(db)).toHaveLength(0);
    setRenderFailed(db, "job_5", "no_voices");
    expect(getOverview(db, "job_5")).toMatchObject({ state: "no_voices", script });
  });
  it("a video held back by a recording stays a script and is listed again to retry", () => {
    const db = createMemoryDb();
    migrate(db);
    saveOverview(db, "video", { id: "job_8", sessionId: null }, JSON.stringify(VIDEO), 5);
    setRendering(db, "job_8");
    setRenderPending(db, "job_8");
    expect(getOverview(db, "job_8")?.state).toBe("script");
    expect(overviewsToRender(db).map((o) => o.id)).toEqual(["job_8"]);
  });
  it("line starts that are not numbers are dropped when read", () => {
    const db = createMemoryDb();
    migrate(db);
    saveOverview(db, "audio", { id: "job_6", sessionId: null }, JSON.stringify(AUDIO), 5);
    db.run("UPDATE overviews SET line_starts = ? WHERE id = ?", ['[0,"x",2000,null,4000]', "job_6"]);
    expect(getOverview(db, "job_6")?.lineStarts).toEqual([0, 2000, 4000]);
  });
  it("spokenLines leaves out blank lines, so the script's lines and the timings line up", () => {
    const withBlank = { ...AUDIO, lines: [{ host: "A", text: "Hi" }, { host: "B", text: "   " }, { host: "A", text: "Cells" }, { host: "B", text: "Yes" }] };
    const db = createMemoryDb();
    migrate(db);
    saveOverview(db, "audio", { id: "job_7", sessionId: null }, JSON.stringify(withBlank), 5);
    expect(spokenLines(getOverview(db, "job_7")!)).toEqual([{ voice: "A", text: "Hi" }, { voice: "A", text: "Cells" }, { voice: "B", text: "Yes" }]);
  });
});
