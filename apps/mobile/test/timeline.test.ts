import { describe, expect, it } from "vitest";
import { buildTimeline, groupTimeline, type TimelineItem } from "../src/core/capture/timeline.ts";

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

  it("keeps a gap drawn after the part following the resume has closed", () => {
    // The screen hears about the resume just after the new part started, so that part started "before" the resume.
    const items = buildTimeline([], [part(0, 0, 10_000), part(1, 40_000, 20_000)], [40_050], [], []);
    expect(items).toEqual([{ kind: "gap", key: "gap-40050", at: 10_000, gapMs: 30_050 }]);
  });

  it("keeps a gap when the part after the resume is very short", () => {
    const items = buildTimeline([], [part(0, 0, 10_000), part(1, 40_000, 800)], [40_000], [], []);
    expect(items).toEqual([{ kind: "gap", key: "gap-40000", at: 10_000, gapMs: 30_000 }]);
  });

  it("draws no gap for an instant restart, and does not measure from an earlier part", () => {
    const items = buildTimeline([], [part(0, 0, 10_000), part(1, 30_000, 10_005)], [40_000], [], []);
    expect(items).toEqual([]);
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

describe("groupTimeline", () => {
  const line = (at: number, end: number, text = "words"): TimelineItem => ({ kind: "line", key: `line-${at}`, at, end, text });

  it("joins lines whose gap is under 3 seconds", () => {
    const rows = groupTimeline([line(0, 1000), line(3999, 4500)]);
    expect(rows.map((row) => row.kind)).toEqual(["paragraph"]);
  });

  it("splits lines whose gap is exactly 3 seconds", () => {
    const rows = groupTimeline([line(0, 1000), line(4000, 4500)]);
    expect(rows.map((row) => row.kind)).toEqual(["paragraph", "paragraph"]);
  });

  it("splits a line that would make the paragraph longer than 30 seconds, and joins one ending at exactly 30 seconds", () => {
    const joins = groupTimeline([line(0, 15_000), line(15_000, 30_000)]);
    expect(joins).toHaveLength(1);
    const splits = groupTimeline([line(0, 15_000), line(15_000, 30_000), line(30_000, 30_500)]);
    expect(splits).toHaveLength(2);
    expect(splits[1]).toMatchObject({ kind: "paragraph", at: 30_000 });
  });

  it("splits two close lines when a flag sits between them, and keeps the flag in place", () => {
    const rows = groupTimeline([line(0, 1000), { kind: "flag", key: "flag-0", at: 1500 }, line(1600, 2000)]);
    expect(rows.map((row) => row.kind)).toEqual(["paragraph", "flag", "paragraph"]);
    expect(rows[1]).toEqual({ kind: "flag", key: "flag-0", at: 1500 });
  });

  it("gives the paragraph the key and time of its first line", () => {
    const rows = groupTimeline([line(5000, 6000, "one"), line(6500, 7000, "two")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "paragraph", key: "line-5000", at: 5000 });
    expect(rows[0]?.kind === "paragraph" ? rows[0].lines.map((l) => l.text) : []).toEqual(["one", "two"]);
  });

  it("gives an empty list for no items", () => {
    expect(groupTimeline([])).toEqual([]);
  });
});
