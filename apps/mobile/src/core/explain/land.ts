import type { SqlDb } from "../db/sql.ts";
import { addToThread, getExplanation, saveExplanationNow, startExplanation, type Explanation, type ThreadItem } from "./explanations.ts";
import { markAnswered } from "./later.ts";
import { settleSent } from "./sent.ts";

type Deps = { now: () => number; newId: () => string };

export type LandInput = {
  item: ThreadItem;
  credits: number;
  retention: "standard" | "zero";
  // The explanation this answer belongs to, or null for an explain that has none yet.
  existingId: string | null;
  // The sheet is closed. The answer still lands, and an explain still saves.
  closed: boolean;
  // The notes are the ones the request was sent from. When they changed, nothing is written.
  sameNotes: boolean;
  sessionId: string;
  t: number;
  word: string;
  captureId?: string | undefined;
  flagId?: string | undefined;
};

// Puts a finished answer into the notes it was asked from. Returns the updated explanation, or null when nothing was
// added. The settle comes first and is its own write, so it stays committed even if the thread write throws.
export function landAnswer(db: SqlDb, deps: Deps, input: LandInput): Explanation | null {
  const { item, existingId, closed, sessionId, t, word } = input;
  if (input.sameNotes) settleSent(db, item.sentId, input.credits, input.retention);
  if (!input.sameNotes) return null;
  // The person removed this answer from Saved, so closing the sheet discarded it. Do not recreate it.
  if (closed && existingId !== null && getExplanation(db, existingId) === null) return null;
  // A follow-up needs an explanation to continue.
  if (existingId === null && item.kind !== "explain") return null;

  let updated: Explanation | null = null;
  // One transaction: a new explanation, the thread item, the save and the answered flag all land, or none does.
  db.transaction(() => {
    const id = existingId ?? startExplanation(db, deps, sessionId, t, word, input.captureId ?? null).id;
    updated = addToThread(db, id, item);
    // A paid explanation is kept at once, so closing the sheet before Save cannot lose it. Follow-ups never save.
    if (item.kind === "explain") {
      saveExplanationNow(db, deps, id);
      updated = { ...updated, saved: true };
      // Explain answered a question from Questions for later: that flag is answered now. Only in the notes the flag came from.
      if (input.flagId !== undefined) markAnswered(db, input.flagId);
    }
  });
  return updated;
}
