# Next 2: titles, terms, photos and media

From the owner's class notes of 22 Nov 2026 (notes 14, 15, 16, 18 and 25; boards S3, S8, S9 and S12 in `waypoint-usage-notes-2026-11-22.pen`). Written against `main` at `16e3bcc`. Paths are under `apps/mobile/` unless they start with `docs/`.

What exists today, so nothing is built twice:

- A recording still called "New recording" is named from its first words when it stops (`nameRecording`). There is no summary anywhere, and nothing records whether a title was typed by a person or made by the app.
- Explain is a **cloud** task (`POST /v1/tasks/explain`, prompt on the server). The only on-device model code is `modules/waypoint-model` (flashcards, quiz, problem help). So the likely term is a new on-device request, not a change to Explain's prompt; Explain's cloud answer stays as it is and shows under "What it means here".
- No live job type can write a title and summary: `practice`, `diagram`, `mini_app` and `video_slides` each have a fixed result shape, and `research` searches the web. **The cloud backup for title and summary needs a new job type on the server, so it is not in these cards.** When Apple's model is off or declines, the title stays the first words, as today.
- Live photos already open in the zoom viewer (PR #217; `PhotoScreen` pinch-zooms up to 4x). The live Photo button opens the document scanner, which has no zoom and crops like paper. S4 adds the plain photo camera with zoom.
- There is no media panel and no link detection.

The transcript-editing group (Edit toggle, selection bar, highlights, notes, hidden lines, speakers) is planned separately. These cards do not touch `ParagraphRow.tsx`. S6 needs that group's `editSegmentText` and is the last card.

Order: S1, then S2. S3 after S2 (both change `modules/waypoint-model`). S4 at any time. S5 after S2 (both change `SessionScreen.tsx`). S6 last, after S3 and after the editing group's `editSegmentText` is merged.

---

## S1 · Keep a summary, and know which titles the app made

Branch `feat/n2-s1-summary-store`. Files, and no others:

- `src/core/db/schema.ts`
- `src/core/sync/changes.ts`
- `src/core/capture/sessions.ts`
- `src/core/capture/recording.ts`
- `src/core/capture/summary.ts` (new)
- `test/summary.test.ts` (new)
- `test/migrate.test.ts`
- `test/sync.test.ts`
- `test/recording-titles.test.ts`
- `docs/cards/next-2-session.md` (new: this file, copied as it is)

Three new session columns, synced like the title. `title_auto` is 1 while the title is one the app made; typing a title sets it to 0, and the app never replaces it after that. `summary_auto` is 1 until the person edits the summary.

**Migration number.** This card adds migration 11. The editing group may also add a migration and may also replace the `sync_sessions_update` trigger. Before starting, look at the end of `MIGRATIONS` on `origin/main`: if 11 is taken, use the next free number (and the same number in `test/migrate.test.ts`). If a later migration already replaced `sync_sessions_update`, copy its column list into the trigger below and add the three new columns to it, so neither change is lost.

### schema.ts

Add at the end of `MIGRATIONS`:

```ts
  {
    version: 11,
    sql: `
ALTER TABLE sessions ADD COLUMN title_auto INTEGER NOT NULL DEFAULT 0 CHECK (title_auto IN (0, 1));
ALTER TABLE sessions ADD COLUMN summary TEXT;
ALTER TABLE sessions ADD COLUMN summary_auto INTEGER NOT NULL DEFAULT 1 CHECK (summary_auto IN (0, 1));
DROP TRIGGER sync_sessions_update;
CREATE TRIGGER sync_sessions_update AFTER UPDATE OF space_id, kind, title, state, transcript, started_at, ended_at, recorded_ms, title_auto, summary, summary_auto ON sessions WHEN (SELECT applying FROM sync_mode) = 0 AND EXISTS (SELECT 1 FROM space_groups) BEGIN
  INSERT INTO dirty (table_name, row_id, deleted, group_id) VALUES ('sessions', new.id, 0, NULL);
END;
`,
  },
```

### changes.ts

1. In `SYNC_COLUMNS.sessions`, add `"title_auto", "summary", "summary_auto"` after `"recorded_ms"`.

2. Add after `upsertRow`:

```ts
// A session sent by an app version before migration 11 has no title_auto, summary or summary_auto: this iPhone's values
// stay. A title that changed on that phone was typed by a person, so it is no longer the app's.
function withSessionDefaults(db: SqlDb, id: string, row: Record<string, string | number | null>): Record<string, string | number | null> {
  if ("title_auto" in row && "summary" in row && "summary_auto" in row) return row;
  const here = db.get<{ title: string; title_auto: number; summary: string | null; summary_auto: number }>(
    "SELECT title, title_auto, summary, summary_auto FROM sessions WHERE id = ?",
    [id],
  );
  return {
    ...row,
    title_auto: "title_auto" in row ? (row.title_auto ?? 0) : here !== null && here.title === row.title ? here.title_auto : 0,
    summary: "summary" in row ? (row.summary ?? null) : (here?.summary ?? null),
    summary_auto: "summary_auto" in row ? (row.summary_auto ?? 1) : (here?.summary_auto ?? 1),
  };
}
```

3. In `write`, the sessions branch: replace `upsertRow(db, "sessions", { ...change.row, space_id: space });` with:

```ts
    upsertRow(db, "sessions", { ...withSessionDefaults(db, key, change.row), space_id: space });
```

### sessions.ts

In `renameSession`, the person typed the title, so it is theirs from now on:

```ts
  db.run("UPDATE sessions SET title = ?, title_auto = 0 WHERE id = ?", [trimmed, id]);
```

and add to its comment: "A renamed title is the person's: the app never replaces it (title_auto 0)."

### recording.ts

In `nameRecording`, after the `renameSession(…)` line, add:

```ts
  // Named by the app, so the title the model writes later may replace it (see applySummary).
  db.run("UPDATE sessions SET title_auto = 1 WHERE id = ?", [sessionId]);
```

### summary.ts (new, `src/core/capture/summary.ts`)

```ts
import { z } from "zod";
import type { SqlDb } from "../db/sql.ts";
import { inputBudget, packUnits, type Unit } from "../study/generate.ts";
import { titleFromText } from "./pages.ts";

// What the iPhone's model is asked for (modules/waypoint-model summarize): a title and a summary of some text.
export type SummaryPort = { contextSize(): number; summarize(text: string): Promise<unknown> };
export type MadeSummary = { title: string; summary: string };
export type SummaryInfo = { summary: string | null; summaryAuto: boolean; titleAuto: boolean };

export const SUMMARY_MAX_CHARS = 600;
export const SUMMARY_EDIT_MAX_CHARS = 2000;

export function getSummary(db: SqlDb, sessionId: string): SummaryInfo | null {
  const row = db.get<{ summary: string | null; summary_auto: number; title_auto: number }>(
    "SELECT summary, summary_auto, title_auto FROM sessions WHERE id = ?",
    [sessionId],
  );
  return row === null ? null : { summary: row.summary, summaryAuto: row.summary_auto === 1, titleAuto: row.title_auto === 1 };
}

// A finished recording with words, whose summary the app writes and has not written yet.
export function needsSummary(db: SqlDb, sessionId: string): boolean {
  return (
    db.get(
      `SELECT 1 AS n FROM sessions s
       WHERE s.id = ? AND s.kind = 'recording' AND s.state IN ('saved', 'interrupted') AND s.transcript = 'done'
         AND s.summary_auto = 1 AND s.summary IS NULL
         AND EXISTS (SELECT 1 FROM segments g WHERE g.session_id = s.id AND g.source = 'device' AND trim(g.text) <> '')`,
      [sessionId],
    ) !== null
  );
}

// Recording more makes the app's summary out of date, so it is cleared and written again. A summary the person wrote stays.
export function staleSummary(db: SqlDb, sessionId: string): void {
  db.run("UPDATE sessions SET summary = NULL WHERE id = ? AND summary_auto = 1 AND summary IS NOT NULL", [sessionId]);
}

// Writes what the model made. A title or a summary the person typed is never replaced.
export function applySummary(db: SqlDb, sessionId: string, made: MadeSummary): void {
  db.run(
    `UPDATE sessions SET title = CASE WHEN title_auto = 1 THEN ? ELSE title END,
       summary = CASE WHEN summary_auto = 1 THEN ? ELSE summary END
     WHERE id = ? AND (title_auto = 1 OR summary_auto = 1)`,
    [made.title, made.summary, sessionId],
  );
}

// The person's own summary, trimmed. Empty text changes nothing. From then on the app leaves the summary alone.
export function editSummary(db: SqlDb, sessionId: string, text: string): void {
  const trimmed = [...text.trim()].slice(0, SUMMARY_EDIT_MAX_CHARS).join("").trim();
  if (trimmed === "") return;
  db.run("UPDATE sessions SET summary = ?, summary_auto = 0 WHERE id = ?", [trimmed, sessionId]);
}

const madeSchema = z.object({ title: z.string(), summary: z.string() });
// The permissive mode answers in plain text, which arrives as { plainText } (see Drafts.swift).
const plainSchema = z.object({ plainText: z.string() });

// Cuts to at most `max` characters, the "…" included, at a word boundary when there is one.
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head) + "…";
}

// The model's reply as a title of at most 60 characters and a summary of at most 600, or null when either is empty.
export function cleanSummary(raw: unknown): MadeSummary | null {
  let title = "";
  let summary = "";
  const made = madeSchema.safeParse(raw);
  if (made.success) {
    title = made.data.title;
    summary = made.data.summary;
  } else {
    const plain = plainSchema.safeParse(raw);
    if (!plain.success) return null;
    const text = plain.data.plainText.replace(/\*\*/g, "");
    title = /TITLE\s*:\s*(.+)/i.exec(text)?.[1] ?? "";
    summary = (/SUMMARY\s*:\s*([\s\S]+)/i.exec(text)?.[1] ?? "").split(/\n\s*TITLE\s*:/i)[0] ?? "";
  }
  const shortTitle = titleFromText(title.replace(/["“”#*]/g, " ").replace(/\s+/g, " ").trim().replace(/[.:;,]+$/, ""), "");
  const shortSummary = summary.replace(/\s+/g, " ").trim();
  if (shortTitle === "" || shortSummary === "") return null;
  return { title: shortTitle, summary: fit(shortSummary, SUMMARY_MAX_CHARS) };
}

// The text in pieces that fit the model, each summarized; when there is more than one, their summaries are summarized
// the same way until one is left. Null when there is no text or nothing usable came back. Model errors are thrown.
export async function summarizeUnits(port: SummaryPort, units: Unit[]): Promise<MadeSummary | null> {
  const budget = inputBudget(port.contextSize());
  const join = (group: Unit[]): string => group.map((unit) => unit.text).join("\n\n");
  let texts = packUnits(units.filter((unit) => unit.text.trim() !== ""), budget).map(join);
  while (true) {
    const made: MadeSummary[] = [];
    for (const text of texts) {
      const one = cleanSummary(await port.summarize(text));
      if (one !== null) made.push(one);
    }
    const [first] = made;
    if (first === undefined || made.length === 1) return first ?? null;
    const next = packUnits(made.map((m) => ({ text: m.summary, captureId: null, t: null })), budget).map(join);
    // The summaries did not get any fewer: the first piece's summary stands.
    if (next.length >= texts.length) return first;
    texts = next;
  }
}
```

### Tests

`test/migrate.test.ts`: the version is now 11 (three places in the first test).

`test/recording-titles.test.ts`, in `nameRecording`:
- After naming from the first words, `title_auto` is 1 (read it with `getSummary(db, id)?.titleAuto`).
- After `renameSession`, `title_auto` is 0, and `nameRecording` leaves both the title and `title_auto` alone.

`test/summary.test.ts` (new; use `createMemoryDb`, `migrate`, `ensureDefaultSpace`, `startRecordingSession`, `finishRecording`, `saveSegment` the way `recording-titles.test.ts` does):
- A new session has `{ summary: null, summaryAuto: true, titleAuto: false }`.
- `applySummary` on a session named by `nameRecording` replaces the title and sets the summary.
- After `renameSession`, `applySummary` keeps the typed title but still writes the summary.
- After `editSummary`, `applySummary` keeps the edited summary and `summaryAuto` is false; the title is still replaced when it is the app's.
- `applySummary` when both are the person's leaves no `dirty` row in a synced space (add a `groups` and `space_groups` row as `recording-titles.test.ts` does, then `DELETE FROM dirty` before the call).
- `editSummary` trims, cuts to 2,000 characters, and does nothing for `"  "`.
- `staleSummary` clears an app summary and keeps an edited one.
- `needsSummary` is true for a saved recording with `transcript = 'done'`, words and no summary; false with `transcript = 'waiting'`, for a `pages` session, with no words, with only blank words, after `editSummary`, and once a summary is set.
- `cleanSummary`: `{ title: "Cell parts", summary: "Cells have parts." }` comes back as it is; `{ plainText: "TITLE: Cell parts\nSUMMARY: Cells have\nparts." }` gives summary `"Cells have parts."`; `**TITLE:** "Cell parts."` gives title `Cell parts`; a 90-character title is cut to at most 60 at a word boundary; a 900-character summary is at most 600 and ends with `…`; an empty title, an empty summary, `null`, `[]` and `{ plainText: "nothing" }` give null.
- `summarizeUnits` with a fake port (`contextSize: () => 4096`, `summarize` returning `{ title: "T", summary: "S" }` and counting calls): one short unit is one call; no units, and only blank units, are null with no call.
- With `contextSize: () => 600` (a 500-token budget, about 1,500 characters) and three units of 1,200 characters, there are three calls and then one more for their summaries, and the result is that last reply.
- A port whose replies are all unusable gives null; a port that throws `{ code: "unsupported_language" }` makes `summarizeUnits` throw it.

`test/sync.test.ts`:
- In "every watched insert, update and delete is queued": after `send(a)`, `UPDATE sessions SET summary = 'S'` queues one `sessions` upsert whose row has `summary: "S"`, `summary_auto: 1` and `title_auto: 0`.
- New test in "applying changes": device b has the session with `summary = 'Kept'`, `summary_auto = 0`, `title_auto = 1`. Applying a newer sessions upsert from a with the three keys deleted from `row` and the same title keeps `summary`, `summary_auto` and `title_auto`; a newer one without them and a different title sets `title_auto` to 0 and still keeps the summary.

Checks: `npm run typecheck`, `npm test`.

Known limits: the summary is not in search. An older app that changes a session sends no summary, so the summary on that phone is whatever it had.

---

## S2 · Apple's model writes the title and summary after recording stops

Branch `feat/n2-s2-auto-summary`, after S1 is merged. Files, and no others:

- `modules/waypoint-model/ios/Drafts.swift`
- `modules/waypoint-model/ios/WaypointModelModule.swift`
- `modules/waypoint-model/src/WaypointModel.ts`
- `src/platform/summary.ts` (new)
- `src/features/capture/SummaryCard.tsx` (new)
- `src/features/capture/SessionScreen.tsx`
- `src/features/capture/useRecording.ts`
- `test/summarize-session.test.ts` (new)

When a recording stops, the app opens its session. That screen asks the iPhone's model (Apple Foundation Models, on device, free) for a title and summary once the words are ready. Continue recording clears the app's summary when it stops again, so the same screen writes a new one. A title or summary the person typed is never replaced (S1). Nothing is sent to the cloud.

It never runs while this iPhone is recording, nor in the background, and it runs once per session and length per app run, so a model that declines is not asked again each time the screen redraws. A viewer of a shared space does not write it (the owner's or an editor's phone does, and it syncs).

### Drafts.swift

Add at the end:

```swift
@Generable struct SummaryDraft {
  @Guide(description: "A short title that names the main topic, at most eight words, in the language of the text")
  var title: String
  @Guide(description: "Two or three short sentences saying what the text covers, in the language of the text")
  var summary: String
}
```

### WaypointModelModule.swift

Add after the `helpWithProblem` function, inside `definition()`:

```swift
    AsyncFunction("summarize") { (text: String) async throws -> [String: Any] in
      try await self.run { () async throws -> [String: Any] in
        let prompt = "Give this text a short title and a short summary.\n\nText:\n\(text)"
        do {
          let session = LanguageModelSession(instructions: studyInstructions)
          let response = try await session.respond(to: prompt, generating: SummaryDraft.self)
          return ["title": response.content.title, "summary": response.content.summary]
        } catch where modelErrorCode(error) == "declined" {
          let p = prompt + "\n\nWrite exactly two lines:\nTITLE: a short title, at most eight words\nSUMMARY: two or three short sentences\nWrite nothing else."
          return ["plainText": try await self.respondAsText(p)]
        }
      }
    }
```

### WaypointModel.ts

Add `summarize(text: string): Promise<unknown>;` to `NativeModel`, and:

```ts
export const summarize = (text: string): Promise<unknown> => native.summarize(text);
```

### summary.ts (new, `src/platform/summary.ts`)

```ts
import { AppState } from "react-native";
import { getRecorderStatus } from "../../modules/waypoint-audio/index.ts";
import { getAvailability, getContextSize, summarize } from "../../modules/waypoint-model/index.ts";
import { applySummary, summarizeUnits } from "../core/capture/summary.ts";
import { studyUnits } from "../core/study/units.ts";
import { dbGeneration, getDb, writeDbIf } from "./db.ts";

// Tried in this run of the app, by notes, session and recorded length. Recording more makes a new key.
const tried = new Set<string>();

// S8: a recording's title and summary, written by Apple's model on this iPhone after the recording stops. Only in the
// front and only while nothing records: no extra work during a recording, and the model takes one request at a time.
export async function summarizeSession(sessionId: string, recordedMs: number): Promise<void> {
  const generation = dbGeneration();
  const key = `${generation}\n${sessionId}\n${recordedMs}`;
  if (tried.has(key)) return;
  if (getAvailability() !== "available" || getRecorderStatus().state !== "idle" || AppState.currentState !== "active") return;
  tried.add(key);
  try {
    const made = await summarizeUnits({ contextSize: getContextSize, summarize }, studyUnits(getDb(), sessionId));
    if (made !== null) writeDbIf(generation, (db) => applySummary(db, sessionId, made));
  } catch {
    // Declined, busy, or a language the model does not support: the title stays the first words.
  }
}
```

### SummaryCard.tsx (new)

```tsx
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { editSummary, SUMMARY_EDIT_MAX_CHARS } from "../../core/capture/summary.ts";
import { writeDb } from "../../platform/db.ts";
import { Body, Caption } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

// S8: the summary under a recording's title. Once the person edits it, the app never replaces it.
export function SummaryCard({ sessionId, text, editable }: { sessionId: string; text: string; editable: boolean }) {
  const colors = useColors();
  const [draft, setDraft] = useState<string | null>(null);

  function save(): void {
    if (draft !== null && draft.trim() !== "" && draft.trim() !== text) writeDb((db) => editSummary(db, sessionId, draft));
    setDraft(null);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.head}>
        <Caption>Summary</Caption>
        {editable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={draft === null ? "Edit summary" : "Save summary"}
            onPress={draft === null ? () => setDraft(text) : save}
            style={styles.touch}
          >
            <Text style={[styles.link, { color: colors.accent }]}>{draft === null ? "Edit" : "Save"}</Text>
          </Pressable>
        ) : null}
      </View>
      {draft === null ? (
        <Body>{text}</Body>
      ) : (
        <TextInput
          autoFocus
          multiline
          accessibilityLabel="Summary"
          value={draft}
          onChangeText={setDraft}
          maxLength={SUMMARY_EDIT_MAX_CHARS}
          style={[styles.input, { color: colors.ink }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  touch: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  link: { fontSize: 15, fontWeight: "600" },
  input: { fontSize: 17, lineHeight: 24, padding: 0, minHeight: 72 },
});
```

### SessionScreen.tsx

1. Imports: `import { getSummary, needsSummary } from "../../core/capture/summary.ts";`, `import { summarizeSession } from "../../platform/summary.ts";` and `import { SummaryCard } from "./SummaryCard.tsx";`.

2. In the `useQuery` object, after `role: …`:

```ts
      summary: getSummary(db, id),
      needsSummary: !live && needsSummary(db, id),
```

3. After the effect that clears `lit` (before `const miniAppsOn`), add:

```ts
  // After a recording stops, and after Continue recording stops again, the iPhone's model writes the title and summary.
  const wantsSummary = data !== null && data.needsSummary && data.role !== "viewer";
  const recordedMs = data?.session.recordedMs ?? 0;
  useEffect(() => {
    if (wantsSummary) void summarizeSession(id, recordedMs);
  }, [wantsSummary, id, recordedMs]);
```

4. Right after `<Caption>{`${dateLine(session.startedAt, offset)} · ${detail}`}</Caption>`:

```tsx
        {data.summary !== null && data.summary.summary !== null ? (
          <SummaryCard sessionId={id} text={data.summary.summary} editable={role !== "viewer"} />
        ) : null}
```

### useRecording.ts

1. Add `import { staleSummary } from "../../core/capture/summary.ts";`.

2. In `stop()`, inside the `writeDb`, after `nameRecording(db, current.id);`:

```ts
        // A continued recording's summary no longer covers it; its session screen writes a new one.
        staleSummary(db, current.id);
```

### Tests

`test/summarize-session.test.ts` (new). Mock the way `test/camera-permission.test.ts` does: `react-native` (`AppState: { currentState: "active" }`), `../modules/waypoint-audio/index.ts` (`getRecorderStatus`), `../modules/waypoint-model/index.ts` (`getAvailability`, `getContextSize: () => 4096`, `summarize`), and `../src/platform/db.ts` (`dbGeneration: () => 1`, `getDb` returning a migrated memory database with a saved, `done` recording and two segments, `writeDbIf: (_g, write) => write(db)`).
- With the model available and the recorder idle, the title (named by `nameRecording`) and summary are written.
- Nothing is asked when the model is not `available`, when the recorder is `recording`, or when `AppState.currentState` is `background`; a later call when it is available still runs.
- A second call with the same session and length asks nothing; a call with a new length asks again.
- A `summarize` that rejects leaves the title as it was and does not throw.

Checks: `npm run typecheck`, `npm test`, `npm run export:ios`. The native change needs a new development build (ask the owner first).

Known limits: no cloud backup (needs a new job type on the server, a separate decision). A long recording takes several model requests, about one per 2,500 tokens; Flashcards or Quiz started meanwhile can get "busy" from the model once. A summary is written only in the language Apple's model supports.

---

## S3 · Explain suggests the likely term

Branch `feat/n2-s3-likely-term`, after S2 is merged. Files, and no others:

- `modules/waypoint-model/ios/Drafts.swift`
- `modules/waypoint-model/ios/WaypointModelModule.swift`
- `modules/waypoint-model/src/WaypointModel.ts`
- `src/core/explain/term.ts` (new)
- `test/term.test.ts` (new)
- `src/features/explain/useLikelyTerm.ts` (new)
- `src/features/explain/ExplainSheet.tsx`

When the Explain sheet opens for a word from a transcript, the iPhone's model checks, for free and on the iPhone, whether a different term was probably said: a word from another language, a name, or a special word written as a similar-sounding common word. The prompt names no language or subject. If it thinks so, the sheet shows "Suggested", "Probably <term> (<own script>)" and a sentence. Nothing in the transcript changes. "Keep as said" hides the suggestion. The cloud Explain is unchanged; its answer is now headed "What it means here". "Fix transcript" comes in S6.

It does not run for a page's words (no hearing involved), while this iPhone records that session, or when the model is off.

### Drafts.swift

Add at the end:

```swift
let termInstructions = """
You check one word in a transcript written by speech recognition. Speech recognition sometimes writes a term from \
another language, a name, or a special word as a similar-sounding common word. Decide from the transcript whether that \
happened to this word. When you are not sure, say it was heard right.
"""

@Generable struct TermGuessDraft {
  @Guide(description: "True only when the speaker probably said a different term than the word the transcript wrote")
  var misheard: Bool
  @Guide(description: "The term the speaker probably said, spelled in the alphabet of the transcript. Empty when misheard is false.")
  var term: String
  @Guide(description: "The same term written in its own writing system, or the same as term when that is the same alphabet")
  var original: String
  @Guide(description: "The name of the language the term comes from, in the language of the transcript")
  var language: String
  @Guide(description: "What the term means, in a few words, in the language of the transcript")
  var meaning: String
}
```

### WaypointModelModule.swift

Add after `summarize`:

```swift
    AsyncFunction("likelyTerm") { (word: String, context: String) async throws -> [String: Any] in
      try await self.run { () async throws -> [String: Any] in
        let prompt = "The transcript wrote the word \"\(word)\". Did the speaker probably say a different term?\n\nTranscript:\n\(context)"
        let session = LanguageModelSession(instructions: termInstructions)
        let guess = try await session.respond(to: prompt, generating: TermGuessDraft.self).content
        return ["misheard": guess.misheard, "term": guess.term, "original": guess.original, "language": guess.language, "meaning": guess.meaning]
      }
    }
```

A refused request is not asked again in the permissive mode: no suggestion is the safe answer.

### WaypointModel.ts

Add `likelyTerm(word: string, context: string): Promise<unknown>;` to `NativeModel`, and:

```ts
export const likelyTerm = (word: string, context: string): Promise<unknown> => native.likelyTerm(word, context);
```

### term.ts (new, `src/core/explain/term.ts`)

```ts
import { z } from "zod";

// S3: what the model thinks was said where the transcript wrote `heard`. `original` is the term in its own script when
// that differs from `term`.
export type TermGuess = { heard: string; term: string; original: string | null; language: string; meaning: string };

const guessSchema = z.object({ misheard: z.boolean(), term: z.string(), original: z.string(), language: z.string(), meaning: z.string() });

// Letters and digits only, lower case, so "Naïve," and "naïve" compare the same.
const loose = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const tidy = (text: string): string => text.replace(/\s+/g, " ").trim().replace(/^["“”'‘’]+|["“”'‘’.]+$/g, "").trim();
const length = (text: string): number => [...text].length;

// Null when the model thinks the word was heard right, left a part empty or too long, or only repeated the word.
export function cleanTermGuess(raw: unknown, heard: string): TermGuess | null {
  const parsed = guessSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.misheard) return null;
  const term = tidy(parsed.data.term);
  const original = tidy(parsed.data.original);
  const language = tidy(parsed.data.language);
  const meaning = tidy(parsed.data.meaning);
  if (term === "" || length(term) > 60 || language === "" || length(language) > 40 || meaning === "" || length(meaning) > 120) return null;
  if (loose(term) === loose(heard)) return null;
  return { heard, term, original: original === "" || loose(original) === loose(term) ? null : original, language, meaning };
}

const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// "Probably <term> (<original>)", as on board S3.
export function guessHeadline(guess: TermGuess): string {
  return guess.original === null ? `Probably ${guess.term}` : `Probably ${guess.term} (${guess.original})`;
}

// "The transcript wrote "<heard>". <Term> is the <Language> word for <meaning>."
export function guessSentence(guess: TermGuess): string {
  return `The transcript wrote "${guess.heard}". ${upper(guess.term)} is the ${upper(guess.language)} word for ${guess.meaning}.`;
}
```

### useLikelyTerm.ts (new, `src/features/explain/useLikelyTerm.ts`)

```ts
import { useEffect, useState } from "react";
import { getRecorderStatus } from "../../../modules/waypoint-audio/index.ts";
import { getAvailability, likelyTerm } from "../../../modules/waypoint-model/index.ts";
import { isLiveSession } from "../../core/capture/recording.ts";
import { cleanTermGuess, type TermGuess } from "../../core/explain/term.ts";

// S3: asked once as the sheet opens, on this iPhone, for a word from a transcript. Not for a page's words, nor while this
// iPhone records the session. Null until there is a guess, and when there is none. keep() hides it.
export function useLikelyTerm(sessionId: string, word: string, excerpt: string, fromTranscript: boolean): { guess: TermGuess | null; keep: () => void } {
  const [guess, setGuess] = useState<TermGuess | null>(null);
  useEffect(() => {
    if (!fromTranscript || excerpt === "" || getAvailability() !== "available" || isLiveSession(getRecorderStatus(), sessionId)) return;
    let open = true;
    likelyTerm(word, excerpt).then(
      (raw) => {
        if (open) setGuess(cleanTermGuess(raw, word));
      },
      () => undefined, // declined, busy or an unsupported language: no suggestion
    );
    return () => {
      open = false;
    };
  }, [sessionId, word, excerpt, fromTranscript]);
  return { guess, keep: () => setGuess(null) };
}
```

### ExplainSheet.tsx

1. Imports: `import { guessHeadline, guessSentence } from "../../core/explain/term.ts";` and `import { useLikelyTerm } from "./useLikelyTerm.ts";`.

2. `HEADINGS.explain` becomes `"What it means here"`.

3. In `ExplainBody`, after `const model = useExplain(…);` and the line that destructures it:

```ts
  const likely = useLikelyTerm(sessionId, word, model.excerpt, timed && resolvedPageId === undefined);
```

4. In the `<Caption>` under `<Title>{word}</Title>`, the first branch `` `“${word}” · at ${formatOffset(t)}` `` becomes `` `Said at ${formatOffset(t)}` ``.

5. Right after that `<Caption>…</Caption>`:

```tsx
        {likely.guess !== null ? (
          <View style={[styles.suggest, { backgroundColor: colors.accentSoft }]}>
            <Caption>Suggested</Caption>
            <Text style={[styles.suggestTitle, { color: colors.ink }]}>{guessHeadline(likely.guess)}</Text>
            <Body>{guessSentence(likely.guess)}</Body>
            <SecondaryButton label="Keep as said" onPress={likely.keep} />
          </View>
        ) : null}
```

6. After `{thread.map(…)}`, add:

```tsx
        {hasAnswer ? <Caption>AI can be wrong. Check it with your teacher or text.</Caption> : null}
```

7. Styles: `suggest: { padding: 14, borderRadius: 16, gap: 8 },` and `suggestTitle: { fontSize: 20, fontWeight: "700" },`.

### Tests

`test/term.test.ts` (new):
- `cleanTermGuess({ misheard: true, term: "qua", original: "qua", language: "latin", meaning: "in the role of" }, "kwaw")` gives `original: null`, and `guessHeadline` is `Probably qua`; `guessSentence` is `The transcript wrote "kwaw". Qua is the Latin word for in the role of.`
- An `original` in another script is kept and shown in brackets by `guessHeadline`.
- Null for `misheard: false`, a term equal to the heard word apart from case and punctuation, an empty term, language or meaning, a term over 60, a language over 40 and a meaning over 120 characters, a missing key, and `null`.
- Quotes and a final full stop are trimmed from each part.

Checks: `npm run typecheck`, `npm test`, `npm run export:ios`. Native change: a new development build (ask the owner first).

Known limits: Apple's small model will sometimes miss a term or suggest a wrong one; the sheet says "Probably" and changes nothing on its own. The cloud Explain still explains the word as written. "This is wrong" and "Double-check" on board S3 belong to the existing cloud answer and are unchanged.

---

## S4 · Photo or Page, with zoom in the camera

Branch `feat/n2-s4-photo-camera`. Files, and no others:

- `modules/waypoint-pages/ios/Core/ZoomScale.swift` (new)
- `modules/waypoint-pages/ios/Tests/ZoomScaleTests.swift` (new)
- `modules/waypoint-pages/ios/PhotoCamera.swift` (new)
- `modules/waypoint-pages/ios/WaypointPagesModule.swift`
- `modules/waypoint-pages/src/WaypointPages.ts`
- `src/features/capture/useRecording.ts`
- `src/features/capture/RecordScreen.tsx`
- `app.json`

The live recording's camera button becomes **Photo** (board S1). It opens a plain camera (board S12) with **Photo | Page** at the bottom: Photo takes a plain picture of a board or demonstration; Page closes it and opens the page scanner as today. Pinch to zoom, or tap **.5**, **1** or **2x** (.5 only on iPhones with an ultra wide lens). The camera has no audio input and does not touch the audio session, so the recording keeps going. One photo per tap of Photo; it returns to the recording. No video and no face recognition. The zoom viewer (`PhotoScreen`) already pinch-zooms and is unchanged.

### ZoomScale.swift (new, `ios/Core`)

```swift
import Foundation

/// The camera's zoom as people see it. On an iPhone with an ultra wide lens, device factor 1 is the ultra wide (.5) and
/// `wideFactor` (the first switch-over factor, usually 2) is the main lens (1).
struct ZoomScale: Equatable {
  let wideFactor: Double
  let minFactor: Double
  let maxFactor: Double

  /// maxShown caps the zoom (10 shows as 10x), so people cannot zoom into noise.
  init(wideFactor: Double, minFactor: Double, maxFactor: Double, maxShown: Double = 10) {
    self.wideFactor = max(1, wideFactor)
    self.minFactor = minFactor
    self.maxFactor = max(minFactor, min(maxFactor, self.wideFactor * maxShown))
  }

  var hasUltraWide: Bool { wideFactor > minFactor }
  /// The buttons: .5 only with an ultra wide lens, then 1 and 2.
  var presets: [Double] { (hasUltraWide ? [0.5] : []) + [1, 2] }

  func clamp(_ factor: Double) -> Double { min(maxFactor, max(minFactor, factor)) }
  func shown(_ factor: Double) -> Double { factor / wideFactor }
  func factor(shown: Double) -> Double { clamp(shown * wideFactor) }

  /// The preset whose button shows the zoom now: the largest one at or below it.
  func active(shown: Double) -> Double { presets.last { $0 <= shown + 0.05 } ?? presets[0] }

  /// ".5", "1", "2"; the active button shows the zoom now with an x ("2x", "1.4x").
  func label(_ preset: Double, shown: Double) -> String {
    preset == active(shown: shown) ? Self.number(shown) + "x" : Self.number(preset)
  }

  static func number(_ value: Double) -> String {
    let rounded = (value * 10).rounded() / 10
    if rounded == rounded.rounded() { return String(Int(rounded)) }
    let text = String(format: "%.1f", rounded)
    return text.hasPrefix("0") ? String(text.dropFirst()) : text
  }
}
```

### ZoomScaleTests.swift (new, `ios/Tests`)

In the style of `PageLineTests.swift` (`import Testing`, `@testable import PagesCore`):
- `ZoomScale(wideFactor: 2, minFactor: 1, maxFactor: 123)`: `maxFactor` is 20, `presets` is `[0.5, 1, 2]`, `shown(1)` is 0.5, `factor(shown: 2)` is 4, `clamp(0.5)` is 1 and `clamp(50)` is 20.
- `ZoomScale(wideFactor: 1, minFactor: 1, maxFactor: 16)`: no ultra wide, `presets` is `[1, 2]`, `factor(shown: 0.5)` is 1.
- Labels on the first scale: at shown 2, `[".5", "1", "2x"]`; at 1.4, `[".5", "1.4x", "2"]`; at 0.5, `[".5x", "1", "2"]`; at 7, `[".5", "1", "7x"]`.
- `number(0.5)` is ".5", `number(1)` is "1", `number(2.04)` is "2", `number(1.36)` is "1.4".

### PhotoCamera.swift (new, `ios`)

```swift
import AVFoundation
import UIKit

enum CameraResult {
  case photo([String: Any])
  case page
  case cancelled
  case failed(String)
}

/// S12: a plain camera for a board or a demonstration. Pinch, or tap .5, 1 or 2x, to zoom. Page closes it so the page
/// scanner can open. It has no audio input and leaves the audio session alone, so a recording keeps going.
final class PhotoCameraController: UIViewController, AVCapturePhotoCaptureDelegate {
  private let sessionId: String
  private let done: (CameraResult) -> Void
  private let session = AVCaptureSession()
  private let output = AVCapturePhotoOutput()
  private let queue = DispatchQueue(label: "waypoint.photo-camera")
  private let preview = AVCaptureVideoPreviewLayer()
  private let shutter = UIButton(type: .custom)
  private var device: AVCaptureDevice?
  private var rotation: AVCaptureDevice.RotationCoordinator?
  private var scale = ZoomScale(wideFactor: 1, minFactor: 1, maxFactor: 1)
  private var pinchStart: CGFloat = 1
  private var zoomButtons: [(preset: Double, button: UIButton)] = []
  private var startFailed = false
  private var finished = false

  init(sessionId: String, done: @escaping (CameraResult) -> Void) {
    self.sessionId = sessionId
    self.done = done
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .fullScreen
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    preview.session = session
    preview.videoGravity = .resizeAspect
    view.layer.addSublayer(preview)
    guard configure() else {
      startFailed = true
      return
    }
    view.addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(pinched(_:))))
    buildControls()
    setZoom(scale.factor(shown: 1))
    queue.async { [session] in session.startRunning() }
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    // A failure while loading is reported once the camera is on screen, so it can be dismissed.
    if startFailed { finish(.failed("The camera could not start")) }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    preview.frame = view.bounds
  }

  private func configure() -> Bool {
    guard
      let device = AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
        ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
      let input = try? AVCaptureDeviceInput(device: device)
    else { return false }
    self.device = device
    let wide = device.virtualDeviceSwitchOverVideoZoomFactors.first.map { $0.doubleValue } ?? 1
    scale = ZoomScale(
      wideFactor: wide, minFactor: Double(device.minAvailableVideoZoomFactor), maxFactor: Double(device.maxAvailableVideoZoomFactor))
    session.automaticallyConfiguresApplicationAudioSession = false
    session.beginConfiguration()
    session.sessionPreset = .photo
    guard session.canAddInput(input), session.canAddOutput(output) else {
      session.commitConfiguration()
      return false
    }
    session.addInput(input)
    session.addOutput(output)
    session.commitConfiguration()
    rotation = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: preview)
    return true
  }

  private func buildControls() {
    let cancel = UIButton(type: .system)
    cancel.setTitle("Cancel", for: .normal)
    cancel.setTitleColor(.white, for: .normal)
    cancel.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    cancel.titleLabel?.adjustsFontForContentSizeCategory = true
    cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

    let zoomRow = UIStackView()
    zoomRow.axis = .horizontal
    zoomRow.spacing = 12
    zoomButtons = scale.presets.map { preset in
      let button = UIButton(type: .custom)
      button.backgroundColor = UIColor(white: 0, alpha: 0.5)
      button.layer.cornerRadius = 22
      button.titleLabel?.font = .preferredFont(forTextStyle: .footnote)
      button.titleLabel?.adjustsFontForContentSizeCategory = true
      button.accessibilityLabel = "Zoom \(ZoomScale.number(preset)) times"
      button.addAction(UIAction { [weak self] _ in
        guard let self else { return }
        self.setZoom(self.scale.factor(shown: preset))
      }, for: .touchUpInside)
      button.widthAnchor.constraint(equalToConstant: 44).isActive = true
      button.heightAnchor.constraint(equalToConstant: 44).isActive = true
      zoomRow.addArrangedSubview(button)
      return (preset, button)
    }

    let hint = UILabel()
    hint.text = "Pinch to zoom"
    hint.textColor = UIColor(white: 1, alpha: 0.8)
    hint.font = .preferredFont(forTextStyle: .footnote)
    hint.adjustsFontForContentSizeCategory = true

    let mode = UISegmentedControl(items: ["Photo", "Page"])
    mode.selectedSegmentIndex = 0
    mode.addTarget(self, action: #selector(modeChanged(_:)), for: .valueChanged)
    mode.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true

    shutter.backgroundColor = .white
    shutter.layer.cornerRadius = 36
    shutter.layer.borderWidth = 4
    shutter.layer.borderColor = UIColor(white: 0.75, alpha: 1).cgColor
    shutter.accessibilityLabel = "Take photo"
    shutter.addTarget(self, action: #selector(shutterTapped), for: .touchUpInside)
    shutter.widthAnchor.constraint(equalToConstant: 72).isActive = true
    shutter.heightAnchor.constraint(equalToConstant: 72).isActive = true

    let bottom = UIStackView(arrangedSubviews: [zoomRow, hint, mode, shutter])
    bottom.axis = .vertical
    bottom.alignment = .center
    bottom.spacing = 16
    for item in [cancel, bottom] as [UIView] {
      item.translatesAutoresizingMaskIntoConstraints = false
      view.addSubview(item)
    }
    let safe = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      cancel.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
      cancel.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 20),
      cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
      bottom.centerXAnchor.constraint(equalTo: safe.centerXAnchor),
      bottom.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -16),
    ])
  }

  private func setZoom(_ factor: Double) {
    guard let device else { return }
    let target = scale.clamp(factor)
    do {
      try device.lockForConfiguration()
      device.videoZoomFactor = CGFloat(target)
      device.unlockForConfiguration()
    } catch {
      return
    }
    let shown = scale.shown(target)
    for (preset, button) in zoomButtons {
      let active = preset == scale.active(shown: shown)
      button.setTitle(scale.label(preset, shown: shown), for: .normal)
      button.setTitleColor(active ? .systemYellow : .white, for: .normal)
    }
  }

  @objc private func pinched(_ pinch: UIPinchGestureRecognizer) {
    guard let device else { return }
    if pinch.state == .began { pinchStart = device.videoZoomFactor }
    if pinch.state == .changed { setZoom(Double(pinchStart * pinch.scale)) }
  }

  @objc private func modeChanged(_ control: UISegmentedControl) {
    if control.selectedSegmentIndex == 1 { finish(.page) }
  }

  @objc private func cancelTapped() { finish(.cancelled) }

  @objc private func shutterTapped() {
    guard !finished else { return }
    shutter.isEnabled = false
    if let angle = rotation?.videoRotationAngleForHorizonLevelCapture, let connection = output.connection(with: .video),
      connection.isVideoRotationAngleSupported(angle)
    {
      connection.videoRotationAngle = angle
    }
    output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
  }

  nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    let data = error == nil ? photo.fileDataRepresentation() : nil
    DispatchQueue.main.async { [weak self] in self?.save(data) }
  }

  private func save(_ data: Data?) {
    guard let data, let image = UIImage(data: data) else {
      finish(.failed("The photo could not be taken"))
      return
    }
    let sessionId = self.sessionId
    DispatchQueue.global(qos: .userInitiated).async {
      let result: CameraResult
      do {
        result = .photo(try PageStore.save(image, sessionId: sessionId))
      } catch {
        result = .failed(error.localizedDescription)
      }
      DispatchQueue.main.async { [weak self] in self?.finish(result) }
    }
  }

  /// Closes the camera, then answers, so the page scanner can be shown right after it.
  private func finish(_ result: CameraResult) {
    guard !finished else { return }
    finished = true
    queue.async { [session] in session.stopRunning() }
    let done = self.done
    dismiss(animated: true) { done(result) }
  }
}
```

### WaypointPagesModule.swift

1. Add `import AVFoundation` and, next to `scan`, `private var cameraOpen = false`.

2. Add inside `definition()` after `scanPages`:

```swift
    AsyncFunction("openCamera") { (sessionId: String, promise: Promise) in
      guard !self.cameraOpen, self.scan == nil else { promise.reject("busy", "The camera is already open"); return }
      guard AVCaptureDevice.default(for: .video) != nil else { promise.reject("no_camera", "This iPhone has no camera"); return }
      self.cameraOpen = true
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
          guard granted, let presenter = self.appContext?.utilities?.currentViewController() else {
            self.cameraOpen = false
            if granted { promise.reject("no_view", "Nothing to show the camera from") }
            else { promise.reject("camera_denied", "Camera access is off") }
            return
          }
          let camera = PhotoCameraController(sessionId: sessionId) { [weak self] result in
            self?.cameraOpen = false
            switch result {
            case .photo(var page):
              page["kind"] = "photo"
              promise.resolve(page)
            case .page: promise.resolve(["kind": "page"])
            case .cancelled: promise.resolve(["kind": "cancelled"])
            case .failed(let message): promise.reject("camera_failed", message)
            }
          }
          presenter.present(camera, animated: true)
        }
      }
    }.runOnQueue(.main)
```

### WaypointPages.ts

```ts
export type CameraResult = { kind: "photo"; file: string; width: number; height: number } | { kind: "page" } | { kind: "cancelled" };
```

Add `openCamera(sessionId: string): Promise<CameraResult>; // rejects with code camera_denied when access is off` to `NativePages`, and:

```ts
export const openCamera = (sessionId: string): Promise<CameraResult> => native.openCamera(sessionId);
```

### useRecording.ts

1. Imports: add `Linking` to the `react-native` import, and `openCamera` to the `waypoint-pages` import.

2. Replace `photo()`:

```ts
  // Photo for a board or a demonstration; Page in the camera opens the page scanner instead.
  async function photo(): Promise<void> {
    const current = sessionRef.current;
    if (!current) return;
    let files: string[];
    try {
      const shot = await openCamera(current.id);
      if (shot.kind === "cancelled") return;
      if (shot.kind === "photo") files = [shot.file];
      else if (!isScannerSupported()) {
        Alert.alert("This iPhone can't scan pages.");
        return;
      } else files = (await scanPages(current.id)).map((page) => page.file);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "camera_denied") {
        Alert.alert("NotePath can't use the camera", "Turn on Camera for NotePath in Settings.", [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ]);
      } else {
        Alert.alert("Couldn't take the photo.", messageOf(error));
      }
      return;
    }
    for (const file of files) {
      const t = Date.now() - current.startedAt + clockOffsetRef.current;
      const id = writeDb((db) => addPhoto(db, deps, current.id, t, file));
      setPhotos((previous) => [...previous, { id, t, file }]);
    }
  }
```

### RecordScreen.tsx

`<ActionButton label="Snap page" …/>` becomes `<ActionButton label="Photo" icon="camera.fill" onPress={model.photo} />`.

### app.json

The `cameraPermission` of `expo-image-picker` becomes: `"NotePath uses the camera to snap pages and photos, like a board in class. They are read on this iPhone."` (this text is the iOS camera prompt for the whole app).

Checks: `npm run typecheck`, `npm test`, `npm run test:swift`, `npm run export:ios`. This is a native change and needs a new development build (ask the owner first). On a device, check: a 20-minute recording keeps recording and transcribing across three photos; .5 shows only on iPhones with an ultra wide lens; a photo taken with the phone turned sideways is upright in the timeline and the viewer; VoiceOver reads Cancel, the zoom buttons, Photo, Page and Take photo.

Known limits: a photo and a page from the recording are both stored as `photo` captures, so the timeline and the media panel call both "Photo". Zoom does not carry over between photos.

---

## S5 · Media panel: photos, pages and links

Branch `feat/n2-s5-media-panel`, after S2 is merged. Files, and no others:

- `src/core/capture/media.ts` (new)
- `test/media.test.ts` (new)
- `src/features/capture/MediaScreen.tsx` (new)
- `src/app/media/[id].tsx` (new)
- `src/app/_layout.tsx`
- `src/features/capture/SessionScreen.tsx`

A Media button on the session opens everything from it in one place (board S9): photos and pages in a grid with their times, and the links written on pages, in photos and in the transcript. Tapping a photo or page goes back to the session at that moment. Tapping a link opens it in the system browser, and nothing opens before that tap. Links are found on the iPhone with one generic rule; nothing is fetched, so a link shows its address, not a page title.

### media.ts (new, `src/core/capture/media.ts`)

```ts
import type { SqlDb } from "../db/sql.ts";
import { listSegments } from "./segments.ts";

// A photo (from a recording, at time t) or a page (from a pages session, by number).
export type MediaItem = { id: string; kind: "photo" | "page"; file: string; t: number; page: number | null };
export type FoundLink = { url: string; shown: string; host: string };
// Where a link was written: a transcript line or a photo (t), or a page (captureId and page).
export type SessionLink = FoundLink & { t: number | null; captureId: string | null; page: number | null };

export function sessionMedia(db: SqlDb, sessionId: string): MediaItem[] {
  const pages = db
    .all<{ id: string; file: string }>("SELECT id, file FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id", [sessionId])
    .map((row, index): MediaItem => ({ id: row.id, kind: "page", file: row.file, t: 0, page: index + 1 }));
  const photos = db
    .all<{ id: string; file: string; t: number }>("SELECT id, file, t FROM captures WHERE session_id = ? AND kind = 'photo' ORDER BY t, id", [sessionId])
    .map((row): MediaItem => ({ id: row.id, kind: "photo", file: row.file, t: row.t, page: null }));
  return [...pages, ...photos];
}

// A web address: with http:// or https://, or a name with dots ending in 2 to 24 lower-case letters (example.org,
// www.example.org/lesson-12). Not part of a longer word or an email address.
const LINK = /(?<![\p{L}\p{N}@._/-])(?:https?:\/\/[^\s<>"'“”‘’]+|(?:[\p{L}\p{N}-]+\.)+[a-z]{2,24}(?:\/[^\s<>"'“”‘’]*)?)(?![\p{L}\p{N}@])/gu;
const TRAILING = /[.,;:!?)\]}'"”’]+$/;

// Every distinct web address in the text, in order, made openable (https:// added when it has no scheme).
export function findLinks(text: string): FoundLink[] {
  const seen = new Set<string>();
  const out: FoundLink[] = [];
  for (const match of text.matchAll(LINK)) {
    const raw = match[0].replace(TRAILING, "");
    if (raw === "") continue;
    const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const shown = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    out.push({ url, shown, host: (shown.split("/")[0] ?? shown).replace(/^www\./, "") });
  }
  return out;
}

// The session's links: from pages first (by number), then from the transcript and photos in time order. Each address once.
export function sessionLinks(db: SqlDb, sessionId: string): SessionLink[] {
  const pages = db.all<{ id: string; found_text: string | null }>(
    "SELECT id, found_text FROM captures WHERE session_id = ? AND kind = 'page' ORDER BY position, id",
    [sessionId],
  );
  const photos = db.all<{ id: string; t: number; found_text: string | null }>(
    "SELECT id, t, found_text FROM captures WHERE session_id = ? AND kind = 'photo' ORDER BY t, id",
    [sessionId],
  );
  const timed = [
    ...listSegments(db, sessionId).map((line) => ({ t: line.tStart, text: line.text, captureId: null as string | null })),
    ...photos.map((photo) => ({ t: photo.t, text: photo.found_text ?? "", captureId: photo.id as string | null })),
  ].sort((a, b) => a.t - b.t);
  const out: SessionLink[] = [];
  const seen = new Set<string>();
  const add = (links: FoundLink[], where: { t: number | null; captureId: string | null; page: number | null }) => {
    for (const link of links) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      out.push({ ...link, ...where });
    }
  };
  pages.forEach((page, index) => add(findLinks(page.found_text ?? ""), { t: null, captureId: page.id, page: index + 1 }));
  for (const item of timed) add(findLinks(item.text), { t: item.t, captureId: item.captureId, page: null });
  return out;
}
```

### MediaScreen.tsx (new)

```tsx
import { useState } from "react";
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { sessionLinks, sessionMedia, type MediaItem, type SessionLink } from "../../core/capture/media.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { formatOffset } from "../../core/format.ts";
import { openableUrl } from "../../core/research/answer.ts";
import { useQuery } from "../../platform/db.ts";
import { fileUri } from "../../platform/files.ts";
import { BackButton, Caption, Row, Screen, Title } from "../../ui/kit.tsx";
import { useColors } from "../../ui/theme.ts";

type Filter = "all" | "photos" | "pages" | "links";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "photos", label: "Photos" },
  { key: "pages", label: "Pages" },
  { key: "links", label: "Links" },
];

// S9: everything from one session, like details in Messages. A photo or page goes back to its moment in the session; a link
// opens in the browser only when tapped.
export default function MediaScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useQuery((db) => ({ title: getSession(db, id)?.title ?? "", media: sessionMedia(db, id), links: sessionLinks(db, id) }), id);
  const [filter, setFilter] = useState<Filter>("all");
  const media = data.media.filter((item) => filter === "all" || (filter === "photos" ? item.kind === "photo" : filter === "pages" && item.kind === "page"));
  const links = filter === "all" || filter === "links" ? data.links : [];

  // Back to the session screen under this one, at the moment (see SessionScreen's t and page params).
  function jump(where: { t: number | null; captureId: string | null; kind: "photo" | "page" | "link" }): void {
    const query = where.kind === "page" && where.captureId !== null ? `page=${encodeURIComponent(where.captureId)}` : `t=${where.t ?? 0}`;
    router.dismissTo(`/session/${encodeURIComponent(id)}?${query}`);
  }

  function open(link: SessionLink): void {
    const url = openableUrl(link.url);
    if (url === null) return;
    Linking.openURL(url).catch(() => Alert.alert("Couldn't open that link"));
  }

  return (
    <Screen>
      <View style={styles.topRow}>
        <BackButton />
      </View>
      <Caption numberOfLines={1}>{data.title}</Caption>
      <Title>Media</Title>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.key }}
            onPress={() => setFilter(f.key)}
            style={[styles.filter, { backgroundColor: filter === f.key ? colors.accentSoft : colors.surface2 }]}
          >
            <Text style={[styles.filterText, { color: colors.ink }]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {media.length === 0 && links.length === 0 ? <Caption>Nothing here yet. Photos, pages and links from this session show up here.</Caption> : null}

      {media.length > 0 ? (
        <>
          <Caption>Photos and pages</Caption>
          <View style={styles.grid}>
            {media.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${mediaLabel(item)}, go to this moment`}
                onPress={() => jump({ t: item.t, captureId: item.id, kind: item.kind })}
                style={styles.tile}
              >
                {item.file === "" ? (
                  <View style={[styles.thumb, { backgroundColor: colors.surface2 }]} />
                ) : (
                  <Image source={{ uri: fileUri(item.file) }} resizeMode="cover" style={[styles.thumb, { backgroundColor: colors.surface2 }]} />
                )}
                <Text style={[styles.tileText, { color: colors.ink3 }]}>{mediaLabel(item)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {links.length > 0 ? (
        <>
          <Caption>Links</Caption>
          {links.map((link) => (
            <Row
              key={link.url}
              title={link.host}
              {...(link.shown === link.host ? {} : { subtitle: link.shown })}
              onPress={() => open(link)}
              right={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Go to ${whereLabel(link)}`}
                  onPress={() => jump({ t: link.t, captureId: link.captureId, kind: link.page !== null ? "page" : "link" })}
                  style={styles.when}
                >
                  <Text style={[styles.whenText, { color: colors.accent }]}>{whereLabel(link)}</Text>
                </Pressable>
              }
            />
          ))}
          <Caption>Links come from your pages and transcript. Nothing opens until you tap it.</Caption>
        </>
      ) : null}
    </Screen>
  );
}

// "Photo · 31:40" or "Page 3".
function mediaLabel(item: MediaItem): string {
  return item.kind === "page" ? `Page ${item.page ?? 1}` : `Photo · ${formatOffset(item.t)}`;
}

function whereLabel(link: SessionLink): string {
  return link.page !== null ? `Page ${link.page}` : formatOffset(link.t ?? 0);
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", justifyContent: "space-between" },
  filters: { flexDirection: "row", gap: 8 },
  filter: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  filterText: { fontSize: 15, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "31%", gap: 4 },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: 10 },
  tileText: { fontSize: 12, fontVariant: ["tabular-nums"] },
  when: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  whenText: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
});
```

`Row`'s `subtitle` is `subtitle?: string`, so it is spread in only when there is one (`exactOptionalPropertyTypes`).

### src/app/media/[id].tsx (new)

```tsx
export { default } from "../../features/capture/MediaScreen.tsx";
```

### _layout.tsx

Add `<Stack.Screen name="media/[id]" />` after `<Stack.Screen name="session/[id]" />`.

### SessionScreen.tsx

1. Replace the top row's second button with a group of two:

```tsx
          <View style={styles.topRight}>
            <CircleButton label="Media" icon="photo.on.rectangle" onPress={() => router.push(`/media/${encodeURIComponent(id)}`)} />
            <CircleButton label="More" icon="ellipsis" onPress={openMenu} />
          </View>
```

2. Style: `topRight: { flexDirection: "row", gap: 8 },`.

### Tests

`test/media.test.ts` (new):
- `findLinks`: `"see https://example.org/a."` gives `https://example.org/a` with shown `example.org/a` and host `example.org`; `"www.example.com"` gives `https://www.example.com` with host `example.com`; `"example.org/lesson-12)"` gives `https://example.org/lesson-12`; `"(https://example.org/x)"` drops both brackets.
- No links in `"me@example.org"`, `"e.g. this"`, `"pi is 3.14"`, `"the end.The next"`, `"10.30am"`, `"a.m."`.
- The same address twice is listed once.
- `sessionMedia`: pages by position with numbers from 1, then photos by time.
- `sessionLinks`: a link in a page's text has its page number and capture id; a link in a transcript line has that line's `tStart`; a link in a photo's text has the photo's time; an address on a page and in the transcript is listed once, with the page.

Checks: `npm run typecheck`, `npm test`, `npm run export:ios`.

On a device, check that tapping a photo returns to the session already open and moves to that moment. If `router.dismissTo` opens a second session screen or does not move, use `router.push` instead (the same as Explain's "Open in session").

Known limits: a link shows its address, not the page's title (nothing is fetched). A spoken address is found only when the iPhone wrote it as one ("example.org"), not as words ("example dot org"). Board S9's "Board · 0:12" label needs the app to tell a board from other photos, which it does not do: photos say "Photo".

---

## S6 · Fix transcript from a suggested term

Branch `feat/n2-s6-fix-term`. **Last card**: after S3 is merged and after the transcript-editing group's card that adds `editSegmentText` (in `src/core/capture/`) is merged. Files, and no others:

- `src/core/explain/term.ts`
- `test/term.test.ts`
- `src/features/explain/useLikelyTerm.ts`
- `src/features/explain/ExplainSheet.tsx`

"Fix transcript" replaces the heard word with the suggested term in that one transcript line, through the editing group's `editSegmentText`, which keeps the original so it can be restored. Nothing else changes. Viewers of a shared space do not see Fix.

Before starting, read the editing group's merged card. The code below assumes `editSegmentText(db, deps, sessionId, tStart, text)` and that `listSegments` returns each line's shown (edited) text. If either differs, change only the two marked calls.

### term.ts

Add:

```ts
// The line with the first whole-word `word` (same case) swapped for `term`; null when the word is not in it.
export function replaceWord(text: string, word: string, term: string): string | null {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").exec(text);
  if (match === null) return null;
  return text.slice(0, match.index) + term + text.slice(match.index + word.length);
}
```

### useLikelyTerm.ts

1. Add `t: number` as the second parameter: `useLikelyTerm(sessionId: string, t: number, word: string, excerpt: string, fromTranscript: boolean)`.

2. Imports: `randomUUID` from `expo-crypto`, `listSegments` from `../../core/capture/segments.ts`, `getSession` from `../../core/capture/sessions.ts`, `editSegmentText` from the editing group's file, `spaceGroups` from `../../core/groups/groups.ts`, `replaceWord` from `../../core/explain/term.ts`, and `getDb`, `writeDb` from `../../platform/db.ts`.

3. Add next to `guess`:

```ts
  const [fixed, setFixed] = useState(false);
  const [canFix] = useState(() => {
    const session = getSession(getDb(), sessionId);
    return session !== null && spaceGroups(getDb()).get(session.spaceId)?.role !== "viewer";
  });

  // Changes the one line the word was tapped in. False when the line or the word is no longer there.
  function fix(): boolean {
    if (guess === null) return false;
    const line = listSegments(getDb(), sessionId).find((segment) => segment.tStart === t); // shown text (see the note above)
    const next = line === undefined ? null : replaceWord(line.text, guess.heard, guess.term);
    if (next === null) return false;
    writeDb((db) => editSegmentText(db, { now: Date.now, newId: randomUUID }, sessionId, t, next)); // the editing group's function
    setFixed(true);
    return true;
  }
```

4. Return `{ guess, keep: () => setGuess(null), fix, fixed, canFix: canFix && !fixed }`.

### ExplainSheet.tsx

1. The hook call becomes `useLikelyTerm(sessionId, t, word, model.excerpt, timed && resolvedPageId === undefined)`.

2. In the suggestion block, before `Keep as said`:

```tsx
            {likely.canFix ? (
              <PrimaryButton
                label="Fix transcript"
                onPress={() => {
                  if (!likely.fix()) Alert.alert("Couldn't fix this line", "The word isn't in it any more.");
                }}
              />
            ) : null}
            {likely.fixed ? <Caption>Fixed in the transcript. You can undo it there.</Caption> : null}
```

   and show `Keep as said` only while `!likely.fixed`. Add `Alert` to the `react-native` import.

### Tests

`test/term.test.ts`, add for `replaceWord`:
- Replaces the first whole word only: `replaceWord("the kwaw and kwaw", "kwaw", "qua")` is `"the qua and kwaw"`.
- Not inside a longer word: `replaceWord("kwawk kwaw", "kwaw", "qua")` is `"kwawk qua"`.
- Next to punctuation: `replaceWord("(kwaw),", "kwaw", "qua")` is `"(qua),"`.
- A word with regex characters (`"a+b"`) is matched as text; a missing word gives null.

Checks: `npm run typecheck`, `npm test`.

Known limits: only the line the word was tapped in changes; the same word elsewhere is left as it was.
