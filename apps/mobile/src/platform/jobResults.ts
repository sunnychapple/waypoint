import type { JobType } from "@waypoint/contracts";
import type { SqlDb } from "../core/db/sql.ts";
import type { LocalJob } from "../core/jobs/jobs.ts";

// What each job type does with its opened result, where its screen is, and anything to do before following it.
// Each job card adds one line to each map it needs (M18, M19, M23, M24b, M25a, M25b).
export const RESULT_SAVERS: Partial<Record<JobType, (db: SqlDb, job: LocalJob, text: string) => void>> = {};
export const RESULT_ROUTES: Partial<Record<JobType, (job: LocalJob) => string>> = {};
export const BEFORE_FOLLOW: Partial<Record<JobType, (job: LocalJob) => Promise<void>>> = {};
