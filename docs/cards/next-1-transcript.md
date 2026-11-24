# Next 1: working in the transcript

From the owner's class notes of 22 Nov 2026 (notes 1, 2, 3, 5, 9, 11, 12, 13 and 19) and boards S2, S4, S10, S13 and S14 in `waypoint-usage-notes-2026-11-22.pen`. Written against `main` at `16e3bcc`. Paths are under `apps/mobile/` unless they start with `docs/`.

What this group adds:

- **Edit** (S4, S13, note 12): an Edit switch makes the transcript typeable, while recording and after class. An "Editing transcript" bar shows while it is on. Undo brings back what was heard. It replaces the "Fix" action on the boards. Today the transcript has no fix at all; only a page's text can be fixed, in a sheet (`PageTextEditor.tsx`, PR #199), which overwrites `found_text`. Here there is no sheet: you type in the line.
- **Selection bar** (S2, notes 5, 11, 13): tap a word, then tap another word to select everything between. One bar handles Explain, Highlight and Note, and More holds "Who's talking?" and "Hide these lines". Recording keeps running.
- **Definitions stay marked** (note 1): every saved explanation of transcript words is underlined in the transcript. Tapping it reopens the saved answer.
- **Highlights** (note 11), kept and synced.
- **Notes** (note 13): a Note button in the recording dock and in the bar. Notes are placed in the timeline.
- **Hide side comments** (S10, note 9): the person hides lines by hand, can show them again, and can unhide them. Nothing is hidden automatically.
- **Named speakers** (S14, notes 2, 3, 19), named by hand. The person picks a name saved in the space, picks "Several people", or types a new name.

## Decisions in this group

1. **A line is identified by its session and the start time of its on-device line** (`segments.t_start`, source `device`). That is also the key the screen uses for a line (`line-<tStart>`), and sync keeps the same `t_start` values. Segment row ids are not stable: sync deletes and rewrites each 10-minute piece, so they are not used.
2. **What was heard is never changed.** Edits, hidden lines, speaker names and highlights go in a new table, `line_marks`, with one row per changed line. `segments` stays exactly as heard, so Undo only removes the person's text. Notes go in a new table, `notes`. Both tables sync like flags and cards. A viewer sees them but gets no controls that change them.
3. **A re-transcribed part never wipes a change.** When the waiting-transcription queue (`platform/transcription.ts`) writes a part again, and the person changed any line in that part, every line there is kept. Only pieces that fill a hole are added (`partUpdate`, T3). The cloud second transcript writes `source = 'cloud'` rows and never touches the device lines.
4. **While recording, only finished lines can be typed in.** The grey words still being heard cannot be typed in. When they finish, they arrive as a new line you can tap. A finished line never changes again (`addPiece` ignores repeats), so the recognizer can never overwrite what you are typing. Opening a line stops the list from following the live end, and "Jump to live" brings it back.
5. **Hidden lines are left out of everything that reads the transcript to make or send something:** flashcards, quizzes, search, share links, Explain's excerpt, research, overviews, video and Practice sets. They stay in the transcript behind "Show N hidden lines". Edited text is used everywhere in place of what was heard. One helper, `studyLines` (T2), does both.
6. **Explanations stay on this iPhone, as they do today** (`explanations` is not a synced table). So the definition marks show on the phone that asked. Syncing explanations is a separate decision.
7. **Notes are not added to study or cloud inputs** in this group.
8. **Selection is tap to start and tap to end, with no dragging.** React Native's nested `Text` gives no position for each character or word, and it has no selection callback. Dragging across words would need one `View` per word (thousands for a lecture, and they break running text and Dynamic Type) or a native text view. Tapping a start word and an end word works across paragraphs, keeps the text as it is, and needs no measuring. For VoiceOver, each paragraph gets a "Select this paragraph" action.
9. **Speakers are named by hand only.** The app has no speaker separation today. Apple's on-device speech gives words and times, and the Whisper second pass (`RetranscribeResult`) gives `start`, `end` and `text` per segment, so neither gives speakers. A name is stored as words on the lines (`line_marks.speaker`). The names "Saved in <space>" are the names already used on lines in that space, so no voice data and no extra table are needed. Choices: "Only these lines", or "Until the next name", which names the following lines until one that already has a name. "Several people" is stored as `*`. A typed name must have a letter or a digit, so it can never be `*`.

## Order

| Card | Purpose | Depends on |
|---|---|---|
| T1 | Migration 11 (`line_marks`, `notes`), and sync for both | none |
| T2 | Core: line marks, notes, `studyLines` | T1 |
| T3 | Everything that reads the transcript uses `studyLines`; re-transcription keeps changed lines | T2 |
| T4 | Core: selection, picked text, explained words, `applyMarks` | T2 |
| T5 | Notes: sheet, timeline rows, Note button in the dock | T2, T4 |
| T6 | Who's talking? sheet | T2 |
| T7 | Selection bar, highlights, definition marks, hiding, in the saved session | T3, T4, T5, T6 |
| T8 | The same while recording | T7 |
| T9 | Edit switch in the saved session | T7 |
| T10 | Edit switch while recording | T8, T9 |

Every card's branch starts from `origin/main` once the cards it depends on are merged. Checks for every card, from `apps/mobile`: `npm run typecheck` and `npm test`. Cards T5 to T10 also run `npm run export:ios`. No card changes Swift or the API, so `npm run test:swift` and the API tests do not apply.

---

## T1 · Store line marks and notes, and sync them

Branch `feat/t1-line-marks`. Files, and no others:

- `src/core/db/schema.ts`
- `src/core/sync/changes.ts`
- `src/platform/sync.ts`
- `test/migrate.test.ts`
- `test/schema.test.ts`
- `test/sync.test.ts`
- `docs/cards/next-1-transcript.md` (new: this file, copied as it is)

### schema.ts

Add migration 11 at the end of `MIGRATIONS` (never edit an older one):

```ts
  {
    version: 11,
    sql: `
-- A transcript line the person changed (Next 1): their words (NULL shows what was heard), hidden, who said it, and
-- highlighted words as [[first, last], ...] word positions. The heard line in segments is never changed. id is
-- "<session id>:<t_start>", so two phones marking the same line write the same row.
CREATE TABLE line_marks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t_start INTEGER NOT NULL CHECK (t_start >= 0),
  text TEXT CHECK (text IS NULL OR length(text) <= 2000),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  speaker TEXT CHECK (speaker IS NULL OR length(speaker) BETWEEN 1 AND 40),
  highlights TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  UNIQUE (session_id, t_start)
);

-- A note the person typed, placed in the recording's timeline at t; quote holds the words it was made from, or ''.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  t INTEGER NOT NULL CHECK (t >= 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  quote TEXT NOT NULL DEFAULT '' CHECK (length(quote) <= 300),
  created_at INTEGER NOT NULL
);
CREATE INDEX notes_session ON notes (session_id, t);

CREATE TRIGGER sync_line_marks_insert AFTER INSERT ON line_marks WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('line_marks', new.id, 0, NULL);
END;
CREATE TRIGGER sync_line_marks_update AFTER UPDATE OF session_id, t_start, text, hidden, speaker, highlights, updated_at ON line_marks WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('line_marks', new.id, 0, NULL);
END;
CREATE TRIGGER sync_line_marks_delete AFTER DELETE ON line_marks WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('line_marks', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
CREATE TRIGGER sync_notes_insert AFTER INSERT ON notes WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('notes', new.id, 0, NULL);
END;
CREATE TRIGGER sync_notes_update AFTER UPDATE OF session_id, t, text, quote ON notes WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('notes', new.id, 0, NULL);
END;
CREATE TRIGGER sync_notes_delete AFTER DELETE ON notes WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('notes', old.id, 1, (SELECT g.group_id FROM sessions s JOIN space_groups g ON g.space_id = s.space_id WHERE s.id = old.session_id));
END;
`,
  },
```

### changes.ts

1. `export const SYNC_TABLES = ["spaces", "sessions", "captures", "flags", "cards", "line_marks", "notes"] as const;`

2. In `SYNC_COLUMNS`, after `cards`:

```ts
  line_marks: ["id", "session_id", "t_start", "text", "hidden", "speaker", "highlights", "updated_at"],
  notes: ["id", "session_id", "t", "text", "quote", "created_at"],
```

3. In `markMoved`, change the loop to `for (const table of ["captures", "flags", "cards", "line_marks", "notes"]) {`.

4. In `write`, in the `change.op === "delete"` branch, replace the last two lines (`db.run(\`DELETE FROM ${change.table} WHERE id = ?\`, [key]); return "applied";`) with:

```ts
    // A line's words or hidden state may change what search finds (studyLines), so the session is indexed again.
    if (change.table === "line_marks") db.run("UPDATE sessions SET indexed_at = NULL WHERE id = (SELECT session_id FROM line_marks WHERE id = ?)", [key]);
    db.run(`DELETE FROM ${change.table} WHERE id = ?`, [key]);
    return "applied";
```

5. At the end of `write`, replace `upsertRow(db, change.table, row);` with:

```ts
  upsertRow(db, change.table, row);
  if (change.table === "line_marks") db.run("UPDATE sessions SET indexed_at = NULL WHERE id = ?", [sessionId]);
```

An app version from before this card cannot parse a `line_marks` or `notes` change (`z.enum(SYNC_TABLES)`), so it skips them, as it does any change it cannot read. Known limit below.

### platform/sync.ts

In `markExisting`, change the loop to `for (const table of ["captures", "flags", "cards", "line_marks", "notes"]) {`.

### Tests

`test/migrate.test.ts`: the latest version is 11 (three places).

`test/schema.test.ts`, in its style:
- `line_marks`, `notes` and `notes_session` exist.
- A `line_marks` row with `hidden = 2` is refused, and so is a second row with the same `session_id` and `t_start`.
- A `notes` row with `text = ''` is refused.
- Deleting the session deletes its `line_marks` and `notes` rows.

`test/sync.test.ts`, a new `describe("line marks and notes (Next 1)")`, using `device()`, `send()` and `one()`:
- In a synced space, a `line_marks` row (insert it with SQL: id `${s.id}:0`, `t_start` 0, `text` 'cells divide', `updated_at` 1) and a `notes` row are queued after the session, as `line_marks` and `notes` upserts carrying every `SYNC_COLUMNS` value. Deleting the mark queues `delete_line_marks`.
- Applied on device b after the session, both rows land in b's space. A mark upsert sets b's `indexed_at` back to NULL (set it to 5 first), and so does the mark's delete. A note does not change `indexed_at`.
- A mark that arrives before its session waits in `sync_pending` and lands with the session.
- `markMoved(a.db, s.id, null)` queues the session's marks and notes again.
- A `line_marks` change with `hidden: 3` is `"rejected"` and leaves nothing behind.

Checks: typecheck, test.

### Review fixes

- changes.ts: a received `line_marks` row is `"rejected"` unless `row.id === \`${row.session_id}:${row.t_start}\``. Test: a mismatched id is rejected and not stored; a matching one is applied.
- schema.ts (migration 11, not released, so edited in place): `highlights` has `CHECK (length(highlights) <= 20000)` and `CHECK (json_valid(highlights))`. The test SQLite (node:sqlite, SQLite 3.53) and expo-sqlite both support `json_valid`. Test: invalid JSON, and an over-long value, throw.
- Tests added: applying a received mark queues nothing in `dirty`; a delete for a mark whose session is in another space is `"rejected"` and keeps the row.

Notes for later cards:

- T2: a mark that is back to all defaults (text NULL, hidden 0, speaker NULL, highlights `[]`) is deleted, not kept as an empty row.
- T2 and T4: parse `highlights` through the zod schema, with a fallback to `[]`.
- T3: handle sessions that have only cloud segments. The marks key only appears on device lines.

---

## T2 · Line marks, notes, and the transcript as the person keeps it

Branch `feat/t2-marks-core`, after T1 is merged. Files, and no others:

- `src/core/capture/marks.ts` (new)
- `src/core/capture/notes.ts` (new)
- `src/core/capture/segments.ts`
- `test/marks.test.ts` (new)
- `test/notes.test.ts` (new)

### marks.ts (new)

```ts
import { z } from "zod";
import type { SqlDb } from "../db/sql.ts";

type Deps = { now: () => number };

// Who said lines that more than one person said (note 19). A typed name always has a letter or a digit, so it is never this.
export const SEVERAL = "*";
export const SPEAKER_MAX_CHARS = 40;
export const LINE_TEXT_MAX_CHARS = 2000;

// Highlighted words of one line: [first, last] word positions (from 0, counted as selection.ts counts them), inclusive.
export type Span = [number, number];
// What the person changed on one transcript line (Next 1). text null shows what was heard.
export type LineMark = { tStart: number; text: string | null; hidden: boolean; speaker: string | null; highlights: Span[] };
// One line's part of a selection: its start, and its first and last selected word.
export type LinePick = { at: number; from: number; to: number };

const SpansSchema = z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).max(500);

function parseSpans(raw: string): Span[] {
  try {
    const parsed = SpansSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.filter(([from, to]) => from <= to) : [];
  } catch {
    return [];
  }
}

type Row = { t_start: number; text: string | null; hidden: number; speaker: string | null; highlights: string };
const COLUMNS = "t_start, text, hidden, speaker, highlights";

function fromRow(row: Row): LineMark {
  return { tStart: row.t_start, text: row.text, hidden: row.hidden === 1, speaker: row.speaker, highlights: parseSpans(row.highlights) };
}

export function lineMarks(db: SqlDb, sessionId: string): LineMark[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM line_marks WHERE session_id = ? ORDER BY t_start`, [sessionId]).map(fromRow);
}

