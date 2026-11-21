import { describe, expect, it } from "vitest";
import { listSegments } from "../src/core/capture/segments.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import { addToThread, discardIfUnsaved, getExplanation, startExplanation, type ThreadItem } from "../src/core/explain/explanations.ts";
import { cleanWord, excerptAround, pageContext, splitWords, trimExcerpt } from "../src/core/explain/excerpt.ts";
import { addPages, startPagesSession } from "../src/core/capture/pages.ts";
import { saveExplanation, savedExplanations, startExplanation as startExp } from "../src/core/explain/explanations.ts";
import {
  askLater,
  countOpenFlags,
  dismissFlag,
  groupFlagsBySession,
  markAnswered,
  openFlags,
  questionFor,
  wordFromQuestion,
} from "../src/core/explain/later.ts";
import { getSent, logSent, settleFailedSent, settleSent, utf8Length } from "../src/core/explain/sent.ts";
import { createMemoryDb } from "./helpers/db.ts";

function setup() {
  const db = createMemoryDb();
  migrate(db);
  let n = 0;
  const deps = { now: () => 1_000, newId: () => `id_${++n}` };
  const space = ensureDefaultSpace(db, deps);
  db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('s1', ?, 'recording', 'Bio', 'saved', 0)", [space.id]);
  return { db, deps };
}

const seg = (tStart: number, text: string) => ({ tStart, tEnd: tStart + 4_000, text });

describe("excerptAround", () => {
  const lines = [seg(0, "first"), seg(56_000, "before"), seg(100_000, "word here"), seg(108_000, "just after"), seg(120_000, "too late")];
  it("keeps segments overlapping 45 s before to 9 s after, in time order", () => {
    expect(excerptAround([...lines].reverse(), 100_000)).toBe("before word here just after");
  });
  it("collapses spaces and returns '' when nothing is near", () => {
    expect(excerptAround([seg(0, "  a \n b ")], 1_000)).toBe("a b");
    expect(excerptAround(lines, 500_000)).toBe("");
  });
  it("cuts from the start at a word boundary to fit", () => {
    expect(excerptAround([seg(0, "aaa bbb ccc ddd")], 0, 9)).toBe("ccc ddd");
    expect(excerptAround([seg(0, "abcdefghij")], 0, 4)).toBe("ghij");
  });
});

describe("words", () => {
  it("splitWords keeps every character and finds the words", () => {
    const tokens = splitWords("Photosynthesis, in “plants”!");
    expect(tokens.map((t) => t.text).join("")).toBe("Photosynthesis, in “plants”!");
    expect(tokens.filter((t) => t.word !== null).map((t) => t.word)).toEqual(["Photosynthesis", "in", "plants"]);
    expect(splitWords("")).toEqual([]);
  });
  it("cleanWord", () => {
    expect(cleanWord("(mitochondria).")).toBe("mitochondria");
    expect(cleanWord("—")).toBeNull();
    expect(cleanWord("x".repeat(101))).toBeNull();
    expect(cleanWord("don't")).toBe("don't");
  });
});

