import { describe, expect, it, vi } from "vitest";

// The screens import React Native and native modules; only the pure helpers under test are loaded for real.
vi.mock("react-native", () => ({
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
  Alert: {},
  Image: "Image",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("expo-router", () => ({ router: {}, useLocalSearchParams: () => ({}) }));
vi.mock("expo-symbols", () => ({ SymbolView: "SymbolView" }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("../src/platform/files.ts", () => ({ fileUri: (p: string) => `file:///doc/${p}` }));
vi.mock("../src/platform/db.ts", () => ({ getDb: () => ({}), useQuery: () => null, writeDb: () => undefined }));
vi.mock("../src/platform/config.ts", () => ({ useConfig: () => null }));
vi.mock("../src/platform/pageReading.ts", () => ({ retryPageRead: async () => false }));
vi.mock("../src/platform/links.ts", () => ({ linkRefused: () => false, revokeLink: async () => undefined }));
vi.mock("../src/platform/sync.ts", () => ({}));
vi.mock("../src/features/capture/RecordingPlayer.tsx", () => ({ RecordingPlayer: () => null }));
vi.mock("../src/platform/groups.ts", () => ({}));
vi.mock("../src/ui/kit.tsx", () => ({}));
vi.mock("../src/ui/WordText.tsx", () => ({ WordText: () => null }));
vi.mock("../src/ui/theme.ts", () => ({ useColors: () => ({}) }));
vi.mock("../modules/waypoint-audio/index.ts", () => ({ getRecorderStatus: () => ({ state: "idle" }) }));
vi.mock("../modules/waypoint-embed/index.ts", () => ({ embed: async () => [], getModel: () => ({ modelVersion: "v", available: false }) }));

// The .tsx modules are loaded by path, since this project's test tsconfig has no JSX setting for literal imports.
type SearchModule = { hitRoute: (hit: { sessionId: string; tStart: number; captureId: string | null }) => string };
type SessionModule = { targetPageId: (pages: { id: string }[], pageId: string | undefined) => string | null };
type MarksModule = { flagLabel: (at: number) => string; photoLabel: (at: number) => string };
const SEARCH = "../src/features/search/SearchScreen.tsx";
const SESSION = "../src/features/capture/SessionScreen.tsx";
const MARKS = "../src/features/capture/TimelineMarks.tsx";
const PHOTO = "../src/features/capture/PhotoScreen.tsx";
type PhotoModule = {
  isKnownCapture: (db: unknown, file: string) => boolean;
  photoFoundText: (db: unknown, file: string) => { state: "reading" } | { state: "read"; text: string } | null;
};
const { isKnownCapture, photoFoundText } = (await import(PHOTO)) as PhotoModule;
const { hitRoute } = (await import(SEARCH)) as SearchModule;
const { targetPageId } = (await import(SESSION)) as SessionModule;
const { flagLabel, photoLabel } = (await import(MARKS)) as MarksModule;

describe("search hit routes", () => {
  it("sends a transcript hit to its moment", () => {
    expect(hitRoute({ sessionId: "s1", tStart: 12345, captureId: null })).toBe("/session/s1?t=12345");
  });

  it("sends a page hit to that page, not the top", () => {
    expect(hitRoute({ sessionId: "s1", tStart: 0, captureId: "cap 1" })).toBe("/session/s1?t=0&page=cap%201");
  });
});

describe("landing on a page", () => {
  const pages = [{ id: "a" }, { id: "b" }];

  it("finds a page in this session", () => {
    expect(targetPageId(pages, "b")).toBe("b");
  });

  it("ignores a page that is not in this session, or no page", () => {
    expect(targetPageId(pages, "zzz")).toBeNull();
    expect(targetPageId(pages, "")).toBeNull();
    expect(targetPageId(pages, undefined)).toBeNull();
  });
});

describe("timeline mark labels", () => {
  it("labels a photo with its time", () => {
    expect(photoLabel(42_000)).toBe("Photo at 0:42");
  });

  it("labels a flag with its time and where it opens", () => {
    expect(flagLabel(125_000)).toBe("Flagged moment at 2:05, opens Questions for later");
  });
});

describe("photo viewer path check", () => {
  const db = { get: (_sql: string, params: string[]) => (params[0] === "sessions/s1/p.jpg" ? { ok: 1 } : null) };

  it("shows a capture the database knows", () => {
    expect(isKnownCapture(db, "sessions/s1/p.jpg")).toBe(true);
  });

  it("refuses unknown paths and traversal from a crafted link", () => {
    expect(isKnownCapture(db, "../..")).toBe(false);
    expect(isKnownCapture(db, "sessions/../keys.db")).toBe(false);
    expect(isKnownCapture(db, "/etc/passwd")).toBe(false);
    expect(isKnownCapture(db, "sessions/s2/p.jpg")).toBe(false);
  });
});

describe("photo text under the photo", () => {
  // file -> found_text; a file missing from the map is not a capture this person has.
  const captures = new Map<string, string | null>([
    ["sessions/s1/read.jpg", "Qd = Qs at equilibrium"],
    ["sessions/s1/blank.jpg", "   "],
    ["sessions/s1/pending.jpg", null],
  ]);
  const db = {
    get: (sql: string, params: string[]) => {
      if (!captures.has(params[0] ?? "")) return null;
      const file = params[0] ?? "";
      return sql.includes("found_text") ? { found_text: captures.get(file) ?? null } : { ok: 1 };
    },
  };

  it("returns the text the app read, trimmed", () => {
    expect(photoFoundText(db, "sessions/s1/read.jpg")).toEqual({ state: "read", text: "Qd = Qs at equilibrium" });
  });

  it("reports reading while found_text is still null", () => {
    expect(photoFoundText(db, "sessions/s1/pending.jpg")).toEqual({ state: "reading" });
  });

  it("returns read with empty text when the photo holds no text", () => {
    expect(photoFoundText(db, "sessions/s1/blank.jpg")).toEqual({ state: "read", text: "" });
  });

  it("returns nothing for an unknown file or a traversal path, so no text is read", () => {
    expect(photoFoundText(db, "sessions/s2/read.jpg")).toBeNull();
    expect(photoFoundText(db, "sessions/../read.jpg")).toBeNull();
    expect(photoFoundText(db, "/sessions/s1/read.jpg")).toBeNull();
  });
});
