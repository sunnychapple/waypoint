# Usage notes 4: Continue recording

From the owner's class notes of 22 Nov 2026 (notes 23 and 24, board S8 in `waypoint-usage-notes-2026-11-22.pen`). Paths are under `apps/mobile/` unless they start with `docs/`.

---

## U8 · Pick a recording back up, in the same session

Branch `feat/u8-continue-recording`. Files, and no others:

- `modules/waypoint-audio/ios/Core/RecordingTimeline.swift`
- `modules/waypoint-audio/ios/Tests/RecordingTimelineTests.swift`
- `modules/waypoint-audio/ios/AudioRecorder.swift`
- `modules/waypoint-audio/ios/WaypointAudioModule.swift`
- `modules/waypoint-audio/src/WaypointAudio.ts`
- `src/core/capture/recording.ts`
- `test/recording.test.ts`
- `src/features/capture/useRecording.ts`
- `src/features/capture/RecordScreen.tsx`
- `src/features/capture/SessionScreen.tsx`
- `docs/cards/usage-notes-4.md` (new: this file, copied as it is)

A saved session gets a Continue recording button. New audio is added to the same session, after a gap, on the same timeline. Nothing already recorded is changed. There is no Discard while continuing, because Discard deletes the whole session.

### RecordingTimeline.swift

1. Add two stored values after `maxPartMs`:

```swift
  let firstIndex: Int          // the next free part number, when a saved session is continued
  let priorRecordedMs: Int64   // what the session had recorded before this recorder started
```

2. Replace `init`:

```swift
  init(sessionStart: Int64, maxPartMs: Int64 = 300_000, firstIndex: Int = 0, priorRecordedMs: Int64 = 0) {
    self.sessionStart = sessionStart
    self.maxPartMs = maxPartMs
    self.firstIndex = firstIndex
    self.priorRecordedMs = priorRecordedMs
  }
```

3. In `recordedMs(now:)`, add `priorRecordedMs +` at the start of the expression.

4. In `openPart`, use `let index = firstIndex + finishedParts.count`.

Tests to add, in the file's style:
- With `firstIndex: 3`, the first part has index 3, a rolled part has index 4, and after `cancelRun` the next `startRun` has index 3 again.
- With `priorRecordedMs: 60_000`, `recordedMs` before any run is 60,000 and 10 seconds into a run is 70,000.
- With `sessionStart: now - 500_000`, a run started at `now` has `startMs` 500,000.

### AudioRecorder.swift

Replace the signature and the timeline line in `start`:

```swift
  func start(sessionId: String, elapsedMs: Int64 = 0, firstIndex: Int = 0, priorRecordedMs: Int64 = 0) throws {
```

```swift
        self.timeline = RecordingTimeline(
          sessionStart: Self.now() - elapsedMs, maxPartMs: Self.maxPartMs, firstIndex: firstIndex, priorRecordedMs: priorRecordedMs)
```

### WaypointAudioModule.swift

```swift
    AsyncFunction("start") { (sessionId: String, elapsedMs: Double, firstIndex: Int, priorRecordedMs: Double) throws in
      try self.recorder.start(
        sessionId: sessionId, elapsedMs: Int64(elapsedMs), firstIndex: firstIndex, priorRecordedMs: Int64(priorRecordedMs))
    }
```

### WaypointAudio.ts

1. Add, next to the other types:

```ts
// Where a recorder picks up a saved session: time since the session started, the next part number, and what it already holds.
export type ContinueFrom = { elapsedMs: number; firstIndex: number; priorRecordedMs: number };
```

2. In the class: `start(sessionId: string, elapsedMs: number, firstIndex: number, priorRecordedMs: number): Promise<void>;`

3. Replace `startRecording`:

```ts
export const startRecording = (sessionId: string, from: ContinueFrom = { elapsedMs: 0, firstIndex: 0, priorRecordedMs: 0 }): Promise<void> =>
  native.start(sessionId, from.elapsedMs, from.firstIndex, from.priorRecordedMs);
```

### recording.ts

1. Add `import { listSegments } from "./segments.ts";` and change the `transcript.ts` import to `import { partsNeedingTranscription, type Piece } from "./transcript.ts";`. Code in `src/core` does not import from `modules/`, so `ContinueFrom` is declared again here; the two have the same shape.

2. Add after `startRecordingSession`:

