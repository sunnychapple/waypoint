import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { ApiCallError, NetworkError } from "@waypoint/api-client";
import type { CreateJobRequest, JobView, QuoteRequest, QuoteResponse } from "@waypoint/contracts";
import { openSealedResult } from "../../modules/waypoint-keys/index.ts";
import type { CloudFailure } from "../core/cloud/failure.ts";
import { logSent, settleSent } from "../core/explain/sent.ts";
import { toBase64Url } from "../core/jobs/bytes.ts";
import { getJob, markDeleted, markSaved, markUnreadable, nextStep, openJobs, recordJob, updateJob, type LocalJob } from "../core/jobs/jobs.ts";
import { api } from "./api.ts";
import { getDb, writeDb } from "./db.ts";
import { currentUserId, requireApprovedDevice, useDeviceStatus } from "./device.ts";
import { BEFORE_FOLLOW, RESULT_SAVERS } from "./jobResults.ts";
import { toFailure } from "./tasks.ts";

const FINISHED = new Set<JobView["state"]>(["succeeded", "failed", "cancelled"]);

// A newer view of a job. When it has finished, sent_log gets the credits charged (0 when it failed).
function note(view: JobView): void {
  writeDb((db) => {
    updateJob(db, view, Date.now());
    const job = getJob(db, view.id);
    if (job !== null && FINISHED.has(view.state)) settleSent(db, job.requestKey, view.spent ?? 0, view.retention);
  });
}

export type StartJobInput = {
  request: CreateJobRequest;
  key: string; // made when the person tapped; kept for "Try again" after Out of credits
  sessionId: string | null;
  detail: Record<string, unknown>; // what the job's screen needs later (never the text sent)
  sent?: unknown; // what sent_log records, when it is not the request itself (retranscribe)
};

// Logs what is sent, makes the job, and starts following it. A failure is returned, never thrown.
export async function startJob(input: StartJobInput): Promise<{ ok: true; jobId: string } | { ok: false; failure: CloudFailure }> {
  if (!requireApprovedDevice()) return { ok: false, failure: { kind: "device" } };
  writeDb((db) => logSent(db, { id: input.key, task: input.request.type, sessionId: input.sessionId, body: input.sent ?? input.request, at: Date.now() }));
  try {
    const view = await api.createJob(input.request, input.key);
    writeDb((db) => recordJob(db, view, { sessionId: input.sessionId, requestKey: input.key, detail: input.detail, now: Date.now() }));
    void followJob(view.id);
    return { ok: true, jobId: view.id };
  } catch (error) {
    return { ok: false, failure: toFailure(error) };
  }
}

// Opens the sealed result with this iPhone's key and hands it to the job type's saver. false: nothing to do yet.
async function fetchResult(job: LocalJob): Promise<boolean> {
  const save = RESULT_SAVERS[job.type];
  const user = currentUserId();
  if (save === undefined || user === null) return false;
  const sealed = await api.jobResult(job.id);
  try {
    const text = await openSealedResult(user, job.id, toBase64Url(sealed));
    writeDb((db) => {
      save(db, job, text);
      markSaved(db, job.id, Date.now());
    });
  } catch {
    writeDb((db) => markUnreadable(db, job.id, Date.now()));
  }
  return true;
}

const following = new Set<string>();
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Walks one job to the end: follow its events, fetch and open the result, then DELETE it on the server (which also
// deletes the result). Safe to call again at any time; one walk per job at a time. Network trouble backs off; any
// other error stops until the next launch.
export async function followJob(id: string): Promise<void> {
  if (following.has(id)) return;
  following.add(id);
  try {
    for (let failures = 0; failures < 8; ) {
      const job = getJob(getDb(), id);
      if (job === null) return;
      const step = nextStep(job);
      if (step === "done") return;
      try {
        if (step === "follow") {
          const before = BEFORE_FOLLOW[job.type];
          if (before !== undefined) await before(job);
          await api.jobEvents(id, note);
        } else if (step === "fetch") {
          if (!(await fetchResult(job))) return;
        } else {
          const view = await api.deleteJob(id);
          note(view);
          writeDb((db) => markDeleted(db, id, Date.now()));
        }
        failures = 0;
      } catch (error) {
        if (error instanceof ApiCallError && error.status === 404) {
          writeDb((db) => markDeleted(db, id, Date.now()));
          return;
        }
        if (!(error instanceof NetworkError)) return;
        failures += 1;
        await wait(Math.min(30_000, 1_000 * 2 ** failures));
      }
    }
  } finally {
    following.delete(id);
  }
}

// Cancel from the job screen. Nothing is charged unless the job had already finished (docs/architecture.md section 4).
export async function cancelJob(id: string): Promise<CloudFailure | null> {
  try {
    note(await api.deleteJob(id));
    writeDb((db) => markDeleted(db, id, Date.now()));
    return null;
  } catch (error) {
    return toFailure(error);
  }
}

// Picks up every unfinished job at launch and whenever the app comes back. Called once in (tabs)/_layout.tsx.
export function useJobs(): void {
  const status = useDeviceStatus();
  useEffect(() => {
    if (status !== "approved") return;
    const resume = (): void => {
      for (const job of openJobs(getDb())) void followJob(job.id);
    };
    resume();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") resume();
    });
    return () => sub.remove();
  }, [status]);
}

export type QuoteState = { loading: boolean; quote: QuoteResponse | null; failure: CloudFailure | null };

// POST /v1/tasks/quote for the "Before you run it" box. null: nothing to quote yet.
export function useQuote(request: QuoteRequest | null): QuoteState {
  const key = request === null ? "" : JSON.stringify(request);
  const [state, setState] = useState<QuoteState>({ loading: request !== null, quote: null, failure: null });
  useEffect(() => {
    if (request === null) return;
    let live = true;
    setState({ loading: true, quote: null, failure: null });
    api.quote(request).then(
      (quote) => live && setState({ loading: false, quote, failure: null }),
      (error: unknown) => live && setState({ loading: false, quote: null, failure: toFailure(error) }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}
