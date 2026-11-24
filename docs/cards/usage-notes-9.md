# Usage notes 9: fixes from the phase review of the Next features

Fable's phase review of `16e3bcc..95516b0` (PRs #226 to #247). Written against `main` at `95516b0`. Paths are under `apps/mobile/` unless they start with `docs/`. Migration 11 is not in any released build, so it may still be edited.

---

## U14 · Keep titles, summaries and edits right across phones and the model

Branch `fix/u14-phase-review`. Files: whatever the steps below need, and `docs/cards/usage-notes-9.md` (new: this file, copied as it is). List every file you touched in the report.

### 1. A new recording's default title is the app's (blocker)

A recording starts as "New recording" with `title_auto = 0`, which syncs before Stop. Another phone then holds it as a typed title, and the S1 rule "a typed title wins" (`src/core/sync/changes.ts`, around line 321) keeps "New recording" on every phone.

- In `src/core/capture/recording.ts` `startRecordingSession` (and anywhere else a recording session row is created with `DEFAULT_RECORDING_TITLE`), create the row with `title_auto = 1`.
- In the `changes.ts` rule, also require the local title to differ from `DEFAULT_RECORDING_TITLE` before treating it as typed. If `DEFAULT_RECORDING_TITLE` lives in `recording.ts` and importing it would make a cycle, copy the string into a constant with a comment naming where it comes from.
- Test in `test/sync.test.ts`, using two devices as the existing tests do:
  1. A starts a recording and syncs it to B.
  2. A stops, and `nameRecording` sets an app title.
  3. B applies the change and syncs back.
  4. Both phones end with A's app title and `title_auto = 1`.

### 2. A summary made before a line was hidden is not written

In `src/platform/summary.ts`, keep the text the run started from: the joined `studyUnits` text. Before `applySummary`, read `studyUnits` again. If the text differs, call `release()` and return, so the run is made again from the current text. Do the same comparison inside `shouldStop`, cheaply: compare a length plus a hash of the joined text, not the whole string each time.

Test in `test/summarize-session.test.ts`: a line hidden during the model call gives no summary from the old text, and the next run leaves the line out.

### 3. The student's own model requests come first

- Add a small module `src/platform/modelTurn.ts` with:

  ```ts
  // The on-device model takes one request at a time. A request the person asked for (flashcards, quiz, help) comes before
  // the automatic summary: the summary stops at its next step and runs again later.
  let waiting = 0;
  export function personWaiting(): boolean { return waiting > 0; }
  export async function asPerson<T>(run: () => Promise<T>): Promise<T> {
    waiting += 1;
    try {
      // The summary step that is running finishes first: retry "busy" for up to 8 seconds.
      const until = Date.now() + 8_000;
      for (;;) {
        try {
          return await run();
        } catch (error) {
          const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
          if (code !== "busy" || Date.now() > until) throw error;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    } finally {
      waiting -= 1;
    }
  }
  ```

- Wrap the person-initiated model calls in `asPerson`. Find them where flashcards, quiz and problem help call the waypoint-model module (`src/core/study/generate.ts` callers in `MakeCardsScreen.tsx`, `QuizScreen.tsx` and `HelpStepsScreen.tsx`, or the platform functions they use). Wrap each individual native call, so a multi-group run yields between groups too. Keep `src/core` free of platform imports: if the calls are made in core, pass the wrapper in as a dependency.
- In `src/platform/summary.ts` `shouldStop`, also stop when `personWaiting()` is true. That is a release, so the summary runs again later.
- Don't summarize while Edit is on. In `SessionScreen.tsx`, the effect that calls `summarizeSession` does nothing while the line editor is on. It runs when Edit turns off.
- Tests:
  - `asPerson` retries `busy`, then succeeds.
  - It gives up after the deadline.
  - The summary stops and releases when `personWaiting()` is true.

  Use fake timers.

### 4. Don't rewrite a part while someone is typing in it

- In `src/platform/transcription.ts`, add `let editingSession: string | null = null; export function setEditingSession(id: string | null): void { editingSession = id; }`.
- In `tick`, skip that session while it is set.
- In `src/features/capture/useLineEditor.ts`, call `setEditingSession(sessionId)` when a line opens, and `setEditingSession(null)` when it closes or the editor unmounts.

### 5. One app name in the AI disclosure

In `src/ui/QuoteBox.tsx` and `src/features/settings/CloudScreen.tsx`, the Cloudflare sentences say "for NotePath", not "for Waypoint". Search `src/features` and `src/ui` for any other user-facing "Waypoint" and change it to "NotePath". Report each change. Code identifiers and comments stay as they are.

### 6. Phones upgrading from build 6 fetch shared spaces again once

At the end of migration 11's SQL in `src/core/db/schema.ts`, add:

```sql
-- Build 6 skipped change kinds it did not know (line marks, notes): fetch each shared space's history again once.
UPDATE sync_state SET last_seq = 0;
```

Check:
- the table and column names in the schema;
- that applying a space's history again is idempotent: "older" changes are ignored, and existing rows are kept;
- that `test/migrate.test.ts` still passes, with a test that a `sync_state` row's `last_seq` is 0 after migrating from 10.

### Checks

From `apps/mobile`, run `npm run typecheck`, `npm test` and `npm run export:ios`. If any Swift changed, also run `npm run test:swift` and the native compile.
