import { useEffect } from "react";
import { AppState } from "react-native";
import { getRecorderStatus, getSpeechStatus, transcribeFile } from "../../modules/waypoint-audio/index.ts";
import { pendingTranscriptions, recoverSessions, saveSegment } from "../core/capture/recording.ts";
import { replacementFor } from "../core/capture/transcript.ts";
import { dbGeneration, getDb, writeDb, writeDbIf } from "./db.ts";

const TICK_MS = 20_000;

let recovered = false;
let ticking = false;
let packMissing = false;

// Writes down the audio of sessions whose words were not written live. Runs only while the app is active,
// the speech pack is installed and the recorder is idle. Errors are kept per session; see below.
async function tick(): Promise<void> {
  if (ticking || AppState.currentState !== "active") return;
  ticking = true;
  try {
    if (getRecorderStatus().state !== "idle") return;
    // First, with or without a speech pack: a recording cut off by a crash or a kill becomes interrupted (and shows in
    // its space) on every iPhone, also one that cannot transcribe.
    if (!recovered) {
      writeDb((db) => recoverSessions(db, getRecorderStatus()));
      recovered = true;
    }
    if (packMissing || (await getSpeechStatus()).pack !== "installed") return;
    const generation = dbGeneration();
    for (const session of pendingTranscriptions(getDb())) {
      try {
        await transcribeSession(session.sessionId, session.parts, generation);
      } catch (error) {
        if (codeOf(error) === "speech_pack_missing") {
          packMissing = true;
          return;
        }
        writeDbIf(generation, (db) => db.run("UPDATE sessions SET transcript = 'failed' WHERE id = ?", [session.sessionId]));
      }
    }
  } catch {
    // retried on the next tick
  } finally {
    ticking = false;
  }
}

// Returns false when it stopped early because a recording started; the session keeps waiting.
async function transcribeSession(
  sessionId: string,
  parts: { file: string; startMs: number; durationMs: number }[],
  generation: number,
): Promise<boolean> {
  for (const part of parts) {
    if (getRecorderStatus().state !== "idle") return false;
    const pieces = await transcribeFile(part.file, part.startMs);
    writeDbIf(generation, (db) => {
      const existing = db
        .all<{ t_start: number; t_end: number }>("SELECT t_start, t_end FROM segments WHERE session_id = ? AND source = 'device'", [sessionId])
        .map((row) => ({ tStart: row.t_start, tEnd: row.t_end }));
      const fresh = replacementFor(part, pieces, existing);
      if (fresh === null) return;
      db.transaction(() => {
        db.run("DELETE FROM segments WHERE session_id = ? AND source = 'device' AND t_start >= ? AND t_start < ?", [
          sessionId,
          part.startMs,
          part.startMs + part.durationMs,
        ]);
        for (const piece of fresh) saveSegment(db, sessionId, piece);
      });
    });
  }
  writeDbIf(generation, (db) => db.run("UPDATE sessions SET transcript = 'done', indexed_at = NULL WHERE id = ?", [sessionId]));
  return true;
}

function codeOf(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

// Mounted once, in the tabs layout. Every 20 seconds while the app is active, then right away on becoming active.
export function useTranscriptionQueue(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (timer !== null) return;
      void tick();
      timer = setInterval(() => void tick(), TICK_MS);
    };
    const stop = (): void => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });
    if (AppState.currentState === "active") start();
    return () => {
      stop();
      subscription.remove();
    };
  }, []);
}
