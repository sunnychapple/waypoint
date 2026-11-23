# Usage notes 6: the cloud model as a supplement for flashcards and quizzes

The owner's decision of 22 Nov 2026: when Apple's on-device model is not good enough, supplement it with Waypoint's own low-cost cloud models, with no subject-specific code. Written against `main` at `dff9a95`. Paths are under `apps/mobile/` unless they start with `docs/`.

This card uses the Practice set job that is already live, so it needs no server change, deploy or database migration. A person always sees the price and what is sent, and taps to send it. Nothing is sent automatically.

Not in this card: problem help in the cloud (it needs a new job type and a production database change), and adding Qwen to the live routes.

---

## U11 · Make with the cloud, and turn the result into flashcards

Branch `feat/u11-cloud-study`. Files, and no others:

- `src/core/made/practice.ts`
- `test/made.test.ts`
- `src/features/made/PracticeScreen.tsx`
- `src/features/study/MakeCardsScreen.tsx`
- `src/features/study/QuizScreen.tsx`
- `src/ui/QuoteBox.tsx`
- `docs/cards/usage-notes-6.md` (new: this file, copied as it is)

### practice.ts

Add `import type { NewCard } from "../study/cards.ts";` and, at the end of the file:

```ts
// A practice set as flashcards: the question on the front, the right answer and why on the back.
export function practiceCards(questions: PracticeQuestion[]): NewCard[] {
  return questions.map((question) => {
    const answer = question.kind === "multiple_choice" ? (question.choices[question.answer] ?? "") : question.answer;
    return { kind: "question", front: question.prompt, back: `${answer}\n\n${question.explanation}`, captureId: null, t: null };
  });
}
```

Tests in `test/made.test.ts`, using its `PRACTICE` value:
- A multiple choice question becomes a `question` card with the prompt on the front and the right choice then the explanation on the back.
- A short answer question becomes a card the same way.
- `captureId` and `t` are null.
- Saved with `saveCards(db, deps, sessionId, cards, "quiz_miss")`, the cards are stored, and saving them a second time adds none.

### PracticeScreen.tsx

1. Imports: add `randomUUID` from `expo-crypto`, `practiceCards` to the `practice.ts` import, `saveCards` from `../../core/study/cards.ts`, and `writeDb` to the `db.ts` import.

2. Add at the end of the file, before `const styles`:

```tsx
// Saves the set as flashcards in its session. Saving twice adds nothing, because a session never repeats a card's front.
function AddToCards({ sessionId, questions }: { sessionId: string | null; questions: PracticeQuestion[] }) {
  const [added, setAdded] = useState<number | null>(null);
  if (sessionId === null) return null;
  if (added !== null) return <Caption>{added === 0 ? "These are already in your flashcards." : `Added ${added} to your flashcards.`}</Caption>;
  return (
    <SecondaryButton
      label="Add to flashcards"
      onPress={() => setAdded(writeDb((db) => saveCards(db, { now: Date.now, newId: randomUUID }, sessionId, practiceCards(questions), "quiz_miss")).length)}
    />
  );
}
```

   Import `type PracticeQuestion` from `practice.ts` too.

3. On the finished screen, right after the `Try again` `PrimaryButton`, add `<AddToCards sessionId={item.sessionId} questions={questions} />`.

4. On the question screen, so a person can keep the cards without answering first, add right after `<Caption>{`Question ${position + 1} of ${total}`}</Caption>`:

```tsx
      {position === 0 && answer === null ? <AddToCards sessionId={item.sessionId} questions={questions} /> : null}
```

### MakeCardsScreen.tsx

1. On the "You have N cards" screen, after `Make more`:

```tsx
        <SecondaryButton label="Make with the cloud" icon="cloud" onPress={() => router.push(`/made/new?sessionId=${sessionId}&kind=practice`)} />
```

2. In the failed state, change the label `Make a Practice set` to `Make with the cloud`, and add `icon="cloud"`.

### QuizScreen.tsx

1. In the failed state, change the label `Make a Practice set` to `Make with the cloud`, and add `icon="cloud"`.

2. On the finished screen, just before the `Done` button:

```tsx
        <SecondaryButton label="Questions look wrong? Make with the cloud" icon="cloud" onPress={() => router.push(`/made/new?sessionId=${sessionId}&kind=practice`)} />
```

### QuoteBox.tsx

Someone out of credits today sees only Try again. Add `import { router } from "expo-router";`, and right after the `signIn` button inside the `failure !== null` block:

```tsx
          {failure.kind === "out_of_credits" ? (
            <SecondaryButton label="Get credits" onPress={() => router.push(`/plans?need=${failure.shortfall}`)} />
          ) : null}
```
