import { createEmptyCard, fsrs, generatorParameters, Rating } from "ts-fsrs";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../src/core/capture/sessions.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { ensureDefaultSpace } from "../src/core/db/spaces.ts";
import type { SqlDb } from "../src/core/db/sql.ts";
import {
  cardSourceHref,
  countDue,
  deleteCard,
  dueCards,
  nextDueAt,
  previewIntervals,
  reviewCard,
  saveCards,
  sessionCardCount,
  sessionCards,
  type NewCard,
} from "../src/core/study/cards.ts";
import { createMemoryDb } from "./helpers/db.ts";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
let db: SqlDb;
let sessionId: string;
let ids: number;
const deps = () => ({ now: () => NOW, newId: () => `card-${++ids}` });

const card = (front: string): NewCard => ({ kind: "term", front, back: `${front} means something`, captureId: null, t: null });

beforeEach(() => {
  db = createMemoryDb();
  migrate(db);
  ids = 0;
  const home = ensureDefaultSpace(db, { now: () => NOW, newId: () => "space" });
  sessionId = createSession(db, { now: () => NOW, newId: () => "session" }, { spaceId: home.id, kind: "recording", title: "Lecture 6", state: "saved" }).id;
});

describe("cards", () => {
  it("new cards are saved due now, with where they were made", () => {
    const rows = saveCards(db, deps(), sessionId, [card("Elasticity")], "device_model");
    expect(rows).toEqual([
      { id: "card-1", sessionId, kind: "term", front: "Elasticity", back: "Elasticity means something", captureId: null, t: null, dueAt: NOW },
    ]);
    expect(dueCards(db, NOW, { limit: 10 })).toEqual(rows);
    expect(db.get<{ made_by: string }>("SELECT made_by FROM cards WHERE id = 'card-1'")).toEqual({ made_by: "device_model" });
  });

  it("a new card rated Good is due in 10 minutes and rated Again in 1 minute", () => {
    saveCards(db, deps(), sessionId, [card("A"), card("B")], "device_model");
    const good = reviewCard(db, "card-1", Rating.Good, NOW);
    const again = reviewCard(db, "card-2", Rating.Again, NOW);
    expect(good.dueAt - NOW).toBe(10 * MIN);
    expect(again.dueAt - NOW).toBe(1 * MIN);
  });

  it("a review writes a reviews row with the due time before and after", () => {
    saveCards(db, deps(), sessionId, [card("A")], "device_model");
    reviewCard(db, "card-1", Rating.Good, NOW);
    expect(db.all<{ rating: number; reviewed_at: number; due_before: number; due_after: number }>("SELECT rating, reviewed_at, due_before, due_after FROM reviews")).toEqual([
      { rating: Rating.Good, reviewed_at: NOW, due_before: NOW, due_after: NOW + 10 * MIN },
    ]);
  });

  it("previewIntervals matches the due time that reviewCard then sets", () => {
    saveCards(db, deps(), sessionId, [card("A"), card("B"), card("C"), card("D")], "device_model");
    const ratings = [1, 2, 3, 4] as const;
    const previews = ratings.map((rating) => previewIntervals(db, `card-${rating}`, NOW)[rating]);
    ratings.forEach((rating, i) => {
      expect(reviewCard(db, `card-${rating}`, rating, NOW).dueAt - NOW).toBe(previews[i]);
    });
  });

  it("dueCards lists the oldest due first, honours the limit and the session filter", () => {
    const other = createSession(db, { now: () => NOW, newId: () => "session-2" }, { spaceId: "space", kind: "pages", title: "Pages", state: "saved" }).id;
    saveCards(db, deps(), sessionId, [card("A"), card("B")], "device_model");
    saveCards(db, deps(), other, [card("C")], "device_model");
    db.run("UPDATE cards SET due_at = ? WHERE id = 'card-1'", [NOW - 3 * MIN]);
    db.run("UPDATE cards SET due_at = ? WHERE id = 'card-2'", [NOW - 5 * MIN]);
    db.run("UPDATE cards SET due_at = ? WHERE id = 'card-3'", [NOW + MIN]);
    expect(dueCards(db, NOW, { limit: 10 }).map((c) => c.id)).toEqual(["card-2", "card-1"]);
    expect(dueCards(db, NOW, { limit: 1 }).map((c) => c.id)).toEqual(["card-2"]);
    expect(dueCards(db, NOW, { sessionId: other, limit: 10 })).toEqual([]);
    expect(dueCards(db, NOW, { sessionId, limit: 10 }).map((c) => c.id)).toEqual(["card-2", "card-1"]);
  });

  it("countDue counts the cards due at the given time", () => {
    saveCards(db, deps(), sessionId, [card("A"), card("B")], "device_model");
    db.run("UPDATE cards SET due_at = ? WHERE id = 'card-2'", [NOW + MIN]);
    expect(countDue(db, NOW)).toBe(1);
    expect(countDue(db, NOW + MIN)).toBe(2);
  });

  it("nextDueAt is the earliest due time after now, or null", () => {
    saveCards(db, deps(), sessionId, [card("A"), card("B")], "device_model");
    db.run("UPDATE cards SET due_at = ? WHERE id = 'card-1'", [NOW + 10 * MIN]);
    db.run("UPDATE cards SET due_at = ? WHERE id = 'card-2'", [NOW + 3 * MIN]);
    expect(nextDueAt(db, NOW)).toBe(NOW + 3 * MIN);
    expect(nextDueAt(db, NOW + 5 * MIN)).toBe(NOW + 10 * MIN);
    expect(nextDueAt(db, NOW + 10 * MIN)).toBeNull();
  });

  it("the stored schedule keeps its dates as milliseconds across reviews", () => {
    saveCards(db, deps(), sessionId, [card("A")], "device_model");
    reviewCard(db, "card-1", Rating.Good, NOW);
    const stored = db.get<{ fsrs: string }>("SELECT fsrs FROM cards WHERE id = 'card-1'")?.fsrs ?? "";
    expect(JSON.parse(stored).due).toBe(NOW + 10 * MIN);
    const later = NOW + 10 * MIN;
    const direct = fsrs(generatorParameters({ enable_fuzz: false })).next(createEmptyCard(new Date(NOW)), new Date(NOW), Rating.Good);
    const expected = fsrs(generatorParameters({ enable_fuzz: false })).next(direct.card, new Date(later), Rating.Good).card.due.getTime();
    expect(reviewCard(db, "card-1", Rating.Good, later).dueAt).toBe(expected);
  });

  it("a stored schedule that is not valid throws", () => {
    saveCards(db, deps(), sessionId, [card("A")], "device_model");
    db.run("UPDATE cards SET fsrs = '{\"due\":\"soon\"}' WHERE id = 'card-1'");
    expect(() => previewIntervals(db, "card-1", NOW)).toThrow();
    expect(() => reviewCard(db, "card-1", Rating.Good, NOW)).toThrow();
  });

  it("sessionCardCount counts the cards of one session", () => {
    saveCards(db, deps(), sessionId, [card("A"), card("B")], "device_model");
    expect(sessionCardCount(db, sessionId)).toBe(2);
    expect(sessionCardCount(db, "no-such-session")).toBe(0);
  });

  it("deleteCard removes one card, and an unknown id changes nothing", () => {
    saveCards(db, deps(), sessionId, [card("A"), card("B")], "device_model");
    deleteCard(db, "card-1");
    expect(sessionCards(db, sessionId, 10).map((c) => c.id)).toEqual(["card-2"]);
    deleteCard(db, "no-such-card");
    expect(sessionCards(db, sessionId, 10).map((c) => c.id)).toEqual(["card-2"]);
  });

  it("sessionCards lists every card of one session, due or not, oldest due first", () => {
    const other = createSession(db, { now: () => NOW, newId: () => "session-2" }, { spaceId: "space", kind: "pages", title: "Pages", state: "saved" }).id;
    saveCards(db, deps(), sessionId, [card("A"), card("B"), card("C")], "device_model");
    saveCards(db, deps(), other, [card("D")], "device_model");
    db.run("UPDATE cards SET due_at = ? WHERE id = 'card-1'", [NOW + 3 * MIN]);
    db.run("UPDATE cards SET due_at = ? WHERE id = 'card-2'", [NOW - MIN]);
    expect(sessionCards(db, sessionId, 10).map((c) => c.id)).toEqual(["card-2", "card-3", "card-1"]);
    expect(sessionCards(db, sessionId, 2).map((c) => c.id)).toEqual(["card-2", "card-3"]);
    expect(sessionCards(db, other, 10).map((c) => c.id)).toEqual(["card-4"]);
    expect(sessionCards(db, "no-such-session", 10)).toEqual([]);
  });

  it("reviewing a card that is not due yet reschedules it like any other review", () => {
    saveCards(db, deps(), sessionId, [card("A")], "device_model");
    reviewCard(db, "card-1", Rating.Good, NOW);
    expect(dueCards(db, NOW, { limit: 10 })).toEqual([]);
    const early = reviewCard(db, "card-1", Rating.Again, NOW + MIN);
    expect(early.dueAt).toBe(NOW + 2 * MIN);
    expect(db.all<{ rating: number }>("SELECT rating FROM reviews ORDER BY reviewed_at").map((r) => r.rating)).toEqual([Rating.Good, Rating.Again]);
  });

  it("a review card practised early keeps its schedule unless forgotten, and a clock set back does not throw", () => {
    saveCards(db, deps(), sessionId, [card("A")], "device_model");
    let at = NOW;
    let due = reviewCard(db, "card-1", Rating.Good, at).dueAt;
    for (let i = 0; i < 3; i++) {
      at = due;
      due = reviewCard(db, "card-1", Rating.Good, at).dueAt;
    }
    const early = at + 60_000;
    expect(reviewCard(db, "card-1", Rating.Easy, early).dueAt).toBe(due);
    expect(reviewCard(db, "card-1", Rating.Hard, early).dueAt).toBe(due);
    expect(previewIntervals(db, "card-1", early)[4]).toBe(due - early);
    expect(reviewCard(db, "card-1", Rating.Again, early).dueAt).toBeLessThan(due);
    expect(() => reviewCard(db, "card-1", Rating.Good, NOW)).not.toThrow();
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM reviews")?.n).toBe(8);
  });

  it("saveCards skips a front the session already has, ignoring case and spacing", () => {
    saveCards(db, deps(), sessionId, [card("Elasticity")], "device_model");
    const second = saveCards(db, deps(), sessionId, [card("elasticity "), card("Supply")], "device_model");
    expect(second.map((c) => c.front)).toEqual(["Supply"]);
    expect(sessionCardCount(db, sessionId)).toBe(2);
  });

  it("saveCards keeps where each card came from, and a missed quiz question is saved as quiz_miss", () => {
    db.run("INSERT INTO captures (id, session_id, kind, t, position, file) VALUES ('cap-1', ?, 'page', 0, 0, 'p.jpg')", [sessionId]);
    const rows = saveCards(db, deps(), sessionId, [{ ...card("Ohm's law"), captureId: "cap-1", t: 4000 }], "quiz_miss");
    expect(dueCards(db, NOW, { limit: 10 })).toEqual(rows);
    expect(rows[0]).toMatchObject({ captureId: "cap-1", t: 4000 });
    expect(db.get<{ made_by: string }>("SELECT made_by FROM cards WHERE id = ?", [rows[0]?.id ?? ""])).toEqual({ made_by: "quiz_miss" });
  });

  it("a late review records the time the card was due, not the time it was reviewed", () => {
    saveCards(db, deps(), sessionId, [card("A")], "device_model");
    reviewCard(db, "card-1", Rating.Good, NOW + 5 * MIN);
    expect(db.get<{ due_before: number }>("SELECT due_before FROM reviews")?.due_before).toBe(NOW);
  });

  it("several reviews over days match ts-fsrs without fuzz, including a late one", () => {
    saveCards(db, deps(), sessionId, [card("A")], "device_model");
    const f = fsrs(generatorParameters({ enable_fuzz: false }));
    let expected = createEmptyCard(new Date(NOW));
    let at = NOW;
    for (const step of [0, 10 * MIN, 0, 0, 3 * 86_400_000]) {
      at = Math.max(at, expected.due.getTime()) + step;
      expected = f.next(expected, new Date(at), Rating.Good).card;
      expect(reviewCard(db, "card-1", Rating.Good, at).dueAt).toBe(expected.due.getTime());
    }
    expect(expected.scheduled_days).toBeGreaterThanOrEqual(3);
  });

  it("a card from a recording opens at its moment", () => {
    expect(cardSourceHref({ sessionId: "session", captureId: "cap-1", t: 4000 })).toBe("/session/session?t=4000");
    expect(cardSourceHref({ sessionId: "session", captureId: null, t: 0 })).toBe("/session/session?t=0");
  });

  it("a card from a page opens that page", () => {
    expect(cardSourceHref({ sessionId: "session", captureId: "cap-1", t: null })).toBe("/session/session?page=cap-1");
    expect(cardSourceHref({ sessionId: "session", captureId: "a b&c", t: null })).toBe("/session/session?page=a%20b%26c");
  });

  it("a card with no source opens the session", () => {
    expect(cardSourceHref({ sessionId: "session", captureId: null, t: null })).toBe("/session/session");
  });
});
