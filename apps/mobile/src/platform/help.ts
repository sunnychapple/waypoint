import type { CloudFailure } from "../core/cloud/failure.ts";
import { cloudHelpRequest, saveCloudHelp, type HelpWhere } from "../core/study/cloudHelp.ts";
import type { Problem } from "../core/study/help.ts";
import { RESULT_ROUTES, RESULT_SAVERS } from "./jobResults.ts";
import { startJob } from "./jobs.ts";

// Sends one problem for step-by-step help in the cloud. Only called from the Send button under the price.
export function startCloudHelp(
  problem: Problem,
  where: { sessionId: string; captureId: string; block: number | null },
  key: string,
): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  const request = cloudHelpRequest(problem);
  const detail: HelpWhere = { captureId: where.captureId, block: where.block, problem: request.problem };
  return startJob({ request, key, sessionId: where.sessionId, detail });
}

RESULT_SAVERS.problem_help = (db, job, text) => saveCloudHelp(db, job, text, Date.now());
RESULT_ROUTES.problem_help = (job) => `/study/help-cloud?jobId=${encodeURIComponent(job.id)}`;
