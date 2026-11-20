import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import type { ExplainRequest, StreamDone } from "@waypoint/contracts";
import { listSegments } from "../../core/capture/segments.ts";
import { keepsKey, type CloudFailure } from "../../core/cloud/failure.ts";
import { excerptAround } from "../../core/explain/excerpt.ts";
import { addToThread, discardIfUnsaved, startExplanation, type Explanation } from "../../core/explain/explanations.ts";
import { askLater } from "../../core/explain/later.ts";
import { logSent, settleFailedSent, settleSent } from "../../core/explain/sent.ts";
import { getDb, writeDb } from "../../platform/db.ts";
import { requireApprovedDevice } from "../../platform/device.ts";
import { streamExplain, toFailure } from "../../platform/tasks.ts";

const deps = { now: Date.now, newId: randomUUID };

export type ExplainPhase =
  | { kind: "ready" }
  | { kind: "streaming"; text: string }
  | { kind: "done"; text: string; retention: "standard" | "zero"; credits: number; sentId: string; unsaved: boolean }
  | { kind: "failed"; failure: CloudFailure; text: string };

// One tapped word: the excerpt around it, the request, and what came back. The Idempotency-Key is made when the person
// taps Explain and kept for a "Try again" only when the request did not run (keepsKey).
export function useExplain(sessionId: string, t: number, word: string) {
  const [excerpt] = useState(() => excerptAround(listSegments(getDb(), sessionId), t));
  const [phase, setPhase] = useState<ExplainPhase>({ kind: "ready" });
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [askedLater, setAskedLater] = useState(false);
  const key = useRef<string | null>(null);
  const idRef = useRef<string | null>(null);
  const cancelled = useRef(false);
  const controller = useRef<AbortController | null>(null);

  // Closing the sheet keeps only saved explanations (M16 adds Save). It also aborts a stream still running; the server
  // settles that request anyway, and no unsaved explanation row is written after this.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      controller.current?.abort();
      const id = idRef.current;
      if (id !== null) writeDb((db) => discardIfUnsaved(db, id));
    };
  }, []);

  async function explain(): Promise<void> {
    if (excerpt === "" || phase.kind === "streaming") return;
    if (!requireApprovedDevice()) return;
    const requestKey = key.current ?? randomUUID();
    key.current = requestKey;
    const request: ExplainRequest = { word, transcript: excerpt };
    writeDb((db) => logSent(db, { id: requestKey, task: "explain", sessionId, body: request, at: Date.now() }));
    const abort = new AbortController();
    controller.current = abort;
    let text = "";
    setPhase({ kind: "streaming", text });
    let done: StreamDone;
    try {
      done = await streamExplain(request, requestKey, (piece) => {
        text += piece;
        setPhase({ kind: "streaming", text });
      }, abort.signal);
    } catch (error) {
      if (cancelled.current) return; // closed mid-stream: nothing more is written here
      const failure = toFailure(error);
      if (!keepsKey(failure)) {
        writeDb((db) => settleFailedSent(db, requestKey, failure));
        key.current = null;
      }
      setPhase({ kind: "failed", failure, text });
      return;
    }
    // The answer is paid for and is shown even if saving it on the iPhone fails. A save failure is not a cloud failure,
    // so the key is kept and there is no "Try again".
    let saved: Explanation | null = null;
    let unsaved = false;
    try {
      saved = writeDb((db) => {
        settleSent(db, requestKey, done.credits, done.retention);
        if (cancelled.current) return null;
        const id = idRef.current ?? startExplanation(db, deps, sessionId, t, word).id;
        idRef.current = id;
        return addToThread(db, id, { kind: "explain", text, at: Date.now(), retention: done.retention, sentId: requestKey });
      });
    } catch {
      unsaved = true;
    }
    key.current = unsaved ? requestKey : null;
    if (saved !== null) setExplanation(saved);
    setPhase({ kind: "done", text, retention: done.retention, credits: done.credits, sentId: requestKey, unsaved });
  }

  function saveForLater(): void {
    if (askedLater) return;
    writeDb((db) => askLater(db, deps, sessionId, t, word));
    setAskedLater(true);
  }

  return { excerpt, phase, explanation, askedLater, explain, saveForLater };
}
