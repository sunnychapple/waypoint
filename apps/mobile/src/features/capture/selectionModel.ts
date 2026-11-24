import { Alert } from "react-native";
import { router } from "expo-router";
import { coversSpan, setHidden, speakerRun, toggleHighlight, type LineMark } from "../../core/capture/marks.ts";
import { canExplain, nextSelection, pickedText, refKey, type Picked, type Selection, type WordRef } from "../../core/capture/selection.ts";
import type { TimelineLine } from "../../core/capture/timeline.ts";
import type { ExplainedTerm } from "../../core/explain/explanations.ts";
import { writeDb } from "../../platform/db.ts";

const deps = { now: Date.now };

export type SelectionInput = {
  sessionId: string | null;
  lines: TimelineLine[]; // the shown lines, in time order
  marks: ReadonlyMap<number, LineMark>;
  explained: ReadonlyMap<string, string>; // refKey → explanation id
  explanations: ExplainedTerm[];
  selection: Selection | null;
  setSelection: (next: Selection | null) => void;
  // false for a viewer of a shared space: no selection, no bar; a tapped word opens Explain (or its saved answer).
  canChange: boolean;
  onSelect?: (() => void) | undefined; // the live screen stops following new lines
};

export type SelectionModel = {
  picked: Picked | null;
  single: boolean;
  highlighted: boolean;
  canExplain: boolean;
  tapWord: (ref: WordRef, word: string) => void;
  explain: () => void;
  highlight: () => void;
  note: () => void;
  more: () => void;
  renameRun: (at: number) => void;
};

// The selection and what the bar does with it (S2).
export function selectionModel(input: SelectionInput): SelectionModel {
  const { sessionId, lines, marks, explained, explanations, selection, setSelection, canChange } = input;
  const found = selection === null ? null : pickedText(lines.map((line) => ({ at: line.at, text: line.text })), selection);
  const picked = found !== null && found.lines.length > 0 ? found : null;
  const starts = picked?.lines.map((line) => line.at) ?? [];

  function nameLines(at: number[]): void {
    if (!canChange || sessionId === null || at.length === 0) return;
    setSelection(null);
    router.push({ pathname: "/speaker", params: { sessionId, lines: at.join(",") } });
  }

  return {
    picked,
    single: selection !== null && refKey(selection.from) === refKey(selection.to),
    highlighted: picked !== null && picked.lines.every((line) => coversSpan(marks.get(line.at)?.highlights ?? [], [line.from, line.to])),
    canExplain: picked !== null && canExplain(picked.text),
    // With nothing selected, a word that was explained opens its saved answer (note 1).
    tapWord: (ref, word) => {
      if (sessionId === null) return;
      if (selection === null) {
        const id = explained.get(refKey(ref));
        const saved = explanations.find((e) => e.id === id);
        if (saved !== undefined) {
          router.push({ pathname: "/explain", params: { sessionId, t: String(saved.t), word: saved.term, explanationId: saved.id } });
          return;
        }
      }
      if (!canChange) {
        router.push({ pathname: "/explain", params: { sessionId, t: String(ref.at), word } });
        return;
      }
      input.onSelect?.();
      setSelection(nextSelection(selection, ref));
    },
    // The excerpt is taken around the first selected line (t), as for one tapped word.
    explain: () => {
      const first = picked?.lines[0];
      if (sessionId === null || picked === null || first === undefined || !canExplain(picked.text)) return;
      setSelection(null);
      router.push({ pathname: "/explain", params: { sessionId, t: String(first.at), word: picked.text } });
    },
    highlight: () => {
      if (!canChange || sessionId === null || picked === null) return;
      writeDb((db) => toggleHighlight(db, deps, sessionId, picked.lines));
      setSelection(null);
    },
    // A note made from words goes right after the line they end in.
    note: () => {
      const last = picked?.lines.at(-1);
      if (sessionId === null || picked === null || last === undefined) return;
      const end = lines.find((line) => line.at === last.at)?.end ?? last.at;
      setSelection(null);
      router.push({ pathname: "/note", params: { sessionId, t: String(end), quote: picked.text } });
    },
    more: () => {
      if (!canChange || sessionId === null || picked === null) return;
      const allHidden = starts.every((t) => marks.get(t)?.hidden === true);
      Alert.alert("Selected words", undefined, [
        { text: "Who's talking?", onPress: () => nameLines(starts) },
        {
          text: allHidden ? "Show these lines" : "Hide these lines",
          onPress: () => {
            writeDb((db) => setHidden(db, deps, sessionId, starts, !allHidden));
            setSelection(null);
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    // A tapped name changes the name of the run of lines it labels.
    renameRun: (at) => nameLines(speakerRun(lines.map((line) => ({ tStart: line.at, speaker: marks.get(line.at)?.speaker ?? null })), at)),
  };
}