function markAt(db: SqlDb, sessionId: string, tStart: number): LineMark {
  const row = db.get<Row>(`SELECT ${COLUMNS} FROM line_marks WHERE session_id = ? AND t_start = ?`, [sessionId, tStart]);
  return row === null ? { tStart, text: null, hidden: false, speaker: null, highlights: [] } : fromRow(row);
}

// Keeps one line's mark, or removes its row when nothing is left on it. `reread`: the line's words or hidden state changed,
// so search indexes the session again.
function writeMark(db: SqlDb, deps: Deps, sessionId: string, mark: LineMark, reread: boolean): void {
  const id = `${sessionId}:${mark.tStart}`;
  if (mark.text === null && !mark.hidden && mark.speaker === null && mark.highlights.length === 0) {
    db.run("DELETE FROM line_marks WHERE id = ?", [id]);
  } else {
    db.run(
      `INSERT INTO line_marks (id, session_id, t_start, text, hidden, speaker, highlights, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET text = excluded.text, hidden = excluded.hidden, speaker = excluded.speaker,
         highlights = excluded.highlights, updated_at = excluded.updated_at`,
      [id, sessionId, mark.tStart, mark.text, mark.hidden ? 1 : 0, mark.speaker, JSON.stringify(mark.highlights), deps.now()],
    );
  }
  if (reread) db.run("UPDATE sessions SET indexed_at = NULL WHERE id = ?", [sessionId]);
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

// The person's words for a line (Edit, note 12). The heard line in segments never changes. null, or the heard words,
// removes the edit, so Undo brings back what was heard. Clearing every word hides the line instead, so nothing is lost.
// A line that is not in the transcript is left alone.
export function editLine(db: SqlDb, deps: Deps, sessionId: string, tStart: number, text: string | null): void {
  const heard = db.get<{ text: string }>("SELECT text FROM segments WHERE session_id = ? AND source = 'device' AND t_start = ?", [sessionId, tStart]);
  if (heard === null) return;
  const mark = markAt(db, sessionId, tStart);
  const clean = text === null ? null : collapse(text).slice(0, LINE_TEXT_MAX_CHARS);
  if (clean === "") {
    writeMark(db, deps, sessionId, { ...mark, hidden: true }, true);
    return;
  }
  writeMark(db, deps, sessionId, { ...mark, text: clean === null || clean === collapse(heard.text) ? null : clean }, true);
}

// Hides lines, or shows them again (S10). Only the person does this; nothing is hidden on its own.
export function setHidden(db: SqlDb, deps: Deps, sessionId: string, tStarts: number[], hidden: boolean): void {
  db.transaction(() => {
    for (const t of tStarts) writeMark(db, deps, sessionId, { ...markAt(db, sessionId, t), hidden }, true);
  });
}

// A typed name with spaces collapsed, cut to 40 characters. null when it has no letter or digit.
export function cleanName(name: string): string | null {
  const clean = collapse(name).slice(0, SPEAKER_MAX_CHARS).trim();
  return /[\p{L}\p{N}]/u.test(clean) ? clean : null;
}

// Who said these lines (S14): a name, SEVERAL, or null to remove the name. A name with no letter or digit is ignored.
export function setSpeaker(db: SqlDb, deps: Deps, sessionId: string, tStarts: number[], speaker: string | null): void {
  const name = speaker === null || speaker === SEVERAL ? speaker : cleanName(speaker);
  if (speaker !== null && name === null) return;
  db.transaction(() => {
    for (const t of tStarts) writeMark(db, deps, sessionId, { ...markAt(db, sessionId, t), speaker: name }, false);
  });
}

export function speakerLabel(speaker: string): string {
  return speaker === SEVERAL ? "Several people" : speaker;
}

// The names used in a space, newest first: "Saved in <space>". Only names are kept, never anything about a voice.
export function speakerNames(db: SqlDb, spaceId: string): string[] {
  return db
    .all<{ name: string }>(
      `SELECT m.speaker AS name FROM line_marks m JOIN sessions s ON s.id = m.session_id
       WHERE s.space_id = ? AND m.speaker IS NOT NULL AND m.speaker <> ? GROUP BY m.speaker ORDER BY MAX(m.updated_at) DESC LIMIT 30`,
      [spaceId, SEVERAL],
    )
    .map((row) => row.name);
}

// "Until the next name": the chosen lines, then every line after the last of them, up to the next line that already has
// a name. `lines` are the session's lines in time order.
export function linesToName(lines: { tStart: number; speaker: string | null }[], chosen: number[]): number[] {
  if (chosen.length === 0) return [];
  const last = Math.max(...chosen);
  const out = new Set(chosen);
  for (const line of lines) {
    if (line.tStart <= last) continue;
    if (line.speaker !== null) break;
    out.add(line.tStart);
  }
  return [...out].sort((a, b) => a - b);
}

// The run of lines around `at` that share its name, for changing a name from its label. Just `at` when it has no name.
export function speakerRun(lines: { tStart: number; speaker: string | null }[], at: number): number[] {
  const i = lines.findIndex((line) => line.tStart === at);
  const name = lines[i]?.speaker ?? null;
  if (i === -1 || name === null) return [at];
  let from = i;
  while (from > 0 && lines[from - 1]?.speaker === name) from -= 1;
  let to = i;
  while (to < lines.length - 1 && lines[to + 1]?.speaker === name) to += 1;
  return lines.slice(from, to + 1).map((line) => line.tStart);
}

// Spans stay sorted and merged: touching or overlapping spans become one.
export function addSpan(spans: Span[], add: Span): Span[] {
  const out: Span[] = [];
  for (const [from, to] of [...spans, add].sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1);
    if (last !== undefined && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

export function removeSpan(spans: Span[], [from, to]: Span): Span[] {
  return spans.flatMap(([a, b]): Span[] => {
    if (b < from || a > to) return [[a, b]];
    const kept: Span[] = [];
    if (a < from) kept.push([a, from - 1]);
    if (b > to) kept.push([to + 1, b]);
    return kept;
  });
}

export function coversSpan(spans: Span[], [from, to]: Span): boolean {
  return spans.some(([a, b]) => a <= from && b >= to);
}

// Highlight (note 11): the picked words are highlighted, or, when every one of them already is, the highlight is removed.
// Returns true when they are highlighted now.
export function toggleHighlight(db: SqlDb, deps: Deps, sessionId: string, picks: LinePick[]): boolean {
  const marks = picks.map((pick) => ({ pick, mark: markAt(db, sessionId, pick.at) }));
  const remove = marks.length > 0 && marks.every(({ pick, mark }) => coversSpan(mark.highlights, [pick.from, pick.to]));
  db.transaction(() => {
    for (const { pick, mark } of marks) {
      const span: Span = [pick.from, pick.to];
      writeMark(db, deps, sessionId, { ...mark, highlights: remove ? removeSpan(mark.highlights, span) : addSpan(mark.highlights, span) }, false);
    }
  });
  return !remove;
}
```

### notes.ts (new)

```ts
import type { SqlDb } from "../db/sql.ts";

type Deps = { now: () => number; newId: () => string };

export const NOTE_MAX_CHARS = 2000;
export const QUOTE_MAX_CHARS = 300;

// A note the person typed in a recording (note 13), t ms into it. quote holds the words it was made from, or "".
export type Note = { id: string; sessionId: string; t: number; text: string; quote: string; createdAt: number };

type Row = { id: string; session_id: string; t: number; text: string; quote: string; created_at: number };
const COLUMNS = "id, session_id, t, text, quote, created_at";

function fromRow(row: Row): Note {
  return { id: row.id, sessionId: row.session_id, t: row.t, text: row.text, quote: row.quote, createdAt: row.created_at };
}

export function notesForSession(db: SqlDb, sessionId: string): Note[] {
  return db.all<Row>(`SELECT ${COLUMNS} FROM notes WHERE session_id = ? ORDER BY t, created_at`, [sessionId]).map(fromRow);
}

export function getNote(db: SqlDb, id: string): Note | null {
  const row = db.get<Row>(`SELECT ${COLUMNS} FROM notes WHERE id = ?`, [id]);
  return row === null ? null : fromRow(row);
}

// Returns the new note's id, or null when it has no text.
export function addNote(db: SqlDb, deps: Deps, sessionId: string, t: number, text: string, quote = ""): string | null {
  const clean = text.trim().slice(0, NOTE_MAX_CHARS);
  if (clean === "") return null;
  const id = deps.newId();
  db.run("INSERT INTO notes (id, session_id, t, text, quote, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    sessionId,
    Math.max(0, Math.round(t)),
    clean,
    quote.replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX_CHARS),
    deps.now(),
  ]);
  return id;
}

// A note emptied of text is deleted.
export function updateNote(db: SqlDb, id: string, text: string): void {
  const clean = text.trim().slice(0, NOTE_MAX_CHARS);
  if (clean === "") deleteNote(db, id);
  else db.run("UPDATE notes SET text = ? WHERE id = ?", [clean, id]);
}

export function deleteNote(db: SqlDb, id: string): void {
  db.run("DELETE FROM notes WHERE id = ?", [id]);
}
```

### segments.ts

Add after `listSegments`:

```ts
// The transcript as the person keeps it (Next 1): their words in place of what was heard, with hidden lines and lines
// left empty taken out. Everything that reads the transcript to make or send something uses this: flashcards, quizzes,
// search, share links, Explain's excerpt and the cloud tasks.
export function studyLines(db: SqlDb, sessionId: string): SegmentLine[] {
  return db
    .all<SegmentLine>(
      `SELECT s.t_start AS tStart, s.t_end AS tEnd, COALESCE(m.text, s.text) AS text
       FROM segments s LEFT JOIN line_marks m ON m.session_id = s.session_id AND m.t_start = s.t_start
       WHERE s.session_id = ? AND s.source = 'device' AND COALESCE(m.hidden, 0) = 0 ORDER BY s.t_start`,
      [sessionId],
    )
    .filter((line) => line.text.trim() !== "");
}
```

### Tests

`test/marks.test.ts` (new). Set up as `test/indexer.test.ts` does: `migrate`, one space, one recording session with `indexed_at = 5`, and device segments at 0, 1000 and 2000 ("Cells divide.", "Teacher: phones away", "Mitosis has four phases."), plus one cloud segment at 0. Use `deps = { now: () => 100 }`.
- `editLine` stores the person's words and leaves `segments.text` unchanged. It sets `indexed_at` back to NULL.
- `editLine` with the heard words (with extra spaces) or with null removes the row: this is Undo.
- `editLine` with only spaces hides the line and keeps no text change. `editLine` on a time with no device line writes nothing. Text over 2,000 characters is cut.
- `setHidden` hides two lines and shows them again. With nothing left on a line, its row is deleted.
- `setSpeaker` stores a cleaned name ("  Ms   Lee " becomes "Ms Lee") and stores `SEVERAL` as it is. It ignores "  " and "**". null removes the name. It does not touch `indexed_at`.
- `speakerNames` lists the names in this space only, newest `updated_at` first, each once, without `SEVERAL`.
- `addSpan`: `[[0,1]]` plus `[2,3]` gives `[[0,3]]`, and `[[5,6]]` plus `[0,1]` gives `[[0,1],[5,6]]`. `removeSpan([[0,5]], [2,3])` gives `[[0,1],[4,5]]`. `coversSpan` is true only when one span covers the whole range.
- `toggleHighlight` highlights picks across two lines and returns true. The same picks again remove the highlight and return false. A pick that is only partly highlighted is highlighted in full.
- `linesToName` adds the following lines up to the next named line. `speakerRun` returns the run of lines with the same name, and just `at` when the line has no name.
- `lineMarks` reads highlights that are not valid JSON as `[]`.
- `studyLines` gives the edited text, leaves out hidden lines and lines edited to empty text by sync (insert `text = ''` with SQL), and ignores cloud segments.

`test/notes.test.ts` (new):
- `addNote` returns an id. The note is listed by `notesForSession` in `t` order, with its quote collapsed and cut to 300 characters.
- `addNote` with only spaces returns null and writes nothing. A negative `t` is stored as 0.
- `updateNote` changes the text. Updating it to "" deletes the note. `getNote` returns null for a missing id.

Checks: typecheck, test.

### Review fixes

1. `editLine` sets `hidden` to false for Undo (null) and for any edit that leaves words. A cleared line comes back on Undo, and a retyped line shows.
2. After an edit, highlight spans are clamped to the shown text's words: spans starting past the last word are dropped, and `to` is capped at the last word. The word split is `text.split(/\s+/)` with empty words removed, since `selection.ts` does not exist yet (T4); T4 should use the same split.
3. `toggleHighlight` ignores picks whose numbers are not whole numbers >= 0, swaps a reversed `from`/`to`, returns false for no picks, groups picks by line and reads each line's mark once inside the transaction. `parseSpans` drops invalid entries one by one, then sorts and merges like `addSpan`.
4. `setHidden`, `setSpeaker` and `toggleHighlight` write only for whole-number `tStart`s that are device segments of the session (one `IN` query). A mark equal to the stored one is not written. `setHidden` resets `indexed_at` once after the loop, and only when a line changed.
5. `notes.ts`: a non-finite `t` is stored as 0; notes are ordered by `t, created_at, id`; text and quote are cut by code points (no split surrogate pair); a comment says viewer checks are done by the screens.
6. Comments only: `studyLines` gives [] for a session with only cloud segments (T3 decides what to show); `linesToName` expects lines sorted by `tStart`.

---

## T3 · Everything that reads the transcript uses the person's version

Branch `feat/t3-study-lines`, after T2 is merged. Files, and no others:

- `src/core/capture/transcript.ts`
- `src/platform/transcription.ts`
- `src/core/study/units.ts`
- `src/core/research/research.ts`
- `src/core/search/indexer.ts`
- `src/core/share/links.ts`
- `src/core/explain/later.ts`
- `src/features/explain/useExplain.ts`
- `test/transcript.test.ts`
- `test/units.test.ts`
- `test/research.test.ts`
- `test/indexer.test.ts`
- `test/links.test.ts`
- `test/explain-later-home.test.ts`

### transcript.ts

Add after `replacementFor`:

```ts
// What to write for a re-transcribed part. When the person changed a line that starts in it (its words, a name, a highlight
// or hiding it), every line there stays and only pieces that fill a hole are added, so their change is never lost.
// Otherwise the part's lines are replaced as replacementFor says. Null: nothing to write.
export function partUpdate<T extends SegmentSpan>(
  part: PartSpan,
  pieces: T[],
  existing: SegmentSpan[],
  marked: number[],
): { replace: boolean; pieces: T[] } | null {
  const end = part.startMs + part.durationMs;
  if (marked.some((t) => t >= part.startMs && t < end)) {
    const fresh = piecesToKeep(pieces, existing);
    return fresh.length === 0 ? null : { replace: false, pieces: fresh };
  }
  const fresh = replacementFor(part, pieces, existing);
  return fresh === null ? null : { replace: true, pieces: fresh };
}
```

### platform/transcription.ts

Import `partUpdate` in place of `replacementFor`. In `transcribeSession`, replace from `const fresh = replacementFor(part, pieces, existing);` through the end of its `db.transaction(…)` with:

```ts
      // Lines the person changed are kept as they are (partUpdate).
      const marked = db.all<{ t_start: number }>("SELECT t_start FROM line_marks WHERE session_id = ?", [sessionId]).map((row) => row.t_start);
      const update = partUpdate(part, pieces, existing, marked);
      if (update === null) return;
      db.transaction(() => {
        if (update.replace) {
          db.run("DELETE FROM segments WHERE session_id = ? AND source = 'device' AND t_start >= ? AND t_start < ?", [
            sessionId,
            part.startMs,
            part.startMs + part.durationMs,
          ]);
        }
        for (const piece of update.pieces) saveSegment(db, sessionId, piece);
      });
```

### The readers

Each one reads `studyLines` from `../capture/segments.ts` in place of its own `SELECT … FROM segments … source = 'device'`:

- `units.ts` (`studyUnits`): `const segments = studyLines(db, sessionId).map((line) => ({ t_start: line.tStart, text: line.text }));`
- `research.ts` (`allNotes`, used by research, overviews, video and Practice sets): `const transcript = studyLines(db, sessionId).map((line) => line.text);`
- `indexer.ts`, inside `read`: `segments: studyLines(db, sessionId),`. The comparison inside the transaction then also notices an edit made while the embedder ran.
- `links.ts` (`sharedItem`): `const allLines = studyLines(db, sessionId).map((line) => ({ t: line.tStart, text: line.text }));`
- `later.ts` (`phraseForFlag`): `lineAt(studyLines(db, flag.sessionId), flag.t)`. Change the import to `lineAt, studyLines`.
- `useExplain.ts`: `excerptAround(studyLines(getDb(), sessionId), t)`. Change the import to `studyLines`.

Update each file's comment where it says "the transcript made on this iPhone" to add "as the person edited it, without hidden lines".

### Tests

Insert `line_marks` rows with SQL in each test (id `${session}:${t}`, `updated_at` 1):
- `transcript.test.ts`: `partUpdate` with no marks equals `replacementFor` with `replace: true`. With a mark inside the part, it returns `replace: false` and only the pieces that fill a hole. With a mark inside and no hole, it returns null. A mark in another part does not stop the replacement.
- `units.test.ts`: an edited line's words are in the unit, and a hidden line's words are not.
- `research.test.ts`: `notesForResearch` has the edited words and not the hidden line.
- `indexer.test.ts`: `indexSession` writes chunks with the edited text and none from a hidden line. A mark written while the embedder runs (inside `embed`) leaves `indexed_at` unchanged, so the session is indexed again.
- `links.test.ts`: `sharedItem` lines carry the edited text and leave out hidden lines.
- `explain-later-home.test.ts`: `phraseForFlag` returns the edited words of the line.

Checks: typecheck, test.

### Review fixes

- `nameRecording` takes its first words from `studyLines` (first five lines), so a hidden line never becomes the title, which share links carry. Test: `recording-titles.test.ts`.
- `partUpdate`, the branch that keeps every line because a line has a mark: new pieces that overlap a changed line by more than 25% of their length are dropped, so the second pass does not repeat words still in an edited line. Unmarked overlap rules are unchanged. Test: `transcript.test.ts`.
- Accepted limit: marks from another phone that arrive after this phone has replaced the part point at old line times and are not shown. The replacement does not keep the old lines, so their marks have no line to attach to.

---

## T4 · Selecting words, and which words were explained

Branch `feat/t4-selection-core`, after T2 is merged. Files, and no others:

- `src/core/capture/selection.ts` (new)
- `src/core/capture/timeline.ts`
- `src/core/explain/excerpt.ts`
- `src/core/explain/explanations.ts`
- `test/selection.test.ts` (new)
- `test/timeline.test.ts`
- `test/explain.test.ts`

### excerpt.ts

Export the punctuation pattern: `const EDGE = …` becomes `export const EDGE = …`.

### explanations.ts

Add at the end:

```ts
export type ExplainedTerm = { id: string; t: number; term: string };

// Saved explanations of a recording's words (not of a page), to mark them in its transcript (note 1). t is the start of
// the line the words were selected in.
export function explainedInTranscript(db: SqlDb, sessionId: string): ExplainedTerm[] {
  return db.all<ExplainedTerm>(
    "SELECT id, t, term FROM explanations WHERE session_id = ? AND saved = 1 AND capture_id IS NULL ORDER BY created_at",
    [sessionId],
  );
}
```

### selection.ts (new)

```ts
import { WORD_MAX_CHARS } from "@waypoint/contracts";
import { EDGE, splitWords } from "../explain/excerpt.ts";
import type { LinePick } from "./marks.ts";

// A word in a transcript: the start of its line and its place among the line's words, from 0. Words are the tokens
// splitWords keeps as words, so punctuation on its own is not counted.
export type WordRef = { at: number; index: number };
// From the first selected word to the last, in time order.
export type Selection = { from: WordRef; to: WordRef };
export type Picked = { text: string; lines: LinePick[] };

export function compareRefs(a: WordRef, b: WordRef): number {
  return a.at - b.at || a.index - b.index;
}

export function refKey(ref: WordRef): string {
  return `${ref.at}:${ref.index}`;
}

// S2, without dragging (React Native text gives no word positions): the first tap picks a word, a tap on another word
// selects everything between, a tap on the picked word clears it, and a tap after a range starts again.
export function nextSelection(current: Selection | null, tapped: WordRef): Selection | null {
  if (current === null || compareRefs(current.from, current.to) !== 0) return { from: tapped, to: tapped };
  const order = compareRefs(tapped, current.from);
  if (order === 0) return null;
  return order < 0 ? { from: tapped, to: current.from } : { from: current.from, to: tapped };
}

export function isSelected(selection: Selection | null, ref: WordRef): boolean {
  return selection !== null && compareRefs(selection.from, ref) <= 0 && compareRefs(ref, selection.to) <= 0;
}

export function lineWordCount(text: string): number {
  return splitWords(text).filter((token) => token.word !== null).length;
}

// Every word of a paragraph: VoiceOver's "Select this paragraph". Null when it has no words.
export function paragraphSelection(lines: { at: number; text: string }[]): Selection | null {
  const worded = lines.filter((line) => lineWordCount(line.text) > 0);
  const first = worded[0];
  const last = worded.at(-1);
  if (first === undefined || last === undefined) return null;
  return { from: { at: first.at, index: 0 }, to: { at: last.at, index: lineWordCount(last.text) - 1 } };
}

// What a selection holds in the shown lines (in time order): its words as written, with spaces collapsed and punctuation
// trimmed from both ends, and each line's first and last selected word. A position past a line's end (the line was
// edited) stops at its last word.
export function pickedText(lines: { at: number; text: string }[], selection: Selection): Picked {
  const texts: string[] = [];
  const picked: LinePick[] = [];
  for (const line of lines) {
    if (line.at < selection.from.at || line.at > selection.to.at) continue;
    const tokens = splitWords(line.text);
    const words = tokens.flatMap((token, position) => (token.word === null ? [] : [position]));
    const from = line.at === selection.from.at ? selection.from.index : 0;
    const to = Math.min(line.at === selection.to.at ? selection.to.index : words.length - 1, words.length - 1);
    const start = words[from];
    const end = words[to];
    if (start === undefined || end === undefined || from > to) continue;
    texts.push(tokens.slice(start, end + 1).map((token) => token.text).join(""));
    picked.push({ at: line.at, from, to });
  }
  return { text: texts.join(" ").replace(/\s+/g, " ").replace(EDGE, ""), lines: picked };
}

// Explain takes a word or a phrase of up to 100 characters (the explain request's limit).
export function canExplain(text: string): boolean {
  return text !== "" && text.length <= WORD_MAX_CHARS;
}

// Note 1: saved explanations marked on the words they explain. An explanation is looked for in the line it was asked
// from (t is that line's start): the first place there where its words start, read on into the next lines for a phrase.
// Case and punctuation are ignored. Not found (the line was changed) means not marked. Returns refKey → explanation id.
export function explainedWords(lines: { at: number; text: string }[], explanations: { id: string; t: number; term: string }[]): Map<string, string> {
  const words: { ref: WordRef; key: string }[] = [];
  for (const line of lines) {
    let index = 0;
    for (const token of splitWords(line.text)) {
      if (token.word === null) continue;
      words.push({ ref: { at: line.at, index }, key: token.word.toLowerCase() });
      index += 1;
    }
  }
  const marked = new Map<string, string>();
  for (const explanation of explanations) {
    const term = splitWords(explanation.term).flatMap((token) => (token.word === null ? [] : [token.word.toLowerCase()]));
    if (term.length === 0) continue;
    for (let p = 0; p < words.length; p += 1) {
      if (words[p]?.ref.at !== explanation.t) continue;
      if (!term.every((word, i) => words[p + i]?.key === word)) continue;
      for (let i = 0; i < term.length; i += 1) {
        const hit = words[p + i];
        if (hit !== undefined) marked.set(refKey(hit.ref), explanation.id);
      }
      break;
    }
  }
  return marked;
}
```

### timeline.ts

Add `import type { LineMark } from "./marks.ts";`. At the end of the file, add:

```ts
// The lines as the person keeps them (Next 1): their words in place of what was heard, and hidden lines left out unless
// showHidden. Gaps, flags, photos and notes pass through.
export function applyMarks(items: TimelineItem[], marks: ReadonlyMap<number, LineMark>, showHidden: boolean): TimelineItem[] {
  return items.flatMap((item): TimelineItem[] => {
    if (item.kind !== "line") return [item];
    const mark = marks.get(item.at);
    if (mark === undefined) return [item];
    if (mark.hidden && !showHidden) return [];
    return [mark.text === null ? item : { ...item, text: mark.text }];
  });
}
```

### Tests

`test/selection.test.ts` (new):
- `nextSelection`: the first tap selects one word. A later word selects from the first word to it, in another line too. An earlier word selects from it to the first word. Tapping the same word clears the selection. A tap after a range starts a new one-word selection.
- `isSelected` is true at both ends of a range and false just outside.
- `pickedText` on `"Cells, divide. Then"` with words 0 to 1 gives `"Cells, divide"` and `{ at, from: 0, to: 1 }`. Across two lines, the text is joined with one space and the second line starts at 0. A line outside the range is skipped. A `to` past a shorter line stops at its last word.
- `canExplain`: "" is false, 100 characters is true, 101 is false.
- `paragraphSelection` runs from the first word of the first line to the last word of the last line, skips a line with no words, and returns null for no words.
- `explainedWords`: a word is marked in the line it was asked from, and the same word in another line is not. A phrase that runs into the next line is marked in both. "Mitosis," matches the term "mitosis". A term no longer in its line is not marked.

`test/timeline.test.ts`: `applyMarks` puts the edited text in place, leaves out a hidden line unless `showHidden`, and passes gaps, flags and photos through.

`test/explain.test.ts`: `explainedInTranscript` lists saved transcript explanations only, not unsaved ones and not ones with a `capture_id`.

Checks: typecheck, test.

### Review fixes

- Shared split: `wordsOf` in `selection.ts` is now `splitWords` from `excerpt.ts` with the null tokens dropped (punctuation on its own, and tokens over 100 characters). `lineWordCount`, `pickedText`, `paragraphSelection`, `explainedWords` and `marks.ts` `fitSpans` all use it, so one index means the same word in the renderer, in selection, in highlights and in explained-word marks. Picked text loses punctuation inside its words' edges (`Cells, divide` is sent as `Cells divide`).
- Performance: `explainedWords` records each line's first word position while it collects words. Each explanation's scan starts at its line and stops at the line's last word; a phrase can still run into the next line. Callers must memoize the result on `[lines, explanations]`, since each call rebuilds the word list.
- Known limit: scripts written without spaces (Chinese, Japanese, Thai) count a whole line as one word, so selection, highlights and explained-word marks work per line. A later change could split with `Intl.Segmenter` in the one shared function.
- For T7 to T9: hiding a line can regroup paragraphs, because `applyMarks` filters before `groupTimeline`. Picked text sent to Explain should leave out hidden lines unless they were shown and picked.

---

## T5 · Notes in the timeline, and the Note button

Branch `feat/t5-notes`, after T4 is merged. Files, and no others:

- `src/platform/db.ts`
- `src/core/capture/timeline.ts`
- `test/timeline.test.ts`
- `src/features/capture/TimelineMarks.tsx`
- `src/features/capture/NoteSheet.tsx` (new)
- `src/app/note.tsx` (new)
- `src/app/_layout.tsx`
- `src/features/capture/useRecording.ts`
- `src/features/capture/RecordScreen.tsx`
- `src/features/capture/SessionScreen.tsx`

### platform/db.ts

Add `useMemo` to the `react` import, and after `useQuery`:

```ts
// useQuery for a value that is built again on every read. The same content keeps the same object, so a screen that gets
// a write for every recorded line does not redraw for this. The value must survive JSON (arrays and plain objects).
export function useStableQuery<T>(read: (db: SqlDb) => T, key = ""): T {
  const json = useQuery((db) => JSON.stringify(read(db)), key);
  return useMemo(() => JSON.parse(json) as T, [json]);
}
```

### timeline.ts

1. Add to `TimelineItem`: `| { kind: "note"; key: string; at: number; id: string; text: string; quote: string }`.

2. Give `buildTimeline` a sixth parameter, `notes: { id: string; t: number; text: string; quote: string }[] = []`. Before the sort, add:

```ts
  notes.forEach((n) => items.push({ kind: "note", key: `note-${n.id}`, at: n.t, id: n.id, text: n.text, quote: n.quote }));
```

   Update its comment to "Finals, gaps, flags, photos and notes".

### TimelineMarks.tsx

1. The signature becomes `TimeMarkRow({ item, interactive = false, canChange = false }: { item: Exclude<TimelineItem, { kind: "line" }>; interactive?: boolean; canChange?: boolean })`. Add to the comment: "A note opens for changing where `canChange` is set (not for a viewer of a shared space)."

2. Add a case:

```tsx
    case "note":
      return (
        <View style={styles.line}>
          <Text style={[styles.time, { color: colors.ink3 }]}>{formatOffset(item.at)}</Text>
          <Pressable
            disabled={!canChange}
            accessibilityRole={canChange ? "button" : undefined}
            accessibilityLabel={canChange ? `Your note: ${item.text}. Opens the note` : `Note: ${item.text}`}
            onPress={() => router.push({ pathname: "/note", params: { id: item.id } })}
            style={[styles.note, { backgroundColor: colors.surface2, borderLeftColor: colors.accent }]}
          >
            {item.quote !== "" ? (
              <Text numberOfLines={2} style={[styles.quote, { color: colors.ink2 }]}>{`“${item.quote}”`}</Text>
            ) : null}
            <Text style={[styles.noteText, { color: colors.ink }]}>{item.text}</Text>
          </Pressable>
        </View>
      );
```

3. Styles: `note: { flex: 1, padding: 10, borderRadius: 12, borderLeftWidth: 3, gap: 4 }`, `quote: { fontSize: 14, fontStyle: "italic" }`, `noteText: { fontSize: 16, lineHeight: 22 }`.

### NoteSheet.tsx (new)

```tsx
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { addNote, deleteNote, getNote, NOTE_MAX_CHARS, QUOTE_MAX_CHARS, updateNote } from "../../core/capture/notes.ts";
import { formatOffset } from "../../core/format.ts";
import { dbGeneration, getDb, writeDbIf } from "../../platform/db.ts";
import { Caption, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const deps = { now: Date.now, newId: randomUUID };

// A note in a recording's timeline (note 13). New from the Note button or from selected words, or opened from the
// timeline to change or delete. The recording keeps running under this sheet.
export default function NoteSheet() {
  const colors = useColors();
  const params = useLocalSearchParams<{ id?: string; sessionId?: string; t?: string; quote?: string }>();
  const [generation] = useState(dbGeneration);
  const asked = params.id !== undefined && params.id !== "";
  const [existing] = useState(() => (asked && params.id !== undefined ? getNote(getDb(), params.id) : null));
  const [draft, setDraft] = useState(existing?.text ?? "");
  const sessionId = existing?.sessionId ?? params.sessionId ?? "";
  const t = existing?.t ?? (params.t === undefined || params.t === "" ? Number.NaN : Number(params.t));
  const quote = existing?.quote ?? (params.quote ?? "").slice(0, QUOTE_MAX_CHARS);
  const missing = (asked && existing === null) || sessionId === "" || !Number.isFinite(t);

  function save(): void {
    try {
      writeDbIf(generation, (db) => {
        if (existing !== null) updateNote(db, existing.id, draft);
        else addNote(db, deps, sessionId, t, draft, quote);
      });
    } catch {
      Alert.alert("Couldn't save this note.", "The recording may have been removed.");
      return;
    }
    router.back();
  }

  function remove(): void {
    if (existing === null) return;
    Alert.alert("Delete this note?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          writeDbIf(generation, (db) => deleteNote(db, existing.id));
          router.back();
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.sheet, { backgroundColor: colors.bg }]}>
      <View style={styles.topRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={10} onPress={() => router.back()} style={styles.action}>
          <Text style={[styles.actionText, { color: colors.ink2 }]}>Cancel</Text>
        </Pressable>
        {missing ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel="Save note" hitSlop={10} onPress={save} style={styles.action}>
            <Text style={[styles.actionText, { color: colors.accent }]}>Save</Text>
          </Pressable>
        )}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Title>Note</Title>
        <Caption>{missing ? "This note isn't here any more." : `At ${formatOffset(t)}`}</Caption>
        {quote !== "" ? <Text style={[styles.quote, { color: colors.ink2, borderLeftColor: colors.accent }]}>{`“${quote}”`}</Text> : null}
        {missing ? null : (
          <TextInput
            autoFocus
            multiline
            value={draft}
            onChangeText={setDraft}
            maxLength={NOTE_MAX_CHARS}
            placeholder="Type your note"
            placeholderTextColor={colors.ink4}
            accessibilityLabel="Note"
            textAlignVertical="top"
            style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]}
          />
        )}
        {existing !== null ? (
          <Pressable accessibilityRole="button" onPress={remove} style={styles.action}>
            <Text style={[styles.actionText, { color: colors.danger }]}>Delete note</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, padding: 20, gap: 12 },
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  action: { minHeight: 44, justifyContent: "center" },
  actionText: { fontSize: 17, fontWeight: "600" },
  body: { gap: 12, paddingBottom: 24 },
  quote: { fontSize: 15, fontStyle: "italic", borderLeftWidth: 3, paddingLeft: 10 },
  input: { minHeight: 140, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, fontSize: 17, lineHeight: 24 },
});
```

### app/note.tsx (new)

```ts
export { default } from "../features/capture/NoteSheet.tsx";
```

### _layout.tsx

After the `second-transcript` screen: `<Stack.Screen name="note" options={{ presentation: "formSheet" }} />`.

### useRecording.ts

1. Imports: `useStableQuery` from `../../platform/db.ts` (next to `writeDb`), and `notesForSession` from `../../core/capture/notes.ts`.

2. `RecordingModel`: add `note: () => void;`.

3. After the `toast` effect:

```ts
  // The session's notes, read from SQLite: a note is written by its sheet, and can be changed there later.
  const notes = useStableQuery((db) => (sessionRef.current === null ? [] : notesForSession(db, sessionRef.current.id)), sessionRef.current?.id ?? "");
