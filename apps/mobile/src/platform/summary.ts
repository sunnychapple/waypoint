import { AppState } from "react-native";
import { getRecorderStatus } from "../../modules/waypoint-audio/index.ts";
import { getAvailability, getContextSize, summarize } from "../../modules/waypoint-model/index.ts";
import { applySummary, summarizeUnits } from "../core/capture/summary.ts";
import { studyUnits } from "../core/study/units.ts";
import { dbGeneration, getDb, writeDbIf } from "./db.ts";

// Tried in this run of the app, by notes, session and recorded length. Recording more makes a new key.
const tried = new Set<string>();

// S8: a recording's title and summary, written by Apple's model on this iPhone after the recording stops. Only in the
// front and only while nothing records: no extra work during a recording, and the model takes one request at a time.
// The text comes from studyUnits, which reads the transcript through studyLines, so hidden lines never reach the model.
export async function summarizeSession(sessionId: string, recordedMs: number): Promise<void> {
  const generation = dbGeneration();
  const key = `${generation}\n${sessionId}\n${recordedMs}`;
  if (tried.has(key)) return;
  if (getAvailability() !== "available" || getRecorderStatus().state !== "idle" || AppState.currentState !== "active") return;
  tried.add(key);
  try {
    const made = await summarizeUnits({ contextSize: getContextSize, summarize }, studyUnits(getDb(), sessionId));
    if (made !== null) writeDbIf(generation, (db) => applySummary(db, sessionId, made));
  } catch {
    // Declined, busy, or a language the model does not support: the title stays the first words.
  }
}
