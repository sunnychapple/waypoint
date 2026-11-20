import type { JobView } from "@waypoint/contracts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { jobView, loadJob } from "./job.ts";

// How often the stream looks at the job, how long it may stay quiet before a keep-alive comment, and how long one
// stream lasts. The app opens a new one if the job has not finished by then.
export const JOB_EVENTS_POLL_MS = 2_000;
export const JOB_EVENTS_KEEPALIVE_MS = 20_000;
export const JOB_EVENTS_MAX_MS = 10 * 60_000;

const FINISHED: ReadonlySet<JobView["state"]> = new Set(["succeeded", "failed", "cancelled"]);

function sameView(a: JobView, b: JobView): boolean {
  return a.state === b.state && a.spent === b.spent && a.result_ready === b.result_ready;
}

// GET /v1/jobs/:id/events: server-sent "state" events, each the job's JobView (ids, state, credits, times; never
// content). The first event is the state now; another follows each change; the stream ends after a finished state,
// when the job is gone, or after JOB_EVENTS_MAX_MS.
export function jobEventsRoute(deps: { now: () => number; sleep: (ms: number) => Promise<void> }) {
  return new Hono<AppEnv>().get("/v1/jobs/:id/events", async (c) => {
    const user = c.get("user");
    const db = c.env.DB;
    const first = await loadJob(db, c.req.param("id"), user.id);
    if (first === null) throw new ApiFailure("not_found", "no such job");
    return streamSSE(c, async (stream) => {
      const started = deps.now();
      let sent: JobView | null = null;
      let quietSince = started;
      let seq = 0;
      let job: typeof first | null = first;
      while (!stream.aborted && job !== null) {
        const now = deps.now();
        const view = jobView(job, now);
        if (sent === null || !sameView(sent, view)) {
          seq += 1;
          await stream.writeSSE({ event: "state", id: String(seq), data: JSON.stringify(view) });
          sent = view;
          quietSince = now;
        } else if (now - quietSince >= JOB_EVENTS_KEEPALIVE_MS) {
          await stream.write(": keep-alive\n\n");
          quietSince = now;
        }
        if (FINISHED.has(view.state) || now - started >= JOB_EVENTS_MAX_MS) break;
        await deps.sleep(JOB_EVENTS_POLL_MS);
        job = await loadJob(db, first.id, user.id);
      }
    });
  });
}
