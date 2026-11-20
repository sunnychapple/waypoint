import { openBrowserAsync } from "expo-web-browser";
import type { ResearchDepth } from "@waypoint/contracts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { openableUrl } from "../core/research/answer.ts";
import { saveResearch } from "../core/research/research.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

export function startResearch(input: { question: string; depth: ResearchDepth; notes: string | null; sessionId: string | null; key: string }): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const request = input.notes === null || input.notes === ""
    ? { type: "research" as const, depth: input.depth, question: input.question }
    : { type: "research" as const, depth: input.depth, question: input.question, text: input.notes };
  return startJob({ request, key: input.key, sessionId: input.sessionId, detail: { question: input.question, depth: input.depth } });
}

export async function openSource(url: string): Promise<void> {
  const safe = openableUrl(url);
  if (safe !== null) await openBrowserAsync(safe);
}

RESULT_SAVERS.research = (db, job, text) => saveResearch(db, job, text, Date.now());
RESULT_ROUTES.research = (job) => `/research/${job.id}`;