```

4. After `flag()`:

```ts
  // Note (note 13): a sheet over the recording, at this moment in the timeline. The recording keeps running.
  function note(): void {
    const current = sessionRef.current;
    if (!current) return;
    const t = Date.now() - current.startedAt + clockOffsetRef.current;
    router.push({ pathname: "/note", params: { sessionId: current.id, t: String(t) } });
  }
```

5. `const timeline = useMemo(() => buildTimeline(live.finals, parts, resumes, flags, photos, notes), [live.finals, parts, resumes, flags, photos, notes]);`

6. Return `note,` from the hook.

### RecordScreen.tsx

1. In `Dock`, add a third action after Ask later: `<ActionButton label="Note" icon="note.text" onPress={model.note} />`.

2. In `TimelineRow`, a note opens from the live screen too. A viewer cannot record into a shared space (`SpacePickerScreen`), so the person recording can change it: `return <TimeMarkRow item={item} interactive={item.kind === "photo"} canChange />;`

3. In its comparison function, a note whose text changed must redraw. Replace the comparator with:

```ts
  (a, b) =>
    a.sessionId === b.sessionId &&
    (a.item === b.item ||
      (a.item.key === b.item.key &&
        (a.item.kind !== "note" || b.item.kind !== "note" || a.item.text === b.item.text) &&
        (a.item.kind !== "paragraph" ||
          b.item.kind !== "paragraph" ||
          a.item.lines.map((line) => line.key).join() === b.item.lines.map((line) => line.key).join()))),
