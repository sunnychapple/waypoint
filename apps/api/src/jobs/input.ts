import { fromBase64Url, toBase64Url } from "@waypoint/crypto";

// What the person sent with a job. Held in R2 only while the job runs, encrypted with a key that exists only in the
// Workflow's params; never put in params, D1, KV, a queue or a log.
export type JobInput = { text: string; prompt: string | null };

export const JOB_INPUT_PREFIX = "tmp/input/";

// The parts of R2 this module uses. R2Bucket satisfies this type.
export type InputBucket = {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Encrypts the input with a fresh AES-256-GCM key (12-byte IV first, the job id as additional data), stores it at
// tmp/input/{job} and returns the key as base64url for the Workflow's params.
export async function putJobInput(bucket: InputBucket, jobId: string, input: JobInput): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(input));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(jobId) }, await importKey(raw), plain),
  );
  const stored = new Uint8Array(iv.length + sealed.length);
  stored.set(iv, 0);
  stored.set(sealed, iv.length);
  await bucket.put(`${JOB_INPUT_PREFIX}${jobId}`, stored);
  return toBase64Url(raw);
}

// The job's input, or null if the object is gone or does not open with this key.
export async function readJobInput(bucket: InputBucket, jobId: string, key: string): Promise<JobInput | null> {
  const object = await bucket.get(`${JOB_INPUT_PREFIX}${jobId}`);
  if (object === null) return null;
  const stored = new Uint8Array(await object.arrayBuffer());
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: stored.slice(0, 12), additionalData: new TextEncoder().encode(jobId) },
      await importKey(fromBase64Url(key)),
      stored.slice(12),
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (typeof parsed !== "object" || parsed === null || !("text" in parsed) || !("prompt" in parsed)) return null;
    const { text, prompt } = parsed;
    if (typeof text !== "string" || (prompt !== null && typeof prompt !== "string")) return null;
    return { text, prompt };
  } catch {
    return null;
  }
}

export async function deleteJobInput(bucket: InputBucket, jobId: string): Promise<void> {
  await bucket.delete(`${JOB_INPUT_PREFIX}${jobId}`);
}
