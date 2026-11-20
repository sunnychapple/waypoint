import {
  AUDIO_CHUNK_CONTENT_TYPE,
  AudioDoneRequestSchema,
  MAX_AUDIO_CHUNK_BYTES,
  MAX_AUDIO_CHUNKS,
  type AudioChunkResponse,
  type AudioDoneResponse,
} from "@waypoint/contracts";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env.ts";
import { ApiFailure } from "../errors.ts";
import { idempotent } from "../idempotency.ts";
import { readTaskBody } from "../tasks/instant.ts";
import { AUDIO_UPLOADED_EVENT, audioKey } from "./retranscribe.ts";

// The job must be the caller's own retranscribe job, still waiting for its audio.
async function openUpload(c: Context<AppEnv>, jobId: string): Promise<void> {
  const job = await c.env.DB.prepare("SELECT user_id, type, state FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ user_id: string; type: string; state: string }>();
  if (job === null || job.user_id !== c.get("user").id || job.type !== "retranscribe") throw new ApiFailure("not_found", "no such job");
  if (job.state !== "queued") throw new ApiFailure("conflict", "upload closed");
}

export function audioRoutes(deps: { now: () => number }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // One recording part. Not idempotent(): that store reads the whole body, and a repeated PUT just replaces the object.
  app.put("/v1/jobs/:id/audio/:n", async (c) => {
    const jobId = c.req.param("id");
    const nText = c.req.param("n");
    if (!/^\d{1,3}$/.test(nText) || Number(nText) >= MAX_AUDIO_CHUNKS) throw new ApiFailure("bad_request", "invalid chunk");
    const n = Number(nText);
    if (c.req.header("Content-Type") !== AUDIO_CHUNK_CONTENT_TYPE) throw new ApiFailure("bad_request", "audio/mp4 required");
    const lengthText = c.req.header("Content-Length") ?? "";
    const length = /^\d{1,9}$/.test(lengthText) ? Number(lengthText) : 0;
    if (length < 1 || length > MAX_AUDIO_CHUNK_BYTES) throw new ApiFailure("bad_request", "invalid audio size");
    await openUpload(c, jobId);
    const body = c.req.raw.body;
    if (body === null) throw new ApiFailure("bad_request", "invalid audio size");
    await c.env.BUCKET.put(audioKey(jobId, n), body, { httpMetadata: { contentType: AUDIO_CHUNK_CONTENT_TYPE } });
    const reply: AudioChunkResponse = { chunk: n, bytes: length };
    return c.json(reply);
  });

  app.post("/v1/jobs/:id/audio/done", idempotent(deps), async (c) => {
    const jobId = c.req.param("id");
    const { chunks } = await readTaskBody(c, AudioDoneRequestSchema);
    await openUpload(c, jobId);
    let bytes = 0;
    for (let n = 0; n < chunks; n++) {
      const head = await c.env.BUCKET.head(audioKey(jobId, n));
      if (head === null) throw new ApiFailure("bad_request", `chunk ${n} missing`);
      bytes += head.size;
    }
    const instance = await c.env.RETRANSCRIBE_WORKFLOW.get(jobId);
    await instance.sendEvent({ type: AUDIO_UPLOADED_EVENT, payload: { chunks, bytes } });
    const reply: AudioDoneResponse = { chunks, bytes };
    return c.json(reply, 202);
  });

  return app;
}
