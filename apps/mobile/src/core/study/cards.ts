import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from "ts-fsrs";
import { z } from "zod";
import type { SqlDb, SqlValue } from "../db/sql.ts";

export type CardRow = { id: string; sessionId: string; kind: "term" | "problem" | "question"; front: string; back: string; captureId: string | null; t: number | null; dueAt: number };
export type NewCard = { kind: "term" | "problem" | "question"; front: string; back: string; captureId: string | null; t: number | null };

type Deps = { now: () => number; newId: () => string };
type CardDbRow = {
  id: string;
  session_id: string;
  kind: CardRow["kind"];
  front: string;
  back: string;
  capture_id: string | null;
  t: number | null;
  due_at: number;
};

const f = fsrs(generatorParameters({ enable_fuzz: false }));
const GRADES: Record<1 | 2 | 3 | 4, Grade> = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy };
const COLUMNS = "id, session_id, kind, front, back, capture_id, t, due_at";

// The ts-fsrs card as stored: dates become Unix milliseconds. An unset last_review is left out by JSON.stringify.
const storedSchema = z.object({
  due: z.number(),
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  learning_steps: z.number(),
  reps: z.number(),
  lapses: z.number(),
  state: z.enum(State),
  last_review: z.number().optional(),
});

function toStored(card: Card): string {
  return JSON.stringify({ ...card, due: card.due.getTime(), last_review: card.last_review?.getTime() });
}

// Throws on a row that is not valid JSON or does not have the expected shape.
function fromStored(json: string): Card {
  const { due, last_review, ...rest } = storedSchema.parse(JSON.parse(json));
  if (last_review === undefined) return { ...rest, due: new Date(due) };
  return { ...rest, due: new Date(due), last_review: new Date(last_review) };
}

function toRow(row: CardDbRow): CardRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    front: row.front,
    back: row.back,
    captureId: row.capture_id,
    t: row.t,
    dueAt: row.due_at,
  };
}

function rowOf(db: SqlDb, cardId: string): CardRow {
  const row = db.get<CardDbRow>(`SELECT ${COLUMNS} FROM cards WHERE id = ?`, [cardId]);
  if (!row) throw new Error(`no such card: ${cardId}`);
  return toRow(row);
}

function storedOf(db: SqlDb, cardId: string): { fsrs: string; due_at: number } {
  const row = db.get<{ fsrs: string; due_at: number }>("SELECT fsrs, due_at FROM cards WHERE id = ?", [cardId]);
  if (!row) throw new Error(`no such card: ${cardId}`);
  return row;
}