describe("explanations and sent_log", () => {
  it("lists device segments in order", () => {
    const { db } = setup();
    db.run("INSERT INTO segments (session_id, t_start, t_end, text, source) VALUES ('s1', 5000, 6000, 'b', 'device'), ('s1', 1000, 2000, 'a', 'device'), ('s1', 1000, 2000, 'c', 'cloud')");
    expect(listSegments(db, "s1")).toEqual([{ tStart: 1000, tEnd: 2000, text: "a" }, { tStart: 5000, tEnd: 6000, text: "b" }]);
  });
  it("start, add to the thread, discard unless saved", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 1234.6, "osmosis");
    expect(e).toMatchObject({ sessionId: "s1", t: 1235, term: "osmosis", thread: [], saved: false, createdAt: 1_000 });
    const item: ThreadItem = { kind: "explain", text: "Water moves.", at: 2_000, retention: "standard", sentId: "key_1" };
    expect(addToThread(db, e.id, item).thread).toEqual([item]);
    expect(getExplanation(db, e.id)?.thread).toEqual([item]);
    discardIfUnsaved(db, e.id);
    expect(getExplanation(db, e.id)).toBeNull();
  });
  it("discard keeps a saved explanation", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "osmosis");
    db.run("UPDATE explanations SET saved = 1 WHERE id = ?", [e.id]);
    discardIfUnsaved(db, e.id);
    expect(getExplanation(db, e.id)).toMatchObject({ id: e.id, saved: true });
  });
  it("a corrupt thread throws", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "x");
    db.run("UPDATE explanations SET thread = '[{\"kind\":\"other\"}]' WHERE id = ?", [e.id]);
    expect(() => getExplanation(db, e.id)).toThrow();
  });
  it("logSent stores the exact body once, settleSent adds credits and retention", () => {
    const { db } = setup();
    const body = { word: "café", transcript: "un café" };
    logSent(db, { id: "key_1", task: "explain", sessionId: "s1", body, at: 5 });
    logSent(db, { id: "key_1", task: "explain", sessionId: "s1", body: { word: "other", transcript: "x" }, at: 6 });
    expect(getSent(db, "key_1")).toEqual({ id: "key_1", task: "explain", sessionId: "s1", sent: JSON.stringify(body), bytes: 40, credits: null, retention: null, at: 5 });
    settleSent(db, "key_1", 1, "standard");
    expect(getSent(db, "key_1")).toMatchObject({ credits: 1, retention: "standard" });
    expect(getSent(db, "nope")).toBeNull();
  });
  it("a failed request charges nothing, but 'already finished' keeps the credits of the charged first request", () => {
    const { db } = setup();
    logSent(db, { id: "key_1", task: "explain", sessionId: "s1", body: {}, at: 1 });
    settleFailedSent(db, "key_1", { kind: "offline" });
    expect(getSent(db, "key_1")).toMatchObject({ credits: 0, retention: null });
    logSent(db, { id: "key_2", task: "explain", sessionId: "s1", body: {}, at: 2 });
    settleSent(db, "key_2", 1, "standard");
    settleFailedSent(db, "key_2", { kind: "already_finished" });
    expect(getSent(db, "key_2")).toMatchObject({ credits: 1, retention: "standard" });
    logSent(db, { id: "key_3", task: "explain", sessionId: "s1", body: {}, at: 3 });
    settleFailedSent(db, "key_3", { kind: "already_finished" });
    expect(getSent(db, "key_3")).toMatchObject({ credits: null, retention: null });
  });
  it("utf8Length", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("€")).toBe(3);
    expect(utf8Length("😀")).toBe(4);
  });
  it("deleting the session removes explanations, terms and sent_log rows", () => {
    const { db, deps } = setup();
    const e = startExplanation(db, deps, "s1", 0, "x");
    db.run("INSERT INTO terms (id, session_id, explanation_id, term, meaning, created_at) VALUES ('t1', 's1', ?, 'x', 'm', 1)", [e.id]);
    logSent(db, { id: "key_1", task: "explain", sessionId: "s1", body: {}, at: 1 });
    db.run("DELETE FROM sessions WHERE id = 's1'");
    expect(db.get<{ n: number }>("SELECT (SELECT count(*) FROM explanations) + (SELECT count(*) FROM terms) + (SELECT count(*) FROM sent_log) AS n")?.n).toBe(0);
  });
  it("askLater adds a flag with the question", () => {
    const { db, deps } = setup();
    askLater(db, deps, "s1", 4_200.4, "osmosis");
    expect(db.get<{ t: number; question: string; state: string }>("SELECT t, question, state FROM flags")).toEqual({ t: 4200, question: 'What does "osmosis" mean?', state: "open" });
  });
});