```

### SessionScreen.tsx

1. Import `notesForSession` from `../../core/capture/notes.ts`. In `recordingTimeline`, return `buildTimeline(lines, parts, resumes, flags, photos, notesForSession(db, sessionId));`.

2. `<TimeMarkRow key={row.key} item={row} interactive canChange={role !== "viewer"} />`.

### Tests

`test/timeline.test.ts`:
- Notes come out in time order, with their text and quote.
- A note between two lines that would otherwise be one paragraph splits them (`groupTimeline`), as a flag does.

Checks: typecheck, test, export:ios.

### Review fixes

- `useRecording.ts`: `note()` does nothing while the recording is stopping, or while a note sheet is already open. The open flag is a ref set when the sheet is pushed and cleared by `useFocusEffect` inside the hook, which runs when the record screen is focused again.
- `TimelineMarks.tsx`: a note the person cannot change is a plain `View` with `accessible` and the label "Note: <text>", not a disabled Pressable.
- `NoteSheet.tsx`: `save()` shows "Couldn't save the note." and keeps the sheet open when `writeDbIf` returns undefined (the account changed). Saving an existing note with its text blanked asks first, with the Delete confirmation, and deletes it on confirm.

---

## T6 · Who's talking?

Branch `feat/t6-speakers`, after T2 is merged. Files, and no others:

- `src/features/capture/SpeakerSheet.tsx` (new)
- `src/app/speaker.tsx` (new)
- `src/app/_layout.tsx`

The sheet opens with `sessionId` and `lines`, a comma-separated list of line starts. T7 opens it from the selection bar and from a name's label. The board's "Use for all Speaker 1 lines / In this session only" needs groups of voices, which the app does not have (decision 9). The choice here is "Only these lines" or "Until the next name".

### SpeakerSheet.tsx (new)

```tsx
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { cleanName, lineMarks, linesToName, SEVERAL, setSpeaker, SPEAKER_MAX_CHARS, speakerNames } from "../../core/capture/marks.ts";
import { listSegments } from "../../core/capture/segments.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { getSpace } from "../../core/db/spaces.ts";
import { dbGeneration, useQuery, writeDbIf } from "../../platform/db.ts";
import { Caption, PrimaryButton, Row, SecondaryButton, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

const deps = { now: Date.now };

// S14 and notes 2, 3 and 19: who said the chosen lines. A name saved in this space is one tap, and Several people is for a
// group. Names are kept as words on the lines, never anything about a voice.
export default function SpeakerSheet() {
  const colors = useColors();
  const params = useLocalSearchParams<{ sessionId: string; lines?: string }>();
  const sessionId = params.sessionId;
  const starts = (params.lines ?? "")
    .split(",")
    .filter((part) => part !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
  const [generation] = useState(dbGeneration);
  const [choice, setChoice] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"these" | "until">("these");
  const data = useQuery((db) => {
    const session = getSession(db, sessionId);
    if (session === null) return null;
    const marks = new Map(lineMarks(db, sessionId).map((mark) => [mark.tStart, mark]));
    const names = new Set(starts.map((t) => marks.get(t)?.speaker ?? null));
    const [only] = [...names];
    return {
      spaceName: getSpace(db, session.spaceId)?.name ?? "",
      saved: speakerNames(db, session.spaceId),
      current: names.size === 1 ? (only ?? null) : null,
      lines: listSegments(db, sessionId).map((line) => ({ tStart: line.tStart, speaker: marks.get(line.tStart)?.speaker ?? null })),
    };
  }, `${sessionId}|${params.lines ?? ""}`);

  if (data === null || starts.length === 0) {
    return (
      <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
        <Caption>These lines aren't here any more.</Caption>
        <SecondaryButton label="Close" onPress={() => router.back()} />
      </View>
    );
  }

  const chosen = typing ? cleanName(draft) : (choice ?? data.current);
  const pick = (name: string): void => {
    setTyping(false);
    setChoice(name);
  };
  const check = (name: string) => (!typing && chosen === name ? <SymbolView name="checkmark" tintColor={colors.accent} size={16} /> : null);

  function save(name: string | null): void {
    if (data === null) return;
    const lines = name !== null && scope === "until" ? linesToName(data.lines, starts) : starts;
    try {
      writeDbIf(generation, (db) => setSpeaker(db, deps, sessionId, lines, name));
    } catch {
      Alert.alert("Couldn't save this name.");
      return;
    }
    router.back();
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.sheet}>
      <Title>Who's talking?</Title>
      <Caption>{`Saved in ${data.spaceName}`}</Caption>
      {data.saved.map((name) => (
        <Row key={name} title={name} selected={!typing && chosen === name} right={check(name)} onPress={() => pick(name)} />
      ))}
      <Row title="Several people" selected={!typing && chosen === SEVERAL} right={check(SEVERAL)} onPress={() => pick(SEVERAL)} />
      {typing ? (
        <TextInput
          autoFocus
          value={draft}
          onChangeText={setDraft}
          maxLength={SPEAKER_MAX_CHARS}
          placeholder="Name"
          placeholderTextColor={colors.ink4}
          accessibilityLabel="New name"
          returnKeyType="done"
          style={[styles.input, { color: colors.ink, borderColor: colors.line, backgroundColor: colors.surface }]}
        />
      ) : (
        <Row title="+ New name" onPress={() => setTyping(true)} />
      )}
      <View style={styles.switchRow}>
        {(
          [
            ["these", "Only these lines"],
            ["until", "Until the next name"],
          ] as const
        ).map(([value, label]) => {
          const active = scope === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setScope(value)}
              style={[styles.switchItem, { backgroundColor: active ? colors.accentSoft : colors.surface2 }]}
            >
              <Text style={[styles.switchText, { color: colors.ink }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Caption>You choose each name. NotePath does not identify people by voice or keep voice data between sessions.</Caption>
      <PrimaryButton
        label="Save name"
        disabled={chosen === null}
        onPress={() => {
          if (chosen !== null) save(chosen);
        }}
      />
      {data.current !== null ? <SecondaryButton label="Remove name" onPress={() => save(null)} /> : null}
      <SecondaryButton label="Cancel" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 20, gap: 12, paddingBottom: 40 },
  input: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, fontSize: 17 },
  switchRow: { flexDirection: "row", gap: 8 },
  switchItem: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  switchText: { fontSize: 15, fontWeight: "600", textAlign: "center" },
});
```

### app/speaker.tsx (new)

```ts
export { default } from "../features/capture/SpeakerSheet.tsx";
```

### _layout.tsx

After the `note` screen: `<Stack.Screen name="speaker" options={{ presentation: "formSheet" }} />`.

No unit tests: the logic is in `marks.ts` (T2). Checks: typecheck, test, export:ios.

---

## T7 · The selection bar, highlights, definition marks and hiding, in a saved session

Branch `feat/t7-selection-bar`, after T3, T4, T5 and T6 are merged. Files, and no others:

- `src/features/capture/ParagraphRow.tsx`
- `src/features/capture/SelectionBar.tsx` (new)
- `src/features/capture/selectionModel.ts` (new)
- `src/features/capture/SessionScreen.tsx`
- `src/features/capture/RecordScreen.tsx`
- `src/core/explain/excerpt.ts`
- `src/features/explain/ExplainSheet.tsx`
- `test/explain.test.ts`

A tap on a word now selects it, and Explain is in the bar. A tap on a word that was explained, with nothing selected, reopens its saved answer. The live screen keeps tap-to-explain until T8.

### ParagraphRow.tsx

Replace the file:

```tsx
import { Fragment } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { speakerLabel, type LineMark } from "../../core/capture/marks.ts";
import { isSelected, refKey, type Selection, type WordRef } from "../../core/capture/selection.ts";
import type { TimelineLine } from "../../core/capture/timeline.ts";
import { splitWords } from "../../core/explain/excerpt.ts";
import { formatOffset } from "../../core/format.ts";
import { useColors, type Colors } from "../../ui/theme.ts";

// What a paragraph draws on its words: the person's marks by line start, explained words (refKey → explanation id), and
// the selection.
export type ParagraphView = { marks: ReadonlyMap<number, LineMark>; explained: ReadonlyMap<string, string>; selection: Selection | null };
const NO_VIEW: ParagraphView = { marks: new Map(), explained: new Map(), selection: null };

// A paragraph of a transcript: one time above it, then its lines as running text. A line's name shows before it when it
// is not the name of the line before. With `onPlay`, the time plays the recording from there.
export function ParagraphRow({
  at,
  lines,
  onWord,
  onPlay,
  lit = false,
  onLayout,
  view = NO_VIEW,
  onSpeaker,
  onSelectParagraph,
}: {
  at: number;
  lines: TimelineLine[];
  onWord: (ref: WordRef, word: string) => void;
  onPlay?: (() => void) | undefined;
  lit?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  view?: ParagraphView;
  onSpeaker?: ((at: number) => void) | undefined;
  onSelectParagraph?: (() => void) | undefined;
}) {
  const colors = useColors();
  const time = <Text style={[styles.time, { color: onPlay ? colors.accent : colors.ink3 }]}>{formatOffset(at)}</Text>;
  const timeRow = onPlay ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`Play from ${formatOffset(at)}`} hitSlop={12} onPress={onPlay} style={styles.timeButton}>
      {time}
    </Pressable>
  ) : (
    time
  );
  return (
    <View onLayout={onLayout} style={[styles.paragraph, lit ? [styles.lit, { backgroundColor: colors.accentSoft }] : null]}>
      {timeRow}
      <Text
        accessibilityHint="Tap a word to select it"
        accessibilityActions={onSelectParagraph ? [{ name: "select", label: "Select this paragraph" }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "select") onSelectParagraph?.();
        }}
        style={[styles.text, { color: colors.ink }]}
      >
        {lines.map((line, index) => {
          const mark = view.marks.get(line.at);
          const speaker = mark?.speaker ?? null;
          const previous = lines[index - 1];
          const before = previous === undefined ? null : (view.marks.get(previous.at)?.speaker ?? null);
          const label = speaker !== null && (index === 0 || speaker !== before) ? speaker : null;
          return (
            <Fragment key={line.key}>
              {index > 0 ? " " : null}
              {label !== null ? (
                <Text onPress={onSpeaker ? () => onSpeaker(line.at) : undefined} style={[styles.speaker, { color: colors.ink2 }]}>
                  {`${speakerLabel(label)}: `}
                </Text>
              ) : null}
              <LineWords line={line} mark={mark} view={view} colors={colors} onWord={onWord} />
            </Fragment>
          );
        })}
      </Text>
    </View>
  );
}