```ts
type ContinueFrom = { elapsedMs: number; firstIndex: number; priorRecordedMs: number };

export type PriorTimeline = {
  finals: Piece[];
  parts: { sessionId: string; index: number; startMs: number; durationMs: number; file: string }[];
  resumes: number[];
  flags: number[];
  photos: { id: string; t: number; file: string }[];
};

export type ContinuedRecording = {
  session: SessionRow;
  from: ContinueFrom;
  prior: PriorTimeline;
  restore: { state: SessionRow["state"]; transcript: string; endedAt: number | null };
};

// What a saved session already holds, for the live screen to draw above the new words.
function priorTimeline(db: SqlDb, sessionId: string): PriorTimeline {
  const parts = db
    .all<{ position: number; t: number; duration_ms: number | null; file: string }>(
      "SELECT position, t, duration_ms, file FROM captures WHERE session_id = ? AND kind = 'audio' ORDER BY position, id",
      [sessionId],
    )
    .map((row) => ({ sessionId, index: row.position, startMs: row.t, durationMs: row.duration_ms ?? 0, file: row.file }));
  return {
    finals: listSegments(db, sessionId).map((segment) => ({ ...segment, isFinal: true })),
    parts,
    // The same reading as the saved session's timeline: each part after the first starts at a resume.
    resumes: parts.slice(1).filter((_, i) => (parts[i]?.durationMs ?? 0) > 0).map((part) => part.startMs),
    flags: db.all<{ t: number }>("SELECT t FROM flags WHERE session_id = ? ORDER BY t", [sessionId]).map((row) => row.t),
    photos: db.all<{ id: string; t: number; file: string }>(
      "SELECT id, t, file FROM captures WHERE session_id = ? AND kind = 'photo' ORDER BY t, id",
      [sessionId],
    ),
  };
}

// Reopens a saved recording. Null when it is not a finished recording. New words are written live when the speech pack
// is installed; otherwise the new audio waits to be transcribed. `ended_at` holds the time it was reopened, so another
// phone can tell the recording is active (see mayRecover).
export function continueRecordingSession(db: SqlDb, deps: Deps, sessionId: string, speechReady: boolean): ContinuedRecording | null {
  const session = getSession(db, sessionId);
  if (session === null || session.kind !== "recording" || (session.state !== "saved" && session.state !== "interrupted")) return null;
  const prior = priorTimeline(db, sessionId);
  const lastEnd = prior.parts.reduce((end, part) => Math.max(end, part.startMs + part.durationMs), 0);
  const firstIndex = prior.parts.reduce((next, part) => Math.max(next, part.index + 1), 0);
  const now = deps.now();
  const transcript =
    session.transcript === "done" ? (speechReady ? "live" : "waiting") : session.transcript === "failed" ? "waiting" : session.transcript;
  db.transaction(() => {
    db.run("UPDATE sessions SET state = 'recording', transcript = ?, ended_at = ?, indexed_at = NULL WHERE id = ?", [transcript, now, sessionId]);
    db.run("UPDATE spaces SET last_used_at = ? WHERE id = ?", [now, session.spaceId]);
    setSetting(db, `${RECORDING_HERE_PREFIX}${sessionId}`, "1");
  });
  return {
    session: { ...session, state: "recording", transcript },
    // At least a second after the last part, so a changed iPhone clock cannot make new audio overlap the old.
    from: { elapsedMs: Math.max(now - session.startedAt, lastEnd + 1000), firstIndex, priorRecordedMs: session.recordedMs },
    prior,
    restore: { state: session.state, transcript: session.transcript, endedAt: session.endedAt },
  };
}

// The recorder could not start: the session goes back to how it was.
export function undoContinue(db: SqlDb, sessionId: string, restore: ContinuedRecording["restore"]): void {
  db.run("UPDATE sessions SET state = ?, transcript = ?, ended_at = ? WHERE id = ?", [restore.state, restore.transcript, restore.endedAt, sessionId]);
  deleteSetting(db, `${RECORDING_HERE_PREFIX}${sessionId}`);
}
```

3. A reopened session's `started_at` can be days old, so "unfinished for a day" must count from its last activity. In `mayRecover`, replace the line with `ABANDONED_AFTER_MS`:

```ts
  if (shared === null) return true;
  const activity = db.get<{ at: number }>(
    `SELECT max(s.started_at, COALESCE(s.ended_at, 0), s.started_at + COALESCE(
       (SELECT MAX(c.t + COALESCE(c.duration_ms, 0)) FROM captures c WHERE c.session_id = s.id AND c.kind = 'audio'), 0)) AS at
     FROM sessions s WHERE s.id = ?`,
    [session.id],
  );
  if (now - (activity?.at ?? session.started_at) >= ABANDONED_AFTER_MS) return true;
```

   and update the comment above `mayRecover`: "or the session has shown no activity for a day".

4. In `recoverSessions`, the end time must also cover a reopened session. Replace the `ended_at = COALESCE(ended_at, started_at + (…))` assignment with:

```sql
           ended_at = max(COALESCE(ended_at, 0), started_at + (
             SELECT COALESCE(MAX(t + COALESCE(duration_ms, 0)), 0) FROM captures WHERE session_id = sessions.id AND kind = 'audio'))
```

