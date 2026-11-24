import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
// shown text, so an unchanged line writes nothing. Every handler is stable, and so is the returned object while its
// values stay the same, so the paragraphs that do not change are not redrawn.
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

  const setOn = useCallback(
    (next: boolean): void => {
      save();
      show(null);
      setOnState(next);
    },
    [save, show],
  );
  const openLine = useCallback(
    (at: number): void => {
      save();
      show(at);
    },
    [save, show],
  );
  const typed = useCallback((text: string): void => {
    typedRef.current = text;
  }, []);
  // Ignored when another line has opened since: that one is open now.
  const blurLine = useCallback(
    (at: number): void => {
      if (openRef.current !== at) return;
      save();
      show(null);
    },
    [save, show],
  );
  const undoLine = useCallback((at: number): void => {
    const id = sessionRef.current;
    if (id !== null) writeDb((db) => editLine(db, deps, id, at, null));
  }, []);

  return useMemo(
    () => ({ on, open, setOn, openLine, typed, blurLine, undoLine }),
    [on, open, setOn, openLine, typed, blurLine, undoLine],
  );
}