// One line's words. Selected words are tinted, highlighted words are yellow, explained words are underlined, and a hidden
// line (shown with Show hidden lines) is faint.
function LineWords({
  line,
  mark,
  view,
  colors,
  onWord,
}: {
  line: TimelineLine;
  mark: LineMark | undefined;
  view: ParagraphView;
  colors: Colors;
  onWord: (ref: WordRef, word: string) => void;
}) {
  let index = -1;
  return (
    <Text style={mark?.hidden === true ? { color: colors.ink4 } : undefined}>
      {splitWords(line.text).map((token, position) => {
        const word = token.word;
        if (word === null) return token.text;
        index += 1;
        const ref = { at: line.at, index };
        const highlighted = mark?.highlights.some(([from, to]) => from <= ref.index && ref.index <= to) === true;
        const background = isSelected(view.selection, ref) ? colors.accentSoft : highlighted ? colors.flagSoft : undefined;
        return (
          <Text
            key={position}
            onPress={() => onWord(ref, word)}
            suppressHighlighting={false}
            style={[
              background === undefined ? null : { backgroundColor: background },
              view.explained.has(refKey(ref)) ? [styles.explained, { textDecorationColor: colors.accent }] : null,
            ]}
          >
            {token.text}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  paragraph: { gap: 6 },
  lit: { borderRadius: 10, paddingHorizontal: 6, marginHorizontal: -6 },
  timeButton: { alignSelf: "flex-start" },
  time: { fontSize: 13, fontVariant: ["tabular-nums"] },
  text: { fontSize: 17, lineHeight: 26 },
  speaker: { fontWeight: "700" },
  explained: { textDecorationLine: "underline", textDecorationStyle: "dotted" },
});
```

### SelectionBar.tsx (new)

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useColors } from "../../ui/theme.ts";

// S2: one bar for the selected words, while recording and after. It has Explain, Highlight and Note, and More for
// who's talking and hiding lines. A viewer of a shared space gets Explain only. The recording keeps running under it.
// `inset`: the bar sits at the bottom of the screen and keeps clear of the home indicator.
export function SelectionBar({
  text,
  single,
  canChange,
  canExplain,
  highlighted,
  inset = true,
  onExplain,
  onHighlight,
  onNote,
  onMore,
  onClose,
}: {
  text: string;
  single: boolean;
  canChange: boolean;
  canExplain: boolean;
  highlighted: boolean;
  inset?: boolean;
  onExplain: () => void;
  onHighlight: () => void;
  onNote: () => void;
  onMore: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderColor: colors.line, marginHorizontal: inset ? 12 : 0, paddingBottom: 10 + (inset ? insets.bottom : 0) },
      ]}
    >
      <View style={styles.head}>
        <Text numberOfLines={2} style={[styles.quote, { color: colors.ink2 }]}>{`“${text}”`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Clear selection" onPress={onClose} style={styles.close}>
          <SymbolView name="xmark" tintColor={colors.ink3} size={16} />
        </Pressable>
      </View>
      {single ? <Text style={[styles.hint, { color: colors.ink3 }]}>Tap another word to select up to it.</Text> : null}
      {canExplain ? null : <Text style={[styles.hint, { color: colors.ink3 }]}>Select fewer words to explain.</Text>}
      <View style={styles.actions}>
        <BarButton label="Explain" icon="lightbulb" disabled={!canExplain} onPress={onExplain} />
        {canChange ? (
          <>
            <BarButton label={highlighted ? "Unhighlight" : "Highlight"} icon="highlighter" onPress={onHighlight} />
            <BarButton label="Note" icon="note.text" onPress={onNote} />
            <BarButton label="More" icon="ellipsis" onPress={onMore} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function BarButton({ label, icon, disabled = false, onPress }: { label: string; icon: SFSymbol; disabled?: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { opacity: disabled ? 0.4 : 1 }]}
    >
      <SymbolView name={icon} tintColor={colors.accent} size={20} />
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 6, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  quote: { flex: 1, fontSize: 15, fontStyle: "italic" },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hint: { fontSize: 13 },
  actions: { flexDirection: "row", justifyContent: "space-around" },
  button: { minWidth: 64, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 4 },
  label: { fontSize: 13, fontWeight: "600" },
});
```

### selectionModel.ts (new)

This is shared by the saved session and the live screen (T8). It is plain code, not a hook, so a screen can call it after its early return.

```ts
import { Alert } from "react-native";
import { router } from "expo-router";
import { coversSpan, setHidden, speakerRun, toggleHighlight, type LineMark } from "../../core/capture/marks.ts";
import { canExplain, nextSelection, pickedText, refKey, type Picked, type Selection, type WordRef } from "../../core/capture/selection.ts";
import type { TimelineLine } from "../../core/capture/timeline.ts";
import type { ExplainedTerm } from "../../core/explain/explanations.ts";
import { writeDb } from "../../platform/db.ts";

const deps = { now: Date.now };

export type SelectionInput = {
  sessionId: string | null;
  lines: TimelineLine[]; // the shown lines, in time order
  marks: ReadonlyMap<number, LineMark>;
  explained: ReadonlyMap<string, string>; // refKey → explanation id
  explanations: ExplainedTerm[];
  selection: Selection | null;
  setSelection: (next: Selection | null) => void;
  onSelect?: (() => void) | undefined; // the live screen stops following new lines
};

export type SelectionModel = {
  picked: Picked | null;
  single: boolean;
  highlighted: boolean;
  canExplain: boolean;
  tapWord: (ref: WordRef) => void;
  explain: () => void;
  highlight: () => void;
  note: () => void;
  more: () => void;
  renameRun: (at: number) => void;
};

// The selection and what the bar does with it (S2).
export function selectionModel(input: SelectionInput): SelectionModel {
  const { sessionId, lines, marks, explained, explanations, selection, setSelection } = input;
  const found = selection === null ? null : pickedText(lines.map((line) => ({ at: line.at, text: line.text })), selection);
  const picked = found !== null && found.lines.length > 0 ? found : null;
  const starts = picked?.lines.map((line) => line.at) ?? [];

  function nameLines(at: number[]): void {
    if (sessionId === null || at.length === 0) return;
    setSelection(null);
    router.push({ pathname: "/speaker", params: { sessionId, lines: at.join(",") } });
  }

  return {
    picked,
    single: selection !== null && refKey(selection.from) === refKey(selection.to),
    highlighted: picked !== null && picked.lines.every((line) => coversSpan(marks.get(line.at)?.highlights ?? [], [line.from, line.to])),
    canExplain: picked !== null && canExplain(picked.text),
    // With nothing selected, a word that was explained opens its saved answer (note 1).
    tapWord: (ref) => {
      if (sessionId === null) return;
      if (selection === null) {
        const id = explained.get(refKey(ref));
        const saved = explanations.find((e) => e.id === id);
        if (saved !== undefined) {
          router.push({ pathname: "/explain", params: { sessionId, t: String(saved.t), word: saved.term, explanationId: saved.id } });
          return;
        }
      }
      input.onSelect?.();
      setSelection(nextSelection(selection, ref));
    },
    // The excerpt is taken around the first selected line (t), as for one tapped word.
    explain: () => {
      const first = picked?.lines[0];
      if (sessionId === null || picked === null || first === undefined || !canExplain(picked.text)) return;
      setSelection(null);
      router.push({ pathname: "/explain", params: { sessionId, t: String(first.at), word: picked.text } });
    },
    highlight: () => {
      if (sessionId === null || picked === null) return;
      writeDb((db) => toggleHighlight(db, deps, sessionId, picked.lines));
      setSelection(null);
    },
    // A note made from words goes right after the line they end in.
    note: () => {
      const last = picked?.lines.at(-1);
      if (sessionId === null || picked === null || last === undefined) return;
      const end = lines.find((line) => line.at === last.at)?.end ?? last.at;
      setSelection(null);
      router.push({ pathname: "/note", params: { sessionId, t: String(end), quote: picked.text } });
    },
    more: () => {
      if (sessionId === null || picked === null) return;
      const allHidden = starts.every((t) => marks.get(t)?.hidden === true);
      Alert.alert("Selected words", undefined, [
        { text: "Who's talking?", onPress: () => nameLines(starts) },
        {
          text: allHidden ? "Show these lines" : "Hide these lines",
          onPress: () => {
            writeDb((db) => setHidden(db, deps, sessionId, starts, !allHidden));
            setSelection(null);
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    // A tapped name changes the name of the run of lines it labels.
    renameRun: (at) => nameLines(speakerRun(lines.map((line) => ({ tStart: line.at, speaker: marks.get(line.at)?.speaker ?? null })), at)),
  };
}
```

### SessionScreen.tsx

1. Imports: add `lineMarks` from `../../core/capture/marks.ts`; `explainedWords`, `paragraphSelection`, `type Selection` from `../../core/capture/selection.ts`; `explainedInTranscript` from `../../core/explain/explanations.ts`; `SelectionBar` from `./SelectionBar.tsx`; `selectionModel` from `./selectionModel.ts`. Change the timeline import to `applyMarks, buildTimeline, groupTimeline, type TimelineItem, type TimelineLine`.

2. In the `useQuery` read, after `second`:

```ts
      marks: session.kind === "recording" && !live ? lineMarks(db, id) : [],
      explanations: session.kind === "recording" && !live ? explainedInTranscript(db, id) : [],
```

   Add `explanations` to the destructuring of `data`.

3. After `const [lit, setLit] = useState<string | null>(null);`:

```ts
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showHidden, setShowHidden] = useState(false);
```

4. Replace `const lines = timeline.filter((item): item is Extract<TimelineItem, { kind: "line" }> => item.kind === "line");` with:

```ts
  // The transcript as the person keeps it (Next 1): their words, highlights and names, with hidden lines left out unless shown.
  const marks = new Map(data.marks.map((mark) => [mark.tStart, mark]));
  const hiddenCount = data.marks.filter((mark) => mark.hidden).length;
  const shown = applyMarks(timeline, marks, showHidden);
  const lines = shown.filter((item): item is TimelineLine => item.kind === "line");
  const explained = explainedWords(lines.map((line) => ({ at: line.at, text: line.text })), explanations);
  const canChange = role !== "viewer";
  const view = { marks, explained, selection };
  const selected = selectionModel({ sessionId: id, lines, marks, explained, explanations, selection, setSelection });
```

5. In the "On this iPhone / Better transcript" switch, change its `onPress` to:

```tsx
                  onPress={() => {
                    setSelection(null);
                    setShowSecond(index === 1);
                  }}
```

6. Right after that switch block (before `{second !== null && showSecond ? (`), add:

```tsx
        {session.kind === "recording" && !showSecond && (hiddenCount > 0 || showHidden) ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              setSelection(null);
              setShowHidden(!showHidden);
            }}
            style={styles.hiddenRow}
          >
            <Text style={[styles.toggle, { color: colors.accent }]}>
              {showHidden ? "Hide hidden lines" : `Show ${countLabel(hiddenCount, "hidden line", "hidden lines")}`}
            </Text>
          </Pressable>
        ) : null}
```

7. Replace `groupTimeline(timeline).map((row) =>` with `groupTimeline(shown).map((row) =>`. In the `ParagraphRow` there, replace the `onWord` prop and add the new props:

```tsx
                view={view}
                onWord={selected.tapWord}
                onSpeaker={canChange ? selected.renameRun : undefined}
                onSelectParagraph={() => setSelection(paragraphSelection(row.lines))}
```

8. Right after `</ScrollView>`:

```tsx
      {selected.picked !== null && !showSecond ? (
        <SelectionBar
          text={selected.picked.text}
          single={selected.single}
          canChange={canChange}
          canExplain={selected.canExplain}
          highlighted={selected.highlighted}
          onExplain={selected.explain}
          onHighlight={selected.highlight}
          onNote={selected.note}
          onMore={selected.more}
          onClose={() => setSelection(null)}
        />
      ) : null}
```

9. Styles: `hiddenRow: { minHeight: 44, justifyContent: "center" }`. Replace the T5 `canChange={role !== "viewer"}` on `TimeMarkRow` with `canChange={canChange}`.

### RecordScreen.tsx

Keep tap-to-explain on the live screen until T8. In `TimelineRow`'s `ParagraphRow`:

```tsx
        onWord={(ref, word) => {
          if (sessionId !== null) router.push({ pathname: "/explain", params: { sessionId, t: String(ref.at), word } });
        }}
```

### excerpt.ts and ExplainSheet.tsx

Explain takes a phrase. The API already says "a word or phrase", up to 100 characters (`WORD_MAX_CHARS`), so there is no server change. Only the sheet's wording changes:

```ts
// What the Explain sheet says is sent and what it says when there is nothing to send, for a recording line or a page.
// A phrase (selected words) says "these words".
export function contextCopy(isPage: boolean, phrase = false): { sent: string; missing: string } {
  const what = phrase ? "these words" : "this word";
  return isPage
    ? { sent: `NotePath sends ${what} and the text of this page, for this task only.`, missing: `There isn't any text from this page to explain ${what} with.` }
    : {
        sent: `NotePath sends ${what} and about a minute of the transcript around ${phrase ? "them" : "it"}, for this task only.`,
        missing: `There isn't enough of the transcript around ${what} yet.`,
      };
}
```

In `ExplainSheet.tsx`, both calls become `contextCopy(resolvedPageId !== undefined, word.includes(" "))`.

### Tests

`test/explain.test.ts`: `contextCopy(false, true).sent` says "these words" and "around them". `contextCopy(false).sent` is unchanged.

Selection and marking logic is tested in T4. Checks: typecheck, test, export:ios. By hand: select a phrase across two paragraphs and Explain it. The answer is saved and underlined, and tapping it reopens the answer. Highlight, then Unhighlight. Hide two lines; they leave the transcript and "Show 2 hidden lines" appears. A viewer gets Explain only.

### Review fixes

- Redraw: the rows, and each paragraph's slice of the marks and explained words (`paragraphSlice`), are memoized on the data, and the handlers the rows get are stable (`modelRef` holds the latest selection model). `ParagraphRow` is `memo`, and each line's words are a memoized `LineWords`. A tap redraws only the paragraphs whose selection slice changed.
- Stale selection: a selection whose words were hidden or removed by an edit or sync picks nothing (`liveSelection`). The screen clears it in an effect, and a tap starts a new selection rather than extending the stale one.
- VoiceOver: "Select this paragraph" announces "Paragraph selected. Actions are at the bottom." The paragraph hint is "Tap a word to select it", or "Tap a word to explain it" for a viewer. A speaker's name is a button labelled "Speaker: <name>. Change speaker".
- The selection bar's actions wrap, so large text sizes do not clip them.
- Known limits: VoiceOver can select a paragraph, not single words. A viewer can still open a paid Explain from a word, as before T7 (owner decision pending).

---

## T8 · The selection bar while recording

Branch `feat/t8-live-selection`, after T7 is merged. Files, and no others:

- `src/features/capture/RecordScreen.tsx`

New lines keep arriving while words are selected. A row redraws only when what it draws changes (`rowSig`), so the paragraphs above the live end stay as they are. Nothing here runs on a timer. The marks query runs after each write (each finished line), as `FolderPill`'s does, and is read through `useStableQuery`, so an unchanged result causes no redraw.

1. Imports: add `countLabel` to the `format.ts` import; `lineMarks, type LineMark` from `../../core/capture/marks.ts`; `explainedWords, paragraphSelection, refKey, type Selection, type WordRef` from `../../core/capture/selection.ts`; `explainedInTranscript, type ExplainedTerm` from `../../core/explain/explanations.ts`; `type SqlDb` from `../../core/db/sql.ts`; `useStableQuery` next to `useQuery`; `ParagraphRow, type ParagraphView` in place of the plain `ParagraphRow` import; `SelectionBar` from `./SelectionBar.tsx`; `selectionModel` from `./selectionModel.ts`. Change the timeline import to `applyMarks, groupTimeline, PARAGRAPH_PAUSE_MS, type TimelineLine, type TimelineRow as Row`.

2. Add above `Transcript`:

```ts
type Extras = { marks: LineMark[]; explanations: ExplainedTerm[] };

// The person's marks and saved answers for the live screen, read again after every write.
function transcriptExtras(db: SqlDb, sessionId: string | null): Extras {
  return sessionId === null ? { marks: [], explanations: [] } : { marks: lineMarks(db, sessionId), explanations: explainedInTranscript(db, sessionId) };
}

type RowActions = { word: (ref: WordRef) => void; speaker: (at: number) => void; selectLines: (lines: TimelineLine[]) => void };

// Everything a row draws, as text. A row redraws only when this changes.
function rowSig(item: Row, view: ParagraphView): string {
  if (item.kind === "note") return `${item.key}|${item.text}|${item.quote}`;
  if (item.kind !== "paragraph") return item.key;
  const { selection } = view;
  const explained = [...view.explained.keys()];
  return item.lines
    .map((line) => {
      const mark = view.marks.get(line.at);
      const chosen = selection !== null && line.at >= selection.from.at && line.at <= selection.to.at ? `${refKey(selection.from)}-${refKey(selection.to)}` : "";
      const words = explained.filter((key) => key.startsWith(`${line.at}:`)).join(",");
      return `${line.key}|${line.text}|${mark === undefined ? "" : JSON.stringify(mark)}|${chosen}|${words}`;
    })
    .join("\n");
}
```

3. In `Transcript`, replace `const rows = useMemo(() => groupTimeline(model.timeline), [model.timeline]);` with:

```ts
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const extras = useStableQuery((db) => transcriptExtras(db, model.sessionId), model.sessionId ?? "");
  const marks = useMemo(() => new Map(extras.marks.map((mark) => [mark.tStart, mark])), [extras.marks]);
  const timeline = useMemo(() => applyMarks(model.timeline, marks, showHidden), [model.timeline, marks, showHidden]);
  const rows = useMemo(() => groupTimeline(timeline), [timeline]);
  const lines = useMemo(() => timeline.filter((item): item is TimelineLine => item.kind === "line"), [timeline]);
  const explained = useMemo(
    () => explainedWords(lines.map((line) => ({ at: line.at, text: line.text })), extras.explanations),
    [lines, extras.explanations],
  );
  const view = useMemo<ParagraphView>(() => ({ marks, explained, selection }), [marks, explained, selection]);
  const sigs = useMemo(() => rows.map((row) => rowSig(row, view)), [rows, view]);
  const hiddenCount = extras.marks.filter((mark) => mark.hidden).length;
```

   `setFollowing` is declared below these lines. Leave it where it is: `selectionModel` is called after it (step 4).

4. After `function readPosition(…) {…}`:

```ts
  // A viewer cannot record into a shared space (SpacePickerScreen), so the person recording can change everything here.
  const selected = selectionModel({
    sessionId: model.sessionId,
    lines,
    marks,
    explained,
    explanations: extras.explanations,
    selection,
    setSelection,
    // Words chosen while new lines arrive stay in view: the list stops following until Jump to live.
    onSelect: () => setFollowing(false),
  });
  // Rows are memoized, so they call the latest model through this.
  const latest = useRef(selected);
  latest.current = selected;
  const [actions] = useState<RowActions>(() => ({
    word: (ref) => latest.current.tapWord(ref),
    speaker: (at) => latest.current.renameRun(at),
    selectLines: (rowLines) => setSelection(paragraphSelection(rowLines)),
  }));
```

   `useRef` and `useState` are already imported. These hooks run on every render, because `Transcript` has no early return.

5. Under `<Title>{model.title}</Title>`:

```tsx
      {hiddenCount > 0 || showHidden ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            setSelection(null);
            setShowHidden(!showHidden);
          }}
          style={styles.hiddenRow}
        >
          <Text style={[styles.hiddenText, { color: colors.accent }]}>
            {showHidden ? "Hide hidden lines" : `Show ${countLabel(hiddenCount, "hidden line", "hidden lines")}`}
          </Text>
        </Pressable>
      ) : null}
