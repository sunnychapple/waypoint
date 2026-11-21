import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import type { ExplainRequest, FollowUpRequest, StreamDone } from "@waypoint/contracts";
import { listSegments } from "../../core/capture/segments.ts";
import { keepsKey, type CloudFailure } from "../../core/cloud/failure.ts";
import { excerptAround, pageContext, trimExcerpt } from "../../core/explain/excerpt.ts";
import {
  addToThread,
  discardIfUnsaved,
  getExplanation,
  saveExplanation,
  saveExplanationNow,
  shownAnswer,
  startExplanation,
  unsaveExplanation,
  type Explanation,
  type ThreadItem,
} from "../../core/explain/explanations.ts";
import { askLater, markAnswered } from "../../core/explain/later.ts";
import { logSent, settleFailedSent, settleSent, type InstantSentTask } from "../../core/explain/sent.ts";
import { dbGeneration, getDb, stillSame, writeDb } from "../../platform/db.ts";
import { requireApprovedDevice } from "../../platform/device.ts";
import { doubleCheck, streamExplain, streamMoreDetail, toFailure } from "../../platform/tasks.ts";

const deps = { now: Date.now, newId: randomUUID };

// What is running or went wrong right now. The answers so far are in explanation.thread.
export type ExplainPhase =
  | { kind: "idle" }
  | { kind: "running"; task: InstantSentTask; text: string }
  | { kind: "failed"; task: InstantSentTask; failure: CloudFailure; text: string };

// One tapped word: the excerpt around it, the thread of answers, and what is running. Each request gets an
// Idempotency-Key when the person taps; "Try again" re-uses it only when the request did not run (keepsKey).
// With explanationId, the saved explanation's thread is shown and follow-ups continue it.
// With pageId, the word was tapped on a page: the context is that page's found text, and t is 0 (a page's time).
export function useExplain(
  sessionId: string,
  t: number,
  word: string,
  flagId?: string | undefined,
  explanationId?: string | undefined,
  pageId?: string | undefined,
) {
  const [page] = useState(() => (pageId === undefined ? null : pageContext(getDb(), sessionId, pageId)));
  const [excerpt] = useState(() => (pageId === undefined ? excerptAround(listSegments(getDb(), sessionId), t) : trimExcerpt(page?.text ?? "")));
  const [phase, setPhase] = useState<ExplainPhase>({ kind: "idle" });
  const [loaded] = useState<Explanation | null>(() => (explanationId === undefined ? null : getExplanation(getDb(), explanationId)));
  const [explanation, setExplanation] = useState<Explanation | null>(loaded);
  // An answer that was paid for but could not be saved on the iPhone: shown, not in the thread.
  const [unsavedItem, setUnsavedItem] = useState<ThreadItem | null>(null);
  const [askedLater, setAskedLater] = useState(false);
  // The explain answer said research would help (offer_research). Reset when a new explain runs.
  const [offerResearch, setOfferResearch] = useState(false);
  const keys = useRef<Partial<Record<InstantSentTask, string>>>({});
  const idRef = useRef<string | null>(loaded?.id ?? null);
  const cancelled = useRef(false);
  const controller = useRef<AbortController | null>(null);

  // Closing the sheet keeps only saved explanations. It also aborts a stream still running; the server settles that
  // request anyway, and no unsaved explanation row or thread item is written after this.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      controller.current?.abort();
      const id = idRef.current;
      if (id !== null) writeDb((db) => discardIfUnsaved(db, id));
    };
  }, []);

  async function run(task: InstantSentTask): Promise<void> {
    if (excerpt === "" || phase.kind === "running") return;
    const answer = explanation === null ? null : shownAnswer(explanation);
    if (task !== "explain" && answer === null) return;
    if (!requireApprovedDevice()) return;
    const generation = dbGeneration();
    const key = keys.current[task] ?? randomUUID();
    keys.current[task] = key;
    const explainBody: ExplainRequest = { word, transcript: excerpt };
    const followUp: FollowUpRequest = { word, transcript: excerpt, answer: answer ?? "" };
    writeDb((db) => logSent(db, { id: key, task, sessionId, body: task === "explain" ? explainBody : followUp, at: Date.now() }));
    const abort = new AbortController();
    controller.current = abort;
    let text = "";
    let credits: number;
    let retention: "standard" | "zero";
    if (task === "explain") setOfferResearch(false);
    setPhase({ kind: "running", task, text });
    const onDelta = (piece: string): void => {
      text += piece;
      setPhase({ kind: "running", task, text });
    };
    try {
      if (task === "double_check") {
        const reply = await doubleCheck(followUp, key);
        text = reply.text;
        ({ credits, retention } = reply);
      } else {
        const done: StreamDone =
          task === "explain"
            ? await streamExplain(explainBody, key, onDelta, abort.signal)
            : await streamMoreDetail(followUp, key, onDelta, abort.signal);
        ({ credits, retention } = done);
        if (task === "explain") setOfferResearch(done.offer_research);
      }
    } catch (error) {
      if (cancelled.current) return; // closed mid-stream: nothing more is written here
      const failure = toFailure(error);
      if (!keepsKey(failure)) {
        writeDb((db) => settleFailedSent(db, key, failure));
        delete keys.current[task];
      }
      setPhase({ kind: "failed", task, failure, text });
      return;
    }
    // The answer is paid for and is shown even if saving it on the iPhone fails. A save failure is not a cloud failure,
    // so there is no "Try again"; the key is dropped either way, because the server answers a used key with 409.
    const item: ThreadItem = { kind: task, text, at: Date.now(), retention, sentId: key };
    let next: Explanation | null;
    try {
      next = writeDb((db) => {
        settleSent(db, key, credits, retention);
        if (cancelled.current) return null;
        const id = idRef.current ?? startExplanation(db, deps, sessionId, t, word).id;
        idRef.current = id;
        let updated: Explanation | null = null;
        // One transaction: the thread item, the answered flag and the save all land, or none does.
        db.transaction(() => {
          updated = addToThread(db, id, item);
          // Explain answered a question from Questions for later: that flag is answered now, and the answer is saved
          // for later (owner decision). Only in the notes the flag came from.
          if (task === "explain" && flagId !== undefined && stillSame(generation)) {
            markAnswered(db, flagId);
            saveExplanationNow(db, deps, id);
            updated = { ...updated, saved: true };
          }
        });
        return updated;
      });
    } catch {
      delete keys.current[task];
      setUnsavedItem(item);
      setPhase({ kind: "idle" });
      return;
    }
    if (cancelled.current) return;
    delete keys.current[task];
    if (next !== null) setExplanation(next);
    setUnsavedItem(null);
    setPhase({ kind: "idle" });
  }

  function toggleSave(): void {
    const current = explanation;
    if (current === null) return;
    writeDb((db) => (current.saved ? unsaveExplanation(db, current.id) : saveExplanation(db, deps, current.id)));
    setExplanation({ ...current, saved: !current.saved });
  }

  function saveForLater(): void {
    if (askedLater) return;
    writeDb((db) => askLater(db, deps, sessionId, t, word));
    setAskedLater(true);
  }

  return { excerpt, pageNumber: page?.number ?? null, phase, explanation, unsavedItem, askedLater, offerResearch, run, toggleSave, saveForLater };
}
