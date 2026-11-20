import { useEffect } from "react";
import { AppState } from "react-native";
import { JOB_TEXT_MAX_CHARS } from "@waypoint/contracts";
import { renderScript } from "../../modules/waypoint-voices/index.ts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { getOverview, overviewsToRender, saveOverview, setRendered, setRenderFailed, setRenderPending, setRendering, spokenLines } from "../core/overviews/overviews.ts";
import { notesForResearch } from "../core/research/research.ts";
import { getDb, writeDb } from "./db.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

export function overviewText(sessionId: string): string {
  return notesForResearch(getDb(), sessionId, JOB_TEXT_MAX_CHARS.overview_script);
}

// text is the session text the student saw; prompt is the focus line (null when empty).
export function startOverview(sessionId: string, text: string, key: string, prompt: string | null): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const focus = prompt?.trim() ?? "";
  const request = focus === "" ? { type: "overview_script" as const, text } : { type: "overview_script" as const, text, prompt: focus };
  return startJob({ request, key, sessionId, detail: {} });
}

// The native renderer speaks one script at a time, so renders run in a queue. An overview is queued once.
let chain: Promise<void> = Promise.resolve();
const queued = new Set<string>();

// Speaks the saved script into overviews/<id>.m4a. A failure can be retried.
export function renderOverview(id: string): Promise<void> {
  if (!queued.has(id)) {
    queued.add(id);
    chain = chain
      .then(() => renderNext(id))
      .catch(() => undefined)
      .finally(() => queued.delete(id));
  }
  return chain;
}

async function renderNext(id: string): Promise<void> {
  const overview = getOverview(getDb(), id);
  if (overview === null || overview.kind !== "audio" || overview.state === "ready") return;
  writeDb((db) => setRendering(db, id));
  try {
    const file = `overviews/${id}.m4a`;
    const language = Intl.DateTimeFormat().resolvedOptions().locale;
    const done = await renderScript(spokenLines(overview), file, language);
    writeDb((db) => setRendered(db, id, { file, durationMs: done.durationMs, lineStarts: done.lineStartsMs, voices: done.voices }));
  } catch (error) {
    const code = errorCode(error);
    writeDb((db) => {
      if (code === "busy" || code === "cancelled") setRenderPending(db, id);
      else setRenderFailed(db, id, code === "no_voices" ? "no_voices" : "failed");
    });
  }
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

// Renders audio overviews whose voices are not made yet, at launch and when the app comes back.
export function useOverviewRenders(): void {
  useEffect(() => {
    const run = (): void => {
      for (const o of overviewsToRender(getDb())) if (o.kind === "audio") void renderOverview(o.id);
    };
    run();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => sub.remove();
  }, []);
}

RESULT_SAVERS.overview_script = (db, job, text) => saveOverview(db, "audio", job, text, Date.now());
RESULT_ROUTES.overview_script = (job) => `/overview/${job.id}`;
