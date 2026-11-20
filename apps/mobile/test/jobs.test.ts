import type { JobView } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import { toBase64Url } from "../src/core/jobs/bytes.ts";
import { getJob, listJobs, jobLine, markDeleted, markSaved, markUnreadable, nextStep, openJobs, recordJob, setDetail, updateJob } from "../src/core/jobs/jobs.ts";
import { migrate } from "../src/core/db/migrate.ts";
import { createMemoryDb } from "./helpers/db.ts";

const VIEW: JobView = { id: "job_1", type: "research", state: "queued", quoted: 15, spent: null, tier: "standard", retention: "standard", result_ready: false, created_at: 1, finished_at: null, expires_at: null };
function db() {
  const d = createMemoryDb();
  migrate(d);
  return d;
}

describe("jobs table", () => {
  it("records, updates and walks a job to done", () => {
    const d = db();
    recordJob(d, VIEW, { sessionId: null, requestKey: "key_1", detail: { depth: "quick" }, now: 10 });
    recordJob(d, { ...VIEW, state: "running" }, { sessionId: null, requestKey: "key_1", detail: {}, now: 11 });
    expect(getJob(d, "job_1")).toMatchObject({ state: "running", detail: '{"depth":"quick"}', createdAt: 10, updatedAt: 11 });
    expect(nextStep(getJob(d, "job_1")!)).toBe("follow");
    updateJob(d, { ...VIEW, state: "succeeded", spent: 15, result_ready: true }, 12);
    expect(nextStep(getJob(d, "job_1")!)).toBe("fetch");
    markSaved(d, "job_1", 13);
    expect(nextStep(getJob(d, "job_1")!)).toBe("delete");
    expect(openJobs(d).map((j) => j.id)).toEqual(["job_1"]);
    markDeleted(d, "job_1", 14);
    expect(nextStep(getJob(d, "job_1")!)).toBe("done");
    expect(openJobs(d)).toEqual([]);
    expect(listJobs(d)).toHaveLength(1);
  });
  it("failed and cancelled jobs only need the DELETE", () => {
    const d = db();
    recordJob(d, { ...VIEW, state: "failed", spent: 0 }, { sessionId: null, requestKey: "key_2", detail: {}, now: 1 });
    expect(nextStep(getJob(d, "job_1")!)).toBe("delete");
  });
  it("a request key belongs to one job", () => {
    const d = db();
    recordJob(d, VIEW, { sessionId: null, requestKey: "key_1", detail: {}, now: 1 });
    expect(() => recordJob(d, { ...VIEW, id: "job_2" }, { sessionId: null, requestKey: "key_1", detail: {}, now: 1 })).toThrow();
  });
});

describe("details and lines", () => {
  it("setDetail merges; markUnreadable ends the fetch; jobLine", () => {
    const d = db();
    recordJob(d, { ...VIEW, type: "retranscribe" }, { sessionId: null, requestKey: "key_1", detail: { parts: 3 }, now: 1 });
    setDetail(d, "job_1", { uploaded: 2 }, 2);
    expect(JSON.parse(getJob(d, "job_1")!.detail)).toEqual({ parts: 3, uploaded: 2 });
    expect(jobLine(getJob(d, "job_1")!)).toBe("Working on it");
    updateJob(d, { ...VIEW, state: "succeeded", spent: 3, result_ready: true }, 3);
    expect(jobLine(getJob(d, "job_1")!)).toBe("Getting the result");
    markUnreadable(d, "job_1", 4);
    expect(nextStep(getJob(d, "job_1")!)).toBe("delete");
    expect(jobLine(getJob(d, "job_1")!)).toBe("Couldn't open the result on this iPhone");
  });
});

describe("toBase64Url", () => {
  it("matches Node for every length mod 3", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 64, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      expect(toBase64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
  });
});
