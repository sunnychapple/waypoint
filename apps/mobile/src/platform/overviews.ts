import { useEffect } from "react";
import { AppState } from "react-native";
import { JOB_TEXT_MAX_CHARS } from "@waypoint/contracts";
import { renderScript } from "../../modules/waypoint-voices/index.ts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { getOverview, overviewsToRender, saveOverview, scriptLines, setRendered, setRenderFailed, setRendering } from "../core/overviews/overviews.ts";
import { notesForResearch } from "../core/research/research.ts";
import { getDb, writeDb } from "./db.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

export function overviewText(sessionId: string): string {
  return notesForResearch(getDb(), sessionId, JOB_TEXT_MAX_CHARS.overview_script);
}

export function startOverview(sessionId: string, key: string, prompt: string | null): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const text = overviewText(sessionId);
  const focus = prompt?.trim() ?? "";
  const request = focus === "" ? { type: "overview_script" as const, text } : { type: "overview_script" as const, text, prompt: focus };
  return startJob({ request, key, sessionId, detail: {} });
}

const rendering = new Set<string>();

// Speaks the saved script into overviews/<id>.m4a. One render at a time per overview; a failure can be retried.
export async function renderOverview(id: string): Promise<void> {
  const overview = getOverview(getDb(), id);
  if (overview === null || overview.kind !== "audio" || overview.state === "ready" || rendering.has(id)) return;
  rendering.add(id);
  writeDb((db) => setRendering(db, id));
  try {
    const file = `overviews/${id}.m4a`;
    const language = Intl.DateTimeFormat().resolvedOptions().locale;
    const done = await renderScript(scriptLines(overview), file, language);
    writeDb((db) => setRendered(db, id, { file, durationMs: done.durationMs, lineStarts: done.lineStartsMs, voices: done.voices }));
  } catch {
    writeDb((db) => setRenderFailed(db, id));
  } finally {
    rendering.delete(id);
  }
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
