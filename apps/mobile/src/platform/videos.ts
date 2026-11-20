import { VideoSlidesResultSchema } from "@waypoint/contracts";
import { getRecorderStatus } from "../../modules/waypoint-audio/index.ts";
import { renderSlides } from "../../modules/waypoint-video/index.ts";
import { renderScript } from "../../modules/waypoint-voices/index.ts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { saveOverview, scriptLines, setRendered, setRenderFailed, setRenderPending, setRendering, type Overview } from "../core/overviews/overviews.ts";
import { dbGeneration, writeDb, writeDbIf } from "./db.ts";
import { deleteFile } from "./files.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

// text is the session text the student saw (the screen's "Show what's sent"); prompt is the focus line (null when empty).
export function startVideo(sessionId: string, text: string, key: string, prompt: string | null): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const focus = prompt?.trim() ?? "";
  const request = focus === "" ? { type: "video_slides" as const, text } : { type: "video_slides" as const, text, prompt: focus };
  return startJob({ request, key, sessionId, detail: {} });
}

// Makes one video overview: the narration first, then the slides over it. Called from the render queue in
// overviews.ts, so it never runs beside another render. Nothing here is sent anywhere.
export async function renderVideo(video: Overview): Promise<void> {
  // Never while a recording runs: it stays a script and is picked up again later.
  if (getRecorderStatus().state !== "idle") return;
  const generation = dbGeneration();
  writeDb((db) => setRendering(db, video.id));
  const narration = `overviews/${video.id}-narration.m4a`;
  try {
    const voice = await renderScript(scriptLines(video), narration, Intl.DateTimeFormat().resolvedOptions().locale);
    const slides = VideoSlidesResultSchema.parse(JSON.parse(video.script)).slides.map((s) => ({ heading: s.heading, bullets: s.bullets }));
    const file = `overviews/${video.id}.mp4`;
    const done = await renderSlides(video.title, slides, voice.lineStartsMs, narration, file);
    writeDbIf(generation, (db) => setRendered(db, video.id, { file, durationMs: done.durationMs, lineStarts: voice.lineStartsMs, voices: voice.voices }));
  } catch (error) {
    const code = errorCode(error);
    writeDbIf(generation, (db) => {
      if (code === "busy" || code === "cancelled") setRenderPending(db, video.id);
      else setRenderFailed(db, video.id, code === "no_voices" ? "no_voices" : "failed");
    });
  } finally {
    deleteFile(narration);
  }
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

RESULT_SAVERS.video_slides = (db, job, text) => saveOverview(db, "video", job, text, Date.now());
RESULT_ROUTES.video_slides = (job) => `/video/${job.id}`;
