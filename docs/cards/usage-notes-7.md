# Usage notes 7: fixes from the cloud study review

Fable's review of PR #224. Written against `main` at `59d63d4`. Paths are under `apps/mobile/` unless they start with `docs/`.

---

## U12 · Remove a wrong card, say when text is cut, and finish the cloud path

Branch `fix/u12-cloud-study-review`. Files, and no others:

- `src/core/study/cards.ts`
- `test/cards.test.ts`
- `src/core/research/research.ts`
- `test/research.test.ts`
- `src/platform/made.ts`
- `src/features/study/ReviewScreen.tsx`
- `src/features/made/NewMadeScreen.tsx`
- `src/features/made/PracticeScreen.tsx`
- `src/features/study/ModelUnavailable.tsx`
- `src/features/study/MakeCardsScreen.tsx`
- `src/features/study/QuizScreen.tsx`
- `src/features/settings/CloudScreen.tsx`
- `docs/cards/usage-notes-7.md` (new: this file, copied as it is)

### cards.ts

Add after `saveCards`:

```ts
// Removes one card for good, for example one the on-device model got wrong. A synced space gets the delete too.
export function deleteCard(db: SqlDb, id: string): void {
  db.run("DELETE FROM cards WHERE id = ?", [id]);
}
```

Test in `test/cards.test.ts`: after saving two cards and deleting one, `sessionCards` returns only the other, and deleting an unknown id changes nothing.

### ReviewScreen.tsx

1. Add `Alert` to the `react-native` import, `deleteCard` to the `cards.ts` import, and `import { spaceGroups } from "../../core/groups/groups.ts";`.

2. After `flip()`:

```tsx
  // A card the model got wrong can be taken out. The next card takes its place.
  function removeCard() {
    Alert.alert("Remove this card?", "It won't come back in your reviews.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          writeDb((db) => deleteCard(db, cardId));
          setDeck(deck.filter((item) => item.id !== cardId));
          setMissed(missed.filter((item) => item.id !== cardId));
          setFlipped(false);
          setRevealed(false);
        },
      },
    ]);
  }

  // A viewer of a shared space cannot change its notes.
  const session = getSession(getDb(), card.sessionId);
  const canRemove = session === null || spaceGroups(getDb()).get(session.spaceId)?.role !== "viewer";
```

3. Just before the closing `</Screen>` of the card view (after the `revealed` block):

```tsx
      {canRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove this card" onPress={removeCard} style={styles.remove}>
          <Text style={[styles.removeText, { color: colors.ink3 }]}>Remove this card</Text>
        </Pressable>
      ) : null}
```

4. Styles: `remove: { minHeight: 44, alignItems: "center", justifyContent: "center" },` and `removeText: { fontSize: 15, fontWeight: "600" },`.

### research.ts

Split the text building out of `notesForResearch`, with no change to what it returns:

```ts
function allNotes(db: SqlDb, sessionId: string): string {
  const transcript = db
    .all<{ text: string }>("SELECT text FROM segments WHERE session_id = ? AND source = 'device' ORDER BY t_start", [sessionId])
    .map((r) => r.text);
  const pages = db
    .all<{ found_text: string | null }>("SELECT found_text FROM captures WHERE session_id = ? AND kind IN ('page', 'photo') ORDER BY position, t", [sessionId])
    .map((r) => r.found_text ?? "");
  return [...transcript, ...pages].join(" ").replace(/\s+/g, " ").trim();
}

// True when a session has more text than `max`, so a cloud task sends only the first part.
export function notesAreCut(db: SqlDb, sessionId: string, max: number): boolean {
  return allNotes(db, sessionId).length > max;
}
```

`notesForResearch` keeps its comment and signature, and starts with `const text = allNotes(db, sessionId);`.

Test in `test/research.test.ts`: `notesAreCut` is false at exactly `max` characters and true at one more.

### made.ts

Import `notesAreCut` with `notesForResearch`, and add:

```ts
export function madeTextIsCut(sessionId: string, kind: MadeKind): boolean {
  return notesAreCut(getDb(), sessionId, JOB_TEXT_MAX_CHARS[kind]);
}
```

### NewMadeScreen.tsx

Import `madeTextIsCut` with `madeText`. After `const hasText = text !== "";` add:

```ts
  const isCut = sessionId !== null && hasText && madeTextIsCut(sessionId, kind);
```

Right after the `{skipped !== null ? …}` line add:

```tsx
      {isCut ? <Caption>This session is long. Only the first part is sent, so the end of the recording and any pages may be left out.</Caption> : null}
```

### PracticeScreen.tsx

1. Keep the result in the screen, so it survives moving from the questions to the score. In `PracticeScreen`, with the other state: `const [added, setAdded] = useState<number | null>(null);`

2. Both uses become `<AddToCards sessionId={item.sessionId} questions={questions} added={added} onAdded={setAdded} />`.

3. Replace `AddToCards`'s signature, remove its own `added` state, and replace its `added !== null` line:

```tsx
function AddToCards({
  sessionId,
  questions,
  added,
  onAdded,
}: {
  sessionId: string | null;
  questions: PracticeQuestion[];
  added: number | null;
  onAdded: (count: number) => void;
}) {
```

```tsx
  if (added !== null) {
    return (
      <>
        <Caption>{added === 0 ? "These are already in your flashcards." : `Added ${added} to your flashcards.`}</Caption>
        <SecondaryButton label="Practise these" onPress={() => router.push(`/study/review?sessionId=${sessionId}&all=1`)} />
      </>
    );
  }
```

   and the press handler calls `onAdded(writeDb(…).length)` in place of `setAdded(…)`.

### ModelUnavailable.tsx

The button label becomes `Make with the cloud`, with `icon="cloud"`.

### MakeCardsScreen.tsx

The on-device model doesn't support every language, but the cloud model can help. Replace the unsupported line:

```tsx
      {outcome === "unsupported" ? (
        <>
          <Title>{UNSUPPORTED_LANGUAGE_LINE}</Title>
          <SecondaryButton label="Make with the cloud" icon="cloud" onPress={() => router.push(`/made/new?sessionId=${sessionId}&kind=practice`)} />
        </>
      ) : null}
```

### QuizScreen.tsx

In the `outcome === "unsupported"` screen, after the `Title`:

```tsx
        <SecondaryButton label="Make with the cloud" icon="cloud" onPress={() => router.push(`/made/new?sessionId=${sessionId}&kind=practice`)} />
```

### CloudScreen.tsx

Replace the opening sentence, so it stays true now that the study screens offer a cloud option:

```tsx
      <Body>Recording, pages, flashcards, quizzes and search work on this iPhone. Only the cloud tasks you tap send text, and only for that task.</Body>
```
