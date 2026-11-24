import { describe, expect, it } from "vitest";
import { cleanTermGuess, guessHeadline, guessLabel, guessSentence, replaceWord } from "../src/core/explain/term.ts";

const guess = (over: Record<string, unknown> = {}) => ({
  misheard: true,
  term: "qua",
  original: "qua",
  language: "latin",
  meaning: "in the role of",
  ...over,
});

describe("cleanTermGuess", () => {
  it("keeps a Latin guess with no separate original", () => {
    const g = cleanTermGuess(guess(), "kwaw");
    expect(g).toEqual({ heard: "kwaw", term: "qua", original: null, language: "latin", meaning: "in the role of" });
    expect(guessHeadline(g!)).toBe("Probably qua");
    expect(guessSentence(g!)).toBe('The transcript wrote "kwaw". Qua is the Latin word for in the role of.');
  });

  it("keeps an original in another script and shows it in brackets", () => {
    const g = cleanTermGuess(guess({ term: "mochi", original: "もち", language: "japanese", meaning: "rice cake" }), "motchi");
    expect(g?.original).toBe("もち");
    expect(guessHeadline(g!)).toBe("Probably mochi (\u2068もち\u2069)");
    expect(guessLabel(g!)).toBe("Probably mochi, Japanese, written \u2068もち\u2069");
  });

  it("leaves the original out of the label when there is none", () => {
    expect(guessLabel(cleanTermGuess(guess(), "kwaw")!)).toBe("Probably qua, Latin");
  });

  it("is null when the model heard the word right", () => {
    expect(cleanTermGuess(guess({ misheard: false, term: "" }), "kwaw")).toBeNull();
  });

  it("is null when the term only repeats the heard word apart from case and punctuation", () => {
    expect(cleanTermGuess(guess({ term: "Naïve," }), "naïve")).toBeNull();
  });

  it("is null for an empty term, language or meaning", () => {
    expect(cleanTermGuess(guess({ term: "  " }), "x")).toBeNull();
    expect(cleanTermGuess(guess({ language: "" }), "x")).toBeNull();
    expect(cleanTermGuess(guess({ meaning: "" }), "x")).toBeNull();
  });

  it("is null when a part is too long", () => {
    expect(cleanTermGuess(guess({ term: "a".repeat(61) }), "x")).toBeNull();
    expect(cleanTermGuess(guess({ language: "a".repeat(41) }), "x")).toBeNull();
    expect(cleanTermGuess(guess({ meaning: "a".repeat(121) }), "x")).toBeNull();
    expect(cleanTermGuess(guess({ term: "a".repeat(60) }), "x")).not.toBeNull();
  });

  it("is null for a missing key or a non-object", () => {
    const { meaning: _meaning, ...partial } = guess();
    expect(cleanTermGuess(partial, "x")).toBeNull();
    expect(cleanTermGuess(null, "x")).toBeNull();
  });

  it("trims quotes and a final full stop from each part", () => {
    const g = cleanTermGuess(guess({ term: "“qua”", original: "'qua'.", language: " latin. ", meaning: "\"in the role of\"." }), "kwaw");
    expect(g).toMatchObject({ term: "qua", original: null, language: "latin", meaning: "in the role of" });
  });
});

describe("replaceWord", () => {
  it("replaces the word at the given place, not another copy of it", () => {
    expect(replaceWord("the kwaw and kwaw", 1, "kwaw", "qua")).toBe("the qua and kwaw");
    expect(replaceWord("the kwaw and kwaw", 3, "kwaw", "qua")).toBe("the kwaw and qua");
  });

  it("does not match inside a longer word", () => {
    expect(replaceWord("kwawk kwaw", 0, "kwaw", "qua")).toBeNull();
    expect(replaceWord("kwawk kwaw", 1, "kwaw", "qua")).toBe("kwawk qua");
  });

  it("keeps the punctuation around the word", () => {
    expect(replaceWord("(kwaw),", 0, "kwaw", "qua")).toBe("(qua),");
    expect(replaceWord("“Kwaw?” she said", 0, "Kwaw", "Qua")).toBe("“Qua?” she said");
  });

  it("matches the word as text, and gives null for a word that is not there or not the heard one", () => {
    expect(replaceWord("a+b c", 0, "a+b", "x")).toBe("x c");
    expect(replaceWord("one two", 2, "two", "x")).toBeNull();
    expect(replaceWord("one two", 1, "three", "x")).toBeNull();
  });
});