```

6. Replace the rows map:

```tsx
        {rows.map((item, i) => (
          <TimelineRow key={item.key} item={item} sig={sigs[i] ?? ""} view={view} actions={actions} />
        ))}
```

7. Jump to live does not show under the bar: `{showJump && selected.picked === null ? (`.

8. After the toast block, at the end of `transcriptArea`:

```tsx
      {selected.picked !== null ? (
        <SelectionBar
          text={selected.picked.text}
          single={selected.single}
          canChange
          canExplain={selected.canExplain}
          highlighted={selected.highlighted}
          inset={false}
          onExplain={selected.explain}
          onHighlight={selected.highlight}
          onNote={selected.note}
          onMore={selected.more}
          onClose={() => setSelection(null)}
        />
      ) : null}
```

9. Replace `TimelineRow`:

```tsx
type TimelineRowProps = { item: Row; sig: string; view: ParagraphView; actions: RowActions };

const TimelineRow = memo(
  function TimelineRow({ item, view, actions }: TimelineRowProps) {
    if (item.kind !== "paragraph") return <TimeMarkRow item={item} interactive={item.kind === "photo"} canChange />;
    return (
      <ParagraphRow
        at={item.at}
        lines={item.lines}
        view={view}
        onWord={actions.word}
        onSpeaker={actions.speaker}
        onSelectParagraph={() => actions.selectLines(item.lines)}
      />
    );
  },
  // Only what the row draws: new lines keep arriving while recording, and every other row stays as it is.
  (a, b) => a.sig === b.sig && a.actions === b.actions,
);
```

10. Styles: `hiddenRow: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }`, `hiddenText: { fontSize: 15, fontWeight: "600" }`.

No unit tests (the logic is tested in T4 and T2). Checks: typecheck, test, export:ios. By hand, on a phone, with a recording running: select words, Highlight, Note, and Explain. New lines keep arriving, the selected words stay in view, and "Jump to live" shows after the bar closes. Lock the phone for a minute while recording and confirm that nothing new runs in the background.

---

## T9 · The Edit switch in a saved session

Branch `feat/t9-edit-session`, after T7 is merged. Files, and no others:

- `src/features/capture/EditingBar.tsx` (new)
- `src/features/capture/useLineEditor.ts` (new)
- `src/features/capture/ParagraphRow.tsx`
- `src/features/capture/SessionScreen.tsx`

With Edit on, each line is a tap target. Tapping a line opens just that line as a text field, with the cursor at its end. Only one field is open at a time, which is light even for an hour of transcript. Opening another line, the keyboard's Done, leaving the line, Done in the bar, or leaving the screen saves it. Undo under an edited line brings back what was heard.

### EditingBar.tsx (new)

```tsx
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useColors } from "../../ui/theme.ts";

