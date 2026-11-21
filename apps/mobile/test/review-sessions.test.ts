import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The Review home screen imports React Native; only the pure helpers are loaded for real.
vi.mock("react-native", () => ({
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("expo-symbols", () => ({ SymbolView: "SymbolView" }));
vi.mock("../src/platform/config.ts", () => ({ useConfig: () => null }));
vi.mock("../src/platform/db.ts", () => ({ useMinuteNow: () => 0, useQuery: () => null }));
vi.mock("../src/ui/kit.tsx", () => ({}));
vi.mock("../src/ui/theme.ts", () => ({ useColors: () => ({}) }));
vi.mock("../src/features/study/ReviewScreen.tsx", () => ({ nextDueLabel: () => "" }));

const { RECENT_SESSION_COUNT, visibleSessions } = (await import(
  "../src/features/study/ReviewHomeScreen.tsx"
)) as {
  RECENT_SESSION_COUNT: number;
  visibleSessions: <T>(sessions: T[], expanded: boolean) => T[];
};

const sessions = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` }));
const SRC = resolve(__dirname, "../src/features/study/ReviewHomeScreen.tsx");

describe("Review home session list", () => {
  it("shows the five newest sessions by default", () => {
    expect(RECENT_SESSION_COUNT).toBe(5);
    expect(visibleSessions(sessions(9), false).map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });

  it("shows every session once expanded, in the same order", () => {
    expect(visibleSessions(sessions(9), true).map((s) => s.id)).toEqual(sessions(9).map((s) => s.id));
  });

  it("shows all of a list of five or fewer, expanded or not", () => {
    expect(visibleSessions(sessions(3), false)).toHaveLength(3);
    expect(visibleSessions(sessions(3), true)).toHaveLength(3);
    expect(visibleSessions([], false)).toEqual([]);
  });

  it("does not slice the full list in the query, so the expanded list has every session", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).not.toContain("slice(0, 5)");
    expect(src).toContain("sessions,\n");
  });

  it("labels the toggle with the total count and a matching Show fewer", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).toContain("`Show all ${data.sessions.length} sessions`");
    expect(src).toContain('"Show fewer"');
    expect(src).toContain('accessibilityRole="button"');
  });
});
