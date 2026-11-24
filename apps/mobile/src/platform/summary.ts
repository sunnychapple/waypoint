import { AppState } from "react-native";
import { getRecorderStatus } from "../../modules/waypoint-audio/index.ts";
import { getAvailability, getContextSize, summarize } from "../../modules/waypoint-model/index.ts";
import { applySummary, summarizeUnits, type MadeSummary } from "../core/capture/summary.ts";
import { getSession } from "../core/capture/sessions.ts";
import { studyUnits } from "../core/study/units.ts";
import { dbGeneration, getDb, writeDbIf } from "./db.ts";

// Tried in this run of the app, by notes, session and recorded length. Recording more makes a new key.
const tried = new Set<string>();
// The last run that stopped or failed for a reason that may pass: the app runs it again when it comes to the front.
let retry: { sessionId: string; recordedMs: number } | null = null;

AppState.addEventListener("change", (state) => {
  if (state !== "active" || retry === null) return;
  const { sessionId, recordedMs } = retry;
  void summarizeSession(sessionId, recordedMs);
});

// Thrown before a model call once the run should stop. Its code is not one of the final outcomes, so the key is released.
const STOPPED = Object.assign(new Error("summary stopped"), { code: "stopped" });

// Declined, or a language the model does not support, will not change by asking again. Anything else may.
function isFinal(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return code === "declined" || code === "unsupported_language";
}

// S8: a recording's title and summary, written by Apple's model on this iPhone after the recording stops. Only in the
// front and only while nothing records: no extra work during a recording, and the model takes one request at a time.
// The text comes from studyUnits, which reads the transcript through studyLines, so hidden lines never reach the model.
export async function summarizeSession(sessionId: string, recordedMs: number): Promise<void> {
  const generation = dbGeneration();
  const key = `${generation}\n${sessionId}\n${recordedMs}`;
  if (tried.has(key)) return;
  if (getAvailability() !== "available") return;
  // Only a recorder or a background that comes back can change the answer, so those runs are retried in the front.
  if (getRecorderStatus().state !== "idle" || AppState.currentState !== "active") {
    retry = { sessionId, recordedMs };
    return;
  }
  tried.add(key);
  retry = null;
  const release = (): void => {
    tried.delete(key);
    retry = { sessionId, recordedMs };
  };
  // Stops when the recorder starts, the app leaves the front, or the session's recorded length moves on.
  const shouldStop = (): boolean =>
    getRecorderStatus().state !== "idle" ||
    AppState.currentState !== "active" ||
    getSession(getDb(), sessionId)?.recordedMs !== recordedMs;
  let made: MadeSummary | null;
  try {
    made = await summarizeUnits(
      {
        contextSize: getContextSize,
        summarize: async (text) => {
          if (shouldStop()) throw STOPPED;
          return summarize(text);
        },
      },
      studyUnits(getDb(), sessionId),
    );
  } catch (error) {
    // Declined, unsupported language, or busy, failed, a stop: the title stays the first words, or the run is tried again.
    if (isFinal(error)) return;
    release();
    return;
  }
  // Nothing usable came back: final, as with a declined run.
  if (made === null) return;
  if (shouldStop()) {
    release();
    return;
  }
  writeDbIf(generation, (db) => applySummary(db, sessionId, made));
}