// The Edit switch (note 12): the whole transcript becomes typeable, while recording and after class.
export function EditSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const colors = useColors();
  return (
    <View style={styles.switch}>
      <Text style={[styles.switchLabel, { color: colors.ink }]}>Edit</Text>
      <Switch accessibilityLabel="Edit transcript" value={on} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.surface3 }} />
    </View>
  );
}

// Shown while Edit is on (S4, S13).
export function EditingBar({ hint, onDone }: { hint: string; onDone: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.bar, { backgroundColor: colors.accentSoft }]}>
      <SymbolView name="pencil" tintColor={colors.accent} size={16} />
      <View style={styles.flex}>
        <Text style={[styles.title, { color: colors.ink }]}>Editing transcript</Text>
        <Text style={[styles.body, { color: colors.ink2 }]}>{hint}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Done editing" hitSlop={8} onPress={onDone} style={styles.done}>
        <Text style={[styles.doneText, { color: colors.accent }]}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  switchLabel: { fontSize: 16, fontWeight: "600" },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14 },
  flex: { flex: 1 },
  title: { fontSize: 15, fontWeight: "700" },
  body: { fontSize: 14, lineHeight: 19 },
  done: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  doneText: { fontSize: 16, fontWeight: "600" },
});
```

### useLineEditor.ts (new)

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { editLine } from "../../core/capture/marks.ts";
import { writeDb } from "../../platform/db.ts";

const deps = { now: Date.now };

export type LineEditor = {
  on: boolean;
  open: number | null;
  setOn: (on: boolean) => void;
  openLine: (at: number) => void;
  typed: (text: string) => void;
  blurLine: (at: number) => void;
  undoLine: (at: number) => void;
};

// Edit (S4, S13, note 12): one line is open for typing at a time. Opening another line, the line losing the keyboard,
// turning Edit off, or leaving the screen saves it. The heard words stay in segments (editLine). textOf gives a line's
// shown text, so an unchanged line writes nothing.
export function useLineEditor(sessionId: string | null, textOf: (at: number) => string | null): LineEditor {
  const [on, setOnState] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const openRef = useRef<number | null>(null);
  const typedRef = useRef<string | null>(null);
  const sessionRef = useRef(sessionId);
  const textOfRef = useRef(textOf);
  sessionRef.current = sessionId;
  textOfRef.current = textOf;

  const save = useCallback((): void => {
    const id = sessionRef.current;
    const at = openRef.current;
    const text = typedRef.current;
    typedRef.current = null;
    if (id === null || at === null || text === null || text === textOfRef.current(at)) return;
    try {
      writeDb((db) => editLine(db, deps, id, at, text));
    } catch {
      // The notes closed (sign-out) or the session went away: there is nowhere to keep it.
    }
  }, []);
  const show = useCallback((at: number | null): void => {
    openRef.current = at;
    setOpen(at);
  }, []);
  // Leaving the screen with a line open keeps what was typed.
  useEffect(() => save, [save]);

  return {
    on,
    open,
    setOn: (next) => {
      save();
      show(null);
      setOnState(next);
    },
    openLine: (at) => {
      save();
      show(at);
    },
    typed: (text) => {
      typedRef.current = text;
    },
    // Ignored when another line has opened since: that one is open now.
    blurLine: (at) => {
      if (openRef.current !== at) return;
      save();
      show(null);
    },
    undoLine: (at) => {
      const id = sessionRef.current;
      if (id !== null) writeDb((db) => editLine(db, deps, id, at, null));
    },
  };
}
```

