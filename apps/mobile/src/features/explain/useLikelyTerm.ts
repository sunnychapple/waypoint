import { useEffect, useState } from "react";
import { getRecorderStatus } from "../../../modules/waypoint-audio/index.ts";
import { cancelLikelyTerm, getAvailability, likelyTerm } from "../../../modules/waypoint-model/index.ts";
import { editLine } from "../../core/capture/marks.ts";
import { listSegments, studyLines } from "../../core/capture/segments.ts";
import { getSession } from "../../core/capture/sessions.ts";
import { isLiveSession } from "../../core/capture/recording.ts";
import { replaceWord, cleanTermGuess, type TermGuess } from "../../core/explain/term.ts";
import { spaceGroups } from "../../core/groups/groups.ts";
import { getDb, writeDb } from "../../platform/db.ts";

const deps = { now: Date.now };

// S3: asked once as the sheet opens, on this iPhone, for a word from a transcript. Not for a page's words, nor while this
// iPhone records the session. Null until there is a guess, and when there is none. keep() hides it.
// S6: fix() puts the suggested term in place of the heard word (the `index`-th word of its line) through editLine, so the
// original stays and Undo restores it. Only for a transcript word, by a person who may change the session, and not while
// this iPhone records it.
export function useLikelyTerm(
  sessionId: string,
  t: number,
  word: string,
  index: number | undefined,
  excerpt: string,
  fromTranscript: boolean,
): { guess: TermGuess | null; keep: () => void; fix: () => boolean; fixed: boolean; canFix: boolean } {
  const [guess, setGuess] = useState<TermGuess | null>(null);
  const [fixed, setFixed] = useState(false);
  useEffect(() => {
    // A guess is for the word on screen now, so a previous word's suggestion is dropped at once.
    setGuess(null);
    setFixed(false);
    if (!fromTranscript || excerpt === "" || getAvailability() !== "available" || isLiveSession(getRecorderStatus(), sessionId)) return;
    let open = true;
    likelyTerm(word, excerpt).then(
      (raw) => {
        // Recording may have started while the model worked; a guess is then dropped, as it is for a closed sheet.
        if (open && !isLiveSession(getRecorderStatus(), sessionId)) setGuess(cleanTermGuess(raw, word));
      },
      () => undefined, // declined, busy or an unsupported language: no suggestion
    );
    return () => {
      open = false;
      cancelLikelyTerm();
    };
  }, [sessionId, word, excerpt, fromTranscript]);

  const db = getDb();
  const session = getSession(db, sessionId);
  const canFix =
    !fixed &&
    fromTranscript &&
    index !== undefined &&
    session !== null &&
    spaceGroups(db).get(session.spaceId)?.role !== "viewer" &&
    !isLiveSession(getRecorderStatus(), sessionId);

  // Changes the one line the word was tapped in. False when the line or the word is no longer there.
  function fix(): boolean {
    if (guess === null || index === undefined) return false;
    const current = getDb();
    // The line must be a heard line of this session; its shown text (with any edit) is what the word is counted in.
    const heard = listSegments(current, sessionId).some((segment) => segment.tStart === t);
    const shown = studyLines(current, sessionId).find((segment) => segment.tStart === t);
    const next = heard && shown !== undefined ? replaceWord(shown.text, index, guess.heard, guess.term) : null;
    if (next === null) return false;
    writeDb((write) => editLine(write, deps, sessionId, t, next));
    setFixed(true);
    return true;
  }

  return { guess, keep: () => setGuess(null), fix, fixed, canFix };
}
