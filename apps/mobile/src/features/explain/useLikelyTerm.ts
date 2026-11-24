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
