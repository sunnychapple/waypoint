import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
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
  save: () => void;
};

// Edit (S4, S13, note 12): one line is open for typing at a time. Opening another line, the line losing the keyboard,
// turning Edit off, or leaving the screen saves it. The app leaving the front saves it too, and the line stays open with
// what was typed, so nothing is lost if iOS closes the app. The heard words stay in segments (editLine). textOf gives a
// line's shown text, so an unchanged line writes nothing. Every handler is stable, and so is the returned object while its
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

  const write = useCallback((at: number, text: string | null): void => {
    const id = sessionRef.current;
    if (id === null) return;
    try {
      writeDb((db) => editLine(db, deps, id, at, text));
    } catch {
      // The notes closed (sign-out) or the session went away: there is nowhere to keep it.
    }
  }, []);
  // Keeps what was typed in the open line, which stays open: the typed text is kept until another line opens or Edit changes.
  const save = useCallback((): void => {
    const at = openRef.current;
    const text = typedRef.current;
    if (at === null || text === null || text === textOfRef.current(at)) return;
    write(at, text);
  }, [write]);
  const show = useCallback((at: number | null): void => {
    openRef.current = at;
    typedRef.current = null;
    setOpen(at);
  }, []);
  // Leaving the screen with a line open keeps what was typed.
  useEffect(() => save, [save]);
  // The app leaving the front (iOS may close it next) keeps what was typed.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") save();
    });
    return () => subscription.remove();
  }, [save]);

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
  const undoLine = useCallback((at: number): void => write(at, null), [write]);

  return useMemo(
    () => ({ on, open, setOn, openLine, typed, blurLine, undoLine, save }),
    [on, open, setOn, openLine, typed, blurLine, undoLine, save],
  );
}
