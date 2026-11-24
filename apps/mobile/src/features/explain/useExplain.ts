import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import type { ExplainRequest, FollowUpRequest, StreamDone } from "@waypoint/contracts";
import { studyLines } from "../../core/capture/segments.ts";
import { keepsKey, type CloudFailure } from "../../core/cloud/failure.ts";
import { excerptAround, pageContext, trimExcerpt } from "../../core/explain/excerpt.ts";
import {
  discardIfUnsaved,
  getExplanation,
  landedExplanation,
  pageForTerm,
  saveExplanation,
  shownAnswer,
  unsaveExplanation,
  type Explanation,
  type ThreadItem,
} from "../../core/explain/explanations.ts";
import { landAnswer } from "../../core/explain/land.ts";
import { askLater, markAnswered, reopenFlag } from "../../core/explain/later.ts";
import { logSent, settleFailedSent, type InstantSentTask } from "../../core/explain/sent.ts";
import { dbGeneration, getDb, stillSame, writeDb, writeDbIf } from "../../platform/db.ts";
import { requireApprovedDevice } from "../../platform/device.ts";
import { doubleCheck, streamExplain, streamMoreDetail, toFailure } from "../../platform/tasks.ts";

const deps = { now: Date.now, newId: randomUUID };

// Explains still running, including ones whose sheet was closed, so reopening the same word does not pay for it twice.
// An entry older than this is treated as finished, so a stream that hung cannot block the word for good.
const IN_FLIGHT_MS = 120_000;
const inFlight = new Map<string, number>();
const isInFlight = (key: string): boolean => {
  const at = inFlight.get(key);
  return at !== undefined && Date.now() - at < IN_FLIGHT_MS;
};

// What is running or went wrong right now. The answers so far are in explanation.thread.
export type ExplainPhase =
  | { kind: "idle" }
  | { kind: "running"; task: InstantSentTask; text: string }
  | { kind: "failed"; task: InstantSentTask; failure: CloudFailure; text: string };

