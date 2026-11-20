import { describe, expect, it } from "vitest";
import { cleanPhrase, pickPositions, recoveryState, wordCount, wordsMatch } from "../src/core/device/recovery.ts";

describe("recovery words", () => {
  const words = "a b c d e f g h i j k l".split(" ");
  it("pickPositions gives 3 different sorted positions", () => {
    const seq = [0.99, 0.0, 0.0, 0.5];
    expect(pickPositions(() => seq.shift() ?? 0.2)).toEqual([0, 6, 11]);
  });
  it("wordsMatch ignores case and spaces, and needs every word", () => {
    expect(wordsMatch(words, [0, 5, 11], [" A", "f ", "L"])).toBe(true);
    expect(wordsMatch(words, [0, 5, 11], ["a", "f", "k"])).toBe(false);
    expect(wordsMatch(words, [0, 5, 11], ["a", "f"])).toBe(false);
  });
  it("cleanPhrase and wordCount", () => {
    expect(cleanPhrase("  Zoo\nzoo   WRONG ")).toBe("zoo zoo wrong");
    expect(wordCount(" ")).toBe(0);
    expect(wordCount("a b\tc")).toBe(3);
  });
  it("recoveryState", () => {
    expect(recoveryState({ verified_at: 5 }, false)).toBe("saved");
    expect(recoveryState({ verified_at: null }, false)).toBe("unchecked");
    expect(recoveryState(null, false)).toBe("missing");
    expect(recoveryState(null, true)).toBe("unknown");
  });
});
