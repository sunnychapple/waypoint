import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/core/capture/timeline.ts";

const part = (index: number, startMs: number, durationMs: number) => ({ index, startMs, durationMs });

describe("buildTimeline", () => {
  it("shows a gap as soon as recording resumes, before the next part closes", () => {
    const items = buildTimeline([], [part(0, 0, 60_000)], [95_000], [], []);
    expect(items).toEqual([{ kind: "gap", key: "gap-95000", at: 60_000, gapMs: 35_000 }]);
  });

  it("shows no gap for a pause under one second, or for the first start", () => {
    expect(buildTimeline([], [part(0, 0, 60_000)], [60_900], [], [])).toEqual([]);
    expect(buildTimeline([], [], [40], [], [])).toEqual([]);
  });

  it("uses the last part that started before each resume", () => {
    const parts = [part(0, 0, 300_000), part(1, 300_000, 20_000), part(2, 330_000, 10_000)];
    const items = buildTimeline([], parts, [330_000, 350_000], [], []);
    expect(items.map((i) => (i.kind === "gap" ? [i.at, i.gapMs] : null))).toEqual([
      [320_000, 10_000],
      [340_000, 10_000],
    ]);
  });

  it("puts lines, gaps, flags and photos in time order", () => {
    const items = buildTimeline(
      [{ tStart: 70_000, tEnd: 71_000, text: "after", isFinal: true }, { tStart: 1000, tEnd: 2000, text: "before", isFinal: true }],
      [part(0, 0, 60_000)],
      [65_000],
      [30_000],
      [{ id: "x", t: 80_000, file: "p.jpg" }],
    );
    expect(items.map((i) => i.kind)).toEqual(["line", "flag", "gap", "line", "photo"]);
  });
});