// One tapped word: the excerpt around it, the thread of answers, and what is running. Each request gets an
// Idempotency-Key when the person taps; "Try again" re-uses it only when the request did not run (keepsKey).
// With explanationId, the saved explanation's thread is shown and follow-ups continue it.
// With pageId, the word was tapped on a page: the context is that page's found text, and t is 0 (a page's time). A saved
// explanation reopened without pageId uses the page it was saved from.
export function useExplain(
  sessionId: string,
  t: number,
  word: string,
  flagId?: string | undefined,
  explanationId?: string | undefined,
  pageId?: string | undefined,
) {
  const [loaded] = useState<Explanation | null>(() => (explanationId === undefined ? null : getExplanation(getDb(), explanationId)));
  // The page this word is explained with. An explanation saved before captureId existed has none, so its page is the
  // first one with the word.
  const [pageRef] = useState<string | undefined>(() => {
    if (pageId !== undefined || loaded === null) return pageId;
    return loaded.captureId ?? pageForTerm(getDb(), sessionId, word) ?? undefined;
  });
  const [page] = useState(() => (pageRef === undefined ? null : pageContext(getDb(), sessionId, pageRef)));
  const [excerpt] = useState(() => (pageRef === undefined ? excerptAround(studyLines(getDb(), sessionId), t) : trimExcerpt(page?.text ?? "")));
  const [phase, setPhase] = useState<ExplainPhase>({ kind: "idle" });
  const [explanation, setExplanation] = useState<Explanation | null>(loaded);
  // An answer that was paid for but could not be saved on the iPhone: shown, not in the thread.
  const [unsavedItem, setUnsavedItem] = useState<ThreadItem | null>(null);
  const [askedLater, setAskedLater] = useState(false);
  // The explain answer said research would help (offer_research). Reset when a new explain runs.
  const [offerResearch, setOfferResearch] = useState(false);
  const keys = useRef<Partial<Record<InstantSentTask, string>>>({});
  const idRef = useRef<string | null>(loaded?.id ?? null);
  const cancelled = useRef(false);
  const [openedIn] = useState(dbGeneration);
  const [flightKey] = useState(() => `${openedIn}\n${sessionId}\n${pageRef ?? t}\n${word}`);
  // This word's answer is already on its way from a sheet that was closed.
  const [stillComing, setStillComing] = useState(() => isInFlight(flightKey));
  const comingSince = useRef(inFlight.get(flightKey) ?? 0);

  // When that request ends, its answer shows here. If it failed, Explain comes back.
  useEffect(() => {
    if (!stillComing) return;
    const timer = setInterval(() => {
      if (isInFlight(flightKey)) return;
      clearInterval(timer);
      setStillComing(false);
      if (!stillSame(openedIn)) return;
      const landed = landedExplanation(getDb(), { sessionId, t, term: word, captureId: pageRef ?? null, since: comingSince.current });
      if (landed !== null) {
        idRef.current = landed.id;
        setExplanation(landed);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [stillComing, flightKey, openedIn, sessionId, t, word, pageRef]);

  // Closing the sheet keeps only saved explanations. An answer is saved as soon as it arrives, so it stays unless the
  // person removed it with Saved. A stream still running is not aborted: it runs to the end and its answer lands, so
  // the person is charged for an answer they get. Once closed, no React state is set.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      const id = idRef.current;
      if (id !== null) writeDb((db) => discardIfUnsaved(db, id));
    };
  }, []);

  async function run(task: InstantSentTask): Promise<void> {
    if (task !== "explain") return runTask(task);
    if (excerpt === "" || phase.kind === "running") return;
    if (isInFlight(flightKey)) {
      comingSince.current = inFlight.get(flightKey) ?? 0;
      setStillComing(true);
      return;
    }
    setStillComing(false);
    const startedAt = Date.now();
    inFlight.set(flightKey, startedAt);
    try {
      await runTask(task);
    } finally {
      if (inFlight.get(flightKey) === startedAt) inFlight.delete(flightKey);
    }
  }

  async function runTask(task: InstantSentTask): Promise<void> {
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
    let text = "";
    let credits: number;
    let retention: "standard" | "zero";
    if (task === "explain") setOfferResearch(false);
    setPhase({ kind: "running", task, text });
    const onDelta = (piece: string): void => {
      text += piece;
      if (!cancelled.current) setPhase({ kind: "running", task, text });
    };
    try {
      if (task === "double_check") {
        const reply = await doubleCheck(followUp, key);
        text = reply.text;
        ({ credits, retention } = reply);
      } else {
        const done: StreamDone =
          task === "explain" ? await streamExplain(explainBody, key, onDelta) : await streamMoreDetail(followUp, key, onDelta);
        ({ credits, retention } = done);
        if (task === "explain" && !cancelled.current) setOfferResearch(done.offer_research);
      }
    } catch (error) {
      const failure = toFailure(error);
      if (cancelled.current) {
        // Closed mid-stream: no state is set. A failure that does not keep its key is still settled, in the same notes.
        // The sheet said the answer would be in Questions for later, so the question goes there when no answer came.
        // A question from that list is already there: its flag stays open until an answer lands.
        try {
          writeDbIf(generation, (db) => {
            if (!keepsKey(failure)) settleFailedSent(db, key, failure);
            if (task === "explain" && flagId === undefined) askLater(db, deps, sessionId, t, word, pageRef);
          });
        } catch {
          // The session or page was removed meanwhile: there is nowhere to keep the question.
        }
        return;
      }
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
      next = writeDb((db) =>
        landAnswer(db, deps, {
          item,
          credits,
          retention,
          existingId: idRef.current,
          closed: cancelled.current,
          sameNotes: stillSame(generation),
          sessionId,
          t,
          word,
          captureId: pageRef,
          flagId,
        }),
      );
    } catch {
      // Closed: the answer could not be landed, and nobody is looking at the sheet any more.
      if (cancelled.current) return;
      delete keys.current[task];
      setUnsavedItem(item);
      setPhase({ kind: "idle" });
      return;
    }
    if (next !== null) idRef.current = next.id;
    if (cancelled.current) return;
    delete keys.current[task];
    if (next !== null) setExplanation(next);
    setUnsavedItem(null);
    setPhase({ kind: "idle" });
  }

  function toggleSave(): void {
    const current = explanation;
    if (current === null) return;
    writeDb((db) => {
      if (current.saved) {
        unsaveExplanation(db, current.id);
        // Its answer is going away, so a question from Questions for later goes back on the list.
        if (flagId !== undefined) reopenFlag(db, flagId);
      } else {
        saveExplanation(db, deps, current.id);
        if (flagId !== undefined) markAnswered(db, flagId);
      }
    });
    setExplanation({ ...current, saved: !current.saved });
  }

  function saveForLater(): void {
    if (askedLater) return;
    writeDb((db) => askLater(db, deps, sessionId, t, word, pageRef));
    setAskedLater(true);
  }

  return { excerpt, pageId: pageRef, pageNumber: page?.number ?? null, phase, explanation, unsavedItem, askedLater, offerResearch, stillComing, run, toggleSave, saveForLater };
}