Tests to add in `test/recording.test.ts`:
- `continueRecordingSession` on a saved session returns `firstIndex` one past the highest part position (use positions 0 and 2), `priorRecordedMs` equal to its `recordedMs`, `elapsedMs` equal to `now - startedAt`, and sets the row to `recording`.
- `elapsedMs` is `lastEnd + 1000` when the clock is earlier than the last part's end.
- Transcript: `done` becomes `live` with speech and `waiting` without; `failed` becomes `waiting`; `waiting` stays.
- It returns null for a missing session, a `pages` session, and a session still `recording`.
- `prior` holds the saved words, parts, flags and photos, and `resumes` holds the start of each part after the first.
- `undoContinue` restores state, transcript and `ended_at`, and clears the marker (so another member's phone would not count it as ours).
- A continued session that crashes keeps its old audio's length in `recorded_ms`, and `recoverSessions` leaves `ended_at` no earlier than its last part's end.
- In a shared space, a session started two days ago and reopened an hour ago on another phone (`ended_at` an hour ago, no marker) is left alone. With its last activity more than a day ago it is recovered.

### useRecording.ts

1. Imports: add `useLocalSearchParams` to the `expo-router` import, `getSpace` to the `spaces.ts` import, and `continueRecordingSession`, `undoContinue`, `DEFAULT_RECORDING_TITLE` and `type ContinuedRecording` to the `recording.ts` import.

2. `RecordingModel`: add `title: string;` and `continuing: boolean;`.

3. At the top of `useRecording`:

```ts
  const { continue: continueId } = useLocalSearchParams<{ continue?: string }>();
  const [title, setTitle] = useState(DEFAULT_RECORDING_TITLE);
```

   and next to `sessionRef`: `const continuedRef = useRef<ContinuedRecording | null>(null);`

4. In the start effect, replace from `const created = writeDb(…` through `await startRecording(created.session.id);`:

```ts
        const created = writeDb((db) => {
          if (continueId === undefined) {
            const space = getSavingTo(db);
            return { spaceName: space.name, session: startRecordingSession(db, deps, space.id, speech.pack === "installed"), continued: null };
          }
          const continued = continueRecordingSession(db, deps, continueId, speech.pack === "installed");
          if (continued === null) return null;
          return { spaceName: getSpace(db, continued.session.spaceId)?.name ?? "", session: continued.session, continued };
        });
        if (created === null) {
          Alert.alert("Couldn't continue this recording.", undefined, [{ text: "OK", onPress: () => router.back() }]);
          return;
        }
        sessionRef.current = created.session;
        continuedRef.current = created.continued;
        if (created.continued !== null) {
          const { prior, from } = created.continued;
          setTitle(created.session.title);
          setLive({ finals: prior.finals, volatile: null });
          setParts(prior.parts);
          setResumes(prior.resumes);
          setFlags(prior.flags);
          setPhotos(prior.photos);
          setAnchor({ ms: from.priorRecordedMs, at: Date.now() });
        }
        setSpaceName(created.spaceName);
        setPack(speech.pack);
        setPhase("recording");
        await startRecording(created.session.id, created.continued?.from);
```

5. Replace `setAnchor({ ms: 0, at: Date.now() });` (after the recorder started) with:

```ts
        setAnchor({ ms: created.continued?.from.priorRecordedMs ?? 0, at: Date.now() });
```

6. In the `catch`, replace the two lines that delete the row and the files:

```ts
        const continued = continuedRef.current;
        if (continued !== null) {
          // A session that already held a recording keeps it.
          writeDb((db) => undoContinue(db, failed.id, continued.restore));
        } else {
          writeDb((db) => deleteSessionRow(db, failed.id));
          deleteSessionFiles(failed.id);
        }
```

7. In `stop()`, replace `router.replace(`/session/${current.id}`);` with:

```ts
      // A continued recording was opened from its session, so going back lands there.
      if (continuedRef.current !== null) router.back();
      else router.replace(`/session/${current.id}`);
```

8. In `discard()`, after the first guard, add `if (continuedRef.current !== null) return; // discarding would delete what was already saved`.

9. Return `title,` and `continuing: continueId !== undefined,` from the hook.

### RecordScreen.tsx

1. `<Title>New recording</Title>` becomes `<Title>{model.title}</Title>`.

2. In `close()`, before the existing `Alert.alert`, add:

```tsx
    if (model.continuing) {
      Alert.alert("End this recording?", "What you recorded stays in this session.", [
        { text: "Keep recording", style: "cancel" },
        { text: "Stop and save", onPress: model.stop },
      ]);
      return;
    }
```

### SessionScreen.tsx

1. Add inside the component, next to `openMenu`:

```tsx
  function continueRecording() {
    if (getRecorderStatus().state !== "idle") {
      Alert.alert("Already recording", "Stop the other recording first.");
      return;
    }
    router.push(`/recording?continue=${encodeURIComponent(id)}`);
  }
```

2. Right after the `{playable ? <RecordingPlayer … /> : null}` line:

```tsx
        {session.kind === "recording" && (session.state === "saved" || session.state === "interrupted") && role !== "viewer" ? (
          <SecondaryButton label="Continue recording" icon="mic.fill" onPress={continueRecording} />
        ) : null}
```
