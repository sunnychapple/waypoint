import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import type { ExplainRequest } from "@waypoint/contracts";
import { listSegments } from "../../core/capture/segments.ts";
import { keepsKey, type CloudFailure } from "../../core/cloud/failure.ts";
import { excerptAround } from "../../core/explain/excerpt.ts";
import { addToThread, discardIfUnsaved, startExplanation, type Explanation } from "../../core/explain/explanations.ts";
import { askLater } from "../../core/explain/later.ts";
import { logSent, settleSent } from "../../core/explain/sent.ts";
import { getDb, writeDb } from "../../platform/db.ts";
import { requireApprovedDevice } from "../../platform/device.ts";
import { streamExplain, toFailure } from "../../platform/tasks.ts";

const deps = { now: Date.now, newId: randomUUID };

export type ExplainPhase =
  | { kind: "ready" }
  | { kind: "streaming"; text: string }
  | { kind: "done"; text: string; retention: "standard" | "zero"; credits: number; sentId: string }
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

  // Closing the sheet keeps only saved explanations (M16 adds Save).
  useEffect(
    () => () => {
      const id = idRef.current;
      if (id !== null) writeDb((db) => discardIfUnsaved(db, id));
    },
    [],
  );

  async function explain(): Promise<void> {
    if (excerpt === "" || phase.kind === "streaming") return;
    if (!requireApprovedDevice()) return;
    const requestKey = key.current ?? randomUUID();
    key.current = requestKey;
    const request: ExplainRequest = { word, transcript: excerpt };
    writeDb((db) => logSent(db, { id: requestKey, task: "explain", sessionId, body: request, at: Date.now() }));
    let text = "";
    setPhase({ kind: "streaming", text });
    try {
      const done = await streamExplain(request, requestKey, (piece) => {
        text += piece;
        setPhase({ kind: "streaming", text });
      });
      const saved = writeDb((db) => {
        settleSent(db, requestKey, done.credits, done.retention);
        const id = idRef.current ?? startExplanation(db, deps, sessionId, t, word).id;
        idRef.current = id;
        return addToThread(db, id, { kind: "explain", text, at: Date.now(), retention: done.retention, sentId: requestKey });
      });
      key.current = null;
      setExplanation(saved);
      setPhase({ kind: "done", text, retention: done.retention, credits: done.credits, sentId: requestKey });
    } catch (error) {
      const failure = toFailure(error);
      if (!keepsKey(failure)) {
        writeDb((db) => settleSent(db, requestKey, 0, null));
        key.current = null;
      }
      setPhase({ kind: "failed", failure, text });
    }
  }

  function saveForLater(): void {
    if (askedLater) return;
    writeDb((db) => askLater(db, deps, sessionId, t, word));
    setAskedLater(true);
  }

  return { excerpt, phase, explanation, askedLater, explain, saveForLater };
}