### ParagraphRow.tsx

1. Add `TextInput` to the `react-native` import.

2. Add the type, and a prop `editing?: LineEditing | undefined;`:

```ts
// Edit mode (T9): the open line, and what tapping, typing, leaving and Undo do.
export type LineEditing = {
  open: number | null;
  onOpen: (at: number) => void;
  onType: (text: string) => void;
  onBlur: (at: number) => void;
  onUndo: (at: number) => void;
};
```

3. At the start of `ParagraphRow`'s return, right after `timeRow` is made:

```tsx
  if (editing !== undefined) {
    return (
      <View onLayout={onLayout} style={styles.paragraph}>
        {timeRow}
        {lines.map((line) => (
          <EditableLine key={line.key} line={line} mark={view.marks.get(line.at)} editing={editing} colors={colors} />
        ))}
      </View>
    );
  }
```

4. Add below `LineWords`:

```tsx
// One line in Edit mode: tap it to type in it. A line with the person's words shows Undo, which brings back what was heard.
function EditableLine({ line, mark, editing, colors }: { line: TimelineLine; mark: LineMark | undefined; editing: LineEditing; colors: Colors }) {
  const open = editing.open === line.at;
  const speaker = mark?.speaker ?? null;
  return (
    <View style={styles.editLine}>
      {open ? (
        <TextInput
          autoFocus
          multiline
          scrollEnabled={false}
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          defaultValue={line.text}
          onChangeText={editing.onType}
          onBlur={() => editing.onBlur(line.at)}
          accessibilityLabel={`Line at ${formatOffset(line.at)}`}
          style={[styles.text, styles.input, { color: colors.ink, borderColor: colors.accent, backgroundColor: colors.surface }]}
        />
      ) : (
        <Text
          accessibilityRole="button"
          accessibilityHint="Opens this line for typing"
          onPress={() => editing.onOpen(line.at)}
          style={[styles.text, { color: mark?.hidden === true ? colors.ink4 : colors.ink }]}
        >
          {speaker !== null ? <Text style={styles.speaker}>{`${speakerLabel(speaker)}: `}</Text> : null}
          {line.text}
        </Text>
      )}
      {!open && mark !== undefined && mark.text !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Undo. Brings back what was heard"
          hitSlop={12}
          onPress={() => editing.onUndo(line.at)}
          style={styles.undo}
        >
          <Text style={[styles.undoText, { color: colors.accent }]}>Edited · Undo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
```

5. Styles: `editLine: { gap: 2 }`, `input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4 }`, `undo: { alignSelf: "flex-start" }`, `undoText: { fontSize: 13, fontWeight: "600" }`.

### SessionScreen.tsx

1. Imports: `EditingBar, EditSwitch` from `./EditingBar.tsx` and `useLineEditor` from `./useLineEditor.ts`.

2. After the `showHidden` state (hooks stay above the early return):

```ts
  // Edit (S13): the line texts as shown, for the editor to tell whether anything changed.
  const shownText = useRef(new Map<number, string>());
  const editor = useLineEditor(id, (at) => shownText.current.get(at) ?? null);
```

3. After `const lines = shown.filter(…)`: `shownText.current = new Map(lines.map((line) => [line.at, line.text]));`

4. In the "On this iPhone / Better transcript" `onPress`, before `setShowSecond`: `if (index === 1) editor.setOn(false);`.

5. Before the `{second !== null ? (` switch block:

```tsx
        {session.kind === "recording" && lines.length > 0 && !showSecond && canChange ? (
          <View style={styles.transcriptHead}>
            <Caption>TRANSCRIPT</Caption>
            <EditSwitch
              on={editor.on}
              onChange={(on) => {
                setSelection(null);
                editor.setOn(on);
              }}
            />
          </View>
        ) : null}
        {editor.on && !showSecond ? <EditingBar hint="Tap a line to type. Undo brings back what was heard." onDone={() => editor.setOn(false)} /> : null}
```

6. On the transcript's `ParagraphRow`, add:

```tsx
                editing={
                  editor.on
                    ? { open: editor.open, onOpen: editor.openLine, onType: editor.typed, onBlur: editor.blurLine, onUndo: editor.undoLine }
                    : undefined
                }
```

7. The bar does not show while editing: `{selected.picked !== null && !showSecond && !editor.on ? (`.

8. Add `automaticallyAdjustKeyboardInsets` to the `ScrollView`, so the open line stays above the keyboard.

9. Styles: `transcriptHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }`.

No unit tests: `editLine` is tested in T2. Checks: typecheck, test, export:ios. By hand: turn Edit on, change a line, tap another line (the first one is saved), use Undo, and clear a line (it becomes hidden). Then search for the new word once the session is indexed again. A viewer has no Edit switch.

### Review fixes

- The app leaving the front (`AppState` not "active") saves the open line and keeps it open, with what was typed still in `typedRef`, so iOS closing the app loses nothing.
- `editLine` clears an app-made summary (`staleSummary`) when a line's text or hidden state changes, in a transaction, as `setHidden` does. A typed summary stays. Tests in `test/marks.test.ts`.
- Edit shows hidden lines (`applyMarks(..., showHidden || editor.on)`), so a just-cleared line keeps its Undo on screen.
- Editable lines are at least 44 points tall; Undo's `hitSlop` is 16.
- If the open line's shown text changes under it (a sync), the typed text is saved first. The TextInput is keyed by `line.at`.
- Edit turns off when the role becomes viewer or the better transcript is shown. The EditingBar shows only when the person can change the transcript. `shownText` is set with the `lines` memo, and `undoLine` writes through the same try/catch as `save`.

---

## T10 · The Edit switch while recording

Branch `feat/t10-edit-live`, after T8 and T9 are merged. Files, and no others:

- `src/features/capture/RecordScreen.tsx`

Typing goes into finished lines only (decision 4). Opening a line stops the list from following, so new lines arriving do not move it, and "Jump to live" goes back.

1. Imports: `EditingBar, EditSwitch` from `./EditingBar.tsx` and `useLineEditor` from `./useLineEditor.ts`.

2. Extend `RowActions` with `openLine: (at: number) => void; typed: (text: string) => void; blurLine: (at: number) => void; undoLine: (at: number) => void;`.

3. `rowSig` gets a third parameter, `edit: number | null | undefined` (undefined: not editing). In the line's string, append `${edit === undefined ? "" : edit === line.at ? "|open" : "|edit"}`.

4. In `Transcript`, after `const lines = useMemo(…)`:

```ts
  const shownText = useRef(new Map<number, string>());
  shownText.current = new Map(lines.map((line) => [line.at, line.text]));
  const editor = useLineEditor(model.sessionId, (at) => shownText.current.get(at) ?? null);
  const edit = editor.on ? editor.open : undefined;
```

   Then change `sigs` to `useMemo(() => rows.map((row) => rowSig(row, view, edit)), [rows, view, edit])`.

5. After `latest.current = selected;`, add `const latestEditor = useRef(editor); latestEditor.current = editor;`. Add to the `actions` object:

```ts
    openLine: (at) => {
      setFollowing(false);
      latestEditor.current.openLine(at);
    },
    typed: (text) => latestEditor.current.typed(text),
    blurLine: (at) => latestEditor.current.blurLine(at),
    undoLine: (at) => latestEditor.current.undoLine(at),
```

6. In the top row, replace `<View style={styles.spacer} />` with:

```tsx
        <EditSwitch
          on={editor.on}
          onChange={(on) => {
            setSelection(null);
            editor.setOn(on);
          }}
        />
```

   and under the title (above the hidden-lines row): `{editor.on ? <EditingBar hint="Tap a line to type. Recording keeps going and new lines keep coming." onDone={() => editor.setOn(false)} /> : null}`.

7. Rows: `<TimelineRow key={item.key} item={item} sig={sigs[i] ?? ""} view={view} actions={actions} edit={edit} />`. Add `edit: number | null | undefined` to `TimelineRowProps`. In `TimelineRow`, pass to `ParagraphRow`:

```tsx
        editing={
          edit === undefined
            ? undefined
            : { open: edit, onOpen: actions.openLine, onType: actions.typed, onBlur: actions.blurLine, onUndo: actions.undoLine }
        }
```

   The comparator stays `a.sig === b.sig && a.actions === b.actions`, because `edit` is in `sig`.

8. The bar does not show while editing: `{selected.picked !== null && !editor.on ? (`.

9. On the `ScrollView`, add `keyboardShouldPersistTaps="handled"` (a tap on another line opens it at once) and `automaticallyAdjustKeyboardInsets`.

10. Remove the now unused `spacer` style.

No unit tests. Checks: typecheck, test, export:ios. By hand, recording on a phone: turn Edit on, open a line from a minute ago, and type for 20 seconds while words keep arriving. The text you type stays, the list does not jump, the grey live words cannot be tapped, and the finished line you open never changes under you. Lock the phone with Edit on and unlock it: the recording kept running.

---

## Known limits

- **Mixed app versions in a shared space.** An app version older than T1 skips `line_marks` and `notes` changes and moves past them, so when that phone updates it does not have them. They arrive when the row changes again. A one-line fix is `UPDATE sync_state SET last_seq = 0;` in migration 11, which pulls each group's log again once (already-seen changes are ignored). It is left out because a large shared space would download its whole log again. That is the owner's call.
- **Same line, two people, same moment.** A line's mark is one synced row (last writer wins). If two members change the same line at once, one change (an edit, a name or a highlight) is lost.
- **Highlights count words.** If a highlighted line is edited later, its highlight stays on the same word positions.
- **Re-transcription from another phone.** A session transcribed again on another phone can produce lines with new start times. Marks on old start times then show nowhere; they are kept, not deleted.
- **Definition marks are per phone** (decision 6). Only saved explanations of transcript words are marked, not page words.
- **Saved names.** A name stays in "Saved in <space>" only while some line in that space uses it.
- **VoiceOver.** VoiceOver cannot reach single words inside running text, which was true before this group too. "Select this paragraph" and the bar give VoiceOver users the same actions.
