import { openBrowserAsync } from "expo-web-browser";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { openableUrl } from "../core/research/answer.ts";
import { saveResearch, type ResearchRequest } from "../core/research/research.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

export function startResearch(input: { request: ResearchRequest; sessionId: string | null; key: string }): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  return startJob({ request: input.request, key: input.key, sessionId: input.sessionId, detail: { question: input.request.question, depth: input.request.depth } });
}

export async function openSource(url: string): Promise<void> {
  const safe = openableUrl(url);
  if (safe !== null) await openBrowserAsync(safe);
}

RESULT_SAVERS.research = (db, job, text) => saveResearch(db, job, text, Date.now());
RESULT_ROUTES.research = (job) => `/research/${job.id}`;
