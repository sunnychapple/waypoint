import { useEffect, useState } from "react";
import { getRecorderStatus } from "../../../modules/waypoint-audio/index.ts";
import { cancelLikelyTerm, getAvailability, likelyTerm } from "../../../modules/waypoint-model/index.ts";
import { isLiveSession } from "../../core/capture/recording.ts";
import { cleanTermGuess, type TermGuess } from "../../core/explain/term.ts";

// S3: asked once as the sheet opens, on this iPhone, for a word from a transcript. Not for a page's words, nor while this
// iPhone records the session. Null until there is a guess, and when there is none. keep() hides it.
export function useLikelyTerm(sessionId: string, word: string, excerpt: string, fromTranscript: boolean): { guess: TermGuess | null; keep: () => void } {
  const [guess, setGuess] = useState<TermGuess | null>(null);
  useEffect(() => {
    // A guess is for the word on screen now, so a previous word's suggestion is dropped at once.
    setGuess(null);
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
  return { guess, keep: () => setGuess(null) };
}
