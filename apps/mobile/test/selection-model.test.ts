import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineMark } from "../src/core/capture/marks.ts";

// The selection model and the paragraph slices load the screens' modules; only the pure parts are run for real.
const push = vi.fn();
vi.mock("react-native", () => ({
  Alert: { alert: () => undefined },
  AccessibilityInfo: { announceForAccessibility: () => undefined },
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
vi.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => push(...args) } }));
vi.mock("../src/platform/db.ts", () => ({ writeDb: () => undefined }));
vi.mock("../src/ui/theme.ts", () => ({ useColors: () => ({}) }));

const { liveSelection, selectionModel } = await import("../src/features/capture/selectionModel.ts");
const { paragraphSlice } = await import("../src/features/capture/ParagraphRow.tsx");

type Line = { kind: "line"; key: string; at: number; end: number; text: string };
const line = (at: number, text: string): Line => ({ kind: "line", key: `k${at}`, at, end: at + 1000, text });
const lines = [line(0, "Cells divide now"), line(5_000, "and grow fast")];
const ref = (at: number, index: number) => ({ at, index });

function model(selection: { from: { at: number; index: number }; to: { at: number; index: number } } | null, canChange = true) {
  const setSelection = vi.fn();
  const result = selectionModel({
    sessionId: "s1",
    lines,
    marks: new Map(),
    explained: new Map(),
    explanations: [],
    selection,
    setSelection,
    canChange,
  });
  return { result, setSelection };
}

beforeEach(() => push.mockClear());

describe("liveSelection", () => {
  it("keeps a selection whose words are shown, and drops one whose lines are gone", () => {
    const live = { from: ref(0, 0), to: ref(0, 1) };
    expect(liveSelection(live, lines)).toBe(live);
    expect(liveSelection({ from: ref(9_000, 0), to: ref(9_000, 0) }, lines)).toBeNull();
    expect(liveSelection(null, lines)).toBeNull();
  });

  it("drops a selection that starts past the last word of its line (the line was edited)", () => {
    expect(liveSelection({ from: ref(0, 10), to: ref(0, 10) }, lines)).toBeNull();
  });
});

describe("selectionModel with a stale selection", () => {
  const stale = { from: ref(9_000, 0), to: ref(9_000, 2) };

  it("has nothing picked and no bar actions, as if nothing were selected", () => {
    const { result } = model(stale);
    expect(result.picked).toBeNull();
    expect(result.single).toBe(false);
    expect(result.highlighted).toBe(false);
  });

  it("starts a new one-word selection on a tap, not a range from the stale one", () => {
    const { result, setSelection } = model(stale);
    result.tapWord(ref(0, 1), "divide");
    expect(setSelection).toHaveBeenCalledWith({ from: ref(0, 1), to: ref(0, 1) });
  });

  it("still extends a live selection on a tap", () => {
    const live = { from: ref(0, 0), to: ref(0, 0) };
    const { result, setSelection } = model(live);
    result.tapWord(ref(5_000, 1), "grow");
    expect(setSelection).toHaveBeenCalledWith({ from: ref(0, 0), to: ref(5_000, 1) });
  });
});

describe("paragraphSlice", () => {
  it("keeps only this paragraph's marks and explained words", () => {
    const mark = (tStart: number, speaker: string | null): LineMark => ({ tStart, text: null, hidden: false, speaker, highlights: [] });
    const marks = new Map<number, LineMark>([
      [0, mark(0, "Ana")],
      [5_000, mark(5_000, null)],
      [9_000, mark(9_000, null)],
    ]);
    const explained = new Map([
      ["0:1", "e1"],
      ["5000:0", "e2"],
      ["9000:3", "e3"],
    ]);
    const slice = paragraphSlice([line(0, "a"), line(5_000, "b")], marks, explained);
    expect([...slice.marks.keys()]).toEqual([0, 5_000]);
    expect([...slice.explained.entries()]).toEqual([
      ["0:1", "e1"],
      ["5000:0", "e2"],
    ]);
  });
});