describe("questions for later", () => {
  it("wordFromQuestion reads back the word askLater stores, and nothing else", () => {
    expect(wordFromQuestion(questionFor("osmosis"))).toBe("osmosis");
    expect(wordFromQuestion('What does "a "quoted" word" mean?')).toBe('a "quoted" word');
    expect(wordFromQuestion("")).toBeNull();
    expect(wordFromQuestion("Why is the sky blue?")).toBeNull();
    expect(wordFromQuestion('What does "" mean?')).toBeNull();
  });

  it("openFlags lists open flags only, newest session first, in time order within a session", () => {
    const { db } = setup();
    db.run("INSERT INTO sessions (id, space_id, kind, title, state, started_at) VALUES ('s0', (SELECT id FROM spaces LIMIT 1), 'recording', 'Older', 'saved', 0)");
    db.run("UPDATE sessions SET started_at = 100 WHERE id = 's1'");
    db.run("INSERT INTO flags (id, session_id, t, question) VALUES ('f1', 's0', 500, '')");
    db.run("INSERT INTO flags (id, session_id, t, question) VALUES ('f2', 's1', 900, '')");
    db.run("INSERT INTO flags (id, session_id, t, question) VALUES ('f3', 's1', 100, 'What does \"cell\" mean?')");
    db.run("INSERT INTO flags (id, session_id, t, question, state) VALUES ('f4', 's1', 200, '', 'answered')");
    expect(openFlags(db).map((f) => [f.id, f.sessionTitle, f.t])).toEqual([
      ["f3", "Bio", 100],
      ["f2", "Bio", 900],
      ["f1", "Older", 500],
    ]);
    expect(countOpenFlags(db)).toBe(3);
  });

  it("groupFlagsBySession keeps the order of the first flag of each session", () => {
    const flag = (id: string, sessionId: string, title: string) => ({ id, sessionId, sessionTitle: title, startedAt: 0, t: 0, question: "" });
    const groups = groupFlagsBySession([flag("a", "s2", "Two"), flag("b", "s1", "One"), flag("c", "s2", "Two")]);
    expect(groups.map((g) => [g.sessionTitle, g.flags.map((f) => f.id)])).toEqual([
      ["Two", ["a", "c"]],
      ["One", ["b"]],
    ]);
    expect(groupFlagsBySession([])).toEqual([]);
  });

  it("markAnswered and dismissFlag change only open flags", () => {
    const { db, deps: d } = setup();
    askLater(db, d, "s1", 10, "osmosis");
    askLater(db, d, "s1", 20, "cell");
    const [first, second] = openFlags(db);
    markAnswered(db, first!.id);
    dismissFlag(db, second!.id);
    expect(db.all<{ state: string }>("SELECT state FROM flags ORDER BY t").map((r) => r.state)).toEqual(["answered", "dismissed"]);
    dismissFlag(db, first!.id); // already answered: stays answered
    expect(db.get<{ state: string }>("SELECT state FROM flags WHERE id = ?", [first!.id])?.state).toBe("answered");
    expect(countOpenFlags(db)).toBe(0);
  });
});

describe("saved explanations", () => {
  it("lists saved explanations newest first, with the first answer and the session title", () => {
    const { db, deps: d } = setup();
    const older = startExp(db, { now: () => 100, newId: d.newId }, "s1", 5_000, "mitosis");
    db.run("UPDATE explanations SET thread = ? WHERE id = ?", [
      JSON.stringify([
        { kind: "explain", text: "Cell division.", at: 1, retention: "standard", sentId: "k1" },
        { kind: "more_detail", text: "More.", at: 2, retention: "standard", sentId: "k2" },
      ]),
      older.id,
    ]);
    saveExplanation(db, { now: () => 100, newId: d.newId }, older.id);
    const newer = startExp(db, { now: () => 200, newId: d.newId }, "s1", 9_000, "osmosis");
    db.run("UPDATE explanations SET thread = ? WHERE id = ?", [
      JSON.stringify([{ kind: "explain", text: "Water moves across a membrane.", at: 3, retention: "zero", sentId: "k3" }]),
      newer.id,
    ]);
    saveExplanation(db, { now: () => 200, newId: d.newId }, newer.id);
    startExp(db, { now: () => 300, newId: d.newId }, "s1", 1_000, "unsaved");

    expect(savedExplanations(db)).toEqual([
      { id: newer.id, sessionId: "s1", sessionTitle: "Bio", t: 9000, term: "osmosis", answer: "Water moves across a membrane.", createdAt: 200 },
      { id: older.id, sessionId: "s1", sessionTitle: "Bio", t: 5000, term: "mitosis", answer: "Cell division.", createdAt: 100 },
    ]);
  });
});

describe("page context", () => {
  it("trimExcerpt collapses spaces and keeps the end of a long text within the limit", () => {
    expect(trimExcerpt("  a \n b  ")).toBe("a b");
    expect(trimExcerpt("aaa bbb ccc ddd", 9)).toBe("ccc ddd");
    const long = "word ".repeat(1_000);
    const out = trimExcerpt(long);
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out.endsWith("word")).toBe(true);
  });

  it("pageContext gives the page's number (from 1) and its found text; null for a page not in the session", () => {
    const { db, deps: d } = setup();
    const spaceId = db.get<{ space_id: string }>("SELECT space_id FROM sessions WHERE id = 's1'")!.space_id;
    startPagesSession(db, d, spaceId, "Pages");
    db.run("UPDATE sessions SET id = 'p1', kind = 'pages' WHERE id = 's1'");
    const [first, second] = addPages(db, d, "p1", ["a.jpg", "b.jpg"]);
    db.run("UPDATE captures SET found_text = ? WHERE id = ?", ["Mitochondria are the powerhouse.", second!]);
    expect(pageContext(db, "p1", second!)).toEqual({ number: 2, text: "Mitochondria are the powerhouse." });
    expect(pageContext(db, "p1", first!)).toEqual({ number: 1, text: "" });
    expect(pageContext(db, "p1", "missing")).toBeNull();
  });
});