// Same front: case and spacing ignored.
function frontKey(front: string): string {
  return front.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

// A card's main line and its supporting text (answer choices, an explanation), which a blank line separates.
export function splitCardText(text: string): { main: string; rest: string | null } {
  const at = text.indexOf("\n\n");
  return at === -1 ? { main: text, rest: null } : { main: text.slice(0, at), rest: text.slice(at + 2) };
}

// Writes the cards for one session, each new and due now. A card whose front the session already has is skipped,
// so making flashcards twice does not double the deck. Returns the saved rows.
export function saveCards(db: SqlDb, deps: Deps, sessionId: string, cards: NewCard[], madeBy: "device_model" | "quiz_miss"): CardRow[] {
  const now = deps.now();
  const rows: CardRow[] = [];
  db.transaction(() => {
    const seen = new Set(db.all<{ front: string }>("SELECT front FROM cards WHERE session_id = ?", [sessionId]).map((row) => frontKey(row.front)));
    for (const card of cards) {
      const key = frontKey(card.front);
      if (seen.has(key)) continue;
      seen.add(key);
      const id = deps.newId();
      db.run(
        "INSERT INTO cards (id, session_id, kind, front, back, capture_id, t, made_by, created_at, due_at, fsrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, sessionId, card.kind, card.front, card.back, card.captureId, card.t, madeBy, now, now, toStored(createEmptyCard(new Date(now)))],
      );
      rows.push({ id, sessionId, kind: card.kind, front: card.front, back: card.back, captureId: card.captureId, t: card.t, dueAt: now });
    }
  });
  return rows;
}

// Removes one card for good, for example one the on-device model got wrong. A synced space gets the delete too.
export function deleteCard(db: SqlDb, id: string): void {
  db.run("DELETE FROM cards WHERE id = ?", [id]);
}

// Cards due at `now`, oldest due first. With a sessionId, only that session's cards.
export function dueCards(db: SqlDb, now: number, options: { sessionId?: string; limit: number }): CardRow[] {
  const params: SqlValue[] = options.sessionId === undefined ? [now] : [now, options.sessionId];
  const scope = options.sessionId === undefined ? "" : " AND session_id = ?";
  return db
    .all<CardDbRow>(`SELECT ${COLUMNS} FROM cards WHERE due_at <= ?${scope} ORDER BY due_at, id LIMIT ?`, [...params, options.limit])
    .map(toRow);
}

export function countDue(db: SqlDb, now: number): number {
  return db.get<{ n: number }>("SELECT count(*) AS n FROM cards WHERE due_at <= ?", [now])?.n ?? 0;
}

// The card after one review. A review card practised before it is due keeps its schedule unless it was forgotten,
// so practising again and again cannot push it out further each time. The time never runs back past the last
// review (a clock set back would make ts-fsrs throw).
function scheduled(card: Card, rating: 1 | 2 | 3 | 4, now: number): Card {
  if (card.state === State.Review && rating !== 1 && now < card.due.getTime()) return card;
  const at = Math.max(now, card.last_review?.getTime() ?? 0);
  return f.next(card, new Date(at), GRADES[rating]).card;
}

// Milliseconds until the card is due again, for each rating, if it were rated now.
export function previewIntervals(db: SqlDb, cardId: string, now: number): Record<1 | 2 | 3 | 4, number> {
  const card = fromStored(storedOf(db, cardId).fsrs);
  const ms = (rating: 1 | 2 | 3 | 4): number => Math.max(0, scheduled(card, rating, now).due.getTime() - now);
  return { 1: ms(1), 2: ms(2), 3: ms(3), 4: ms(4) };
}

// Schedules one review with ts-fsrs, and writes the review and the card's new state.
export function reviewCard(db: SqlDb, cardId: string, rating: 1 | 2 | 3 | 4, now: number): CardRow {
  const before = storedOf(db, cardId);
  const next = scheduled(fromStored(before.fsrs), rating, now);
  db.transaction(() => {
    db.run("UPDATE cards SET fsrs = ?, due_at = ? WHERE id = ?", [toStored(next), next.due.getTime(), cardId]);
    db.run("INSERT INTO reviews (card_id, rating, reviewed_at, due_before, due_after) VALUES (?, ?, ?, ?, ?)", [
      cardId,
      rating,
      now,
      before.due_at,
      next.due.getTime(),
    ]);
  });
  return rowOf(db, cardId);
}

// The earliest due time after `now`, or null when no card is scheduled later.
export function nextDueAt(db: SqlDb, now: number): number | null {
  return db.get<{ due: number | null }>("SELECT min(due_at) AS due FROM cards WHERE due_at > ?", [now])?.due ?? null;
}

// Where a card's "From ..." chip opens: the moment in a recording, else the page, else the session.
export function cardSourceHref(card: { sessionId: string; captureId: string | null; t: number | null }): string {
  if (card.t !== null) return `/session/${card.sessionId}?t=${card.t}`;
  if (card.captureId !== null) return `/session/${card.sessionId}?page=${encodeURIComponent(card.captureId)}`;
  return `/session/${card.sessionId}`;
}

// Every card of one session, due or not, oldest due first. For practising a session's cards.
export function sessionCards(db: SqlDb, sessionId: string, limit: number): CardRow[] {
  return db.all<CardDbRow>(`SELECT ${COLUMNS} FROM cards WHERE session_id = ? ORDER BY due_at, id LIMIT ?`, [sessionId, limit]).map(toRow);
}

export function sessionCardCount(db: SqlDb, sessionId: string): number {
  return db.get<{ n: number }>("SELECT count(*) AS n FROM cards WHERE session_id = ?", [sessionId])?.n ?? 0;
}
