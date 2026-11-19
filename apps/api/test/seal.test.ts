import { openResult } from "@waypoint/crypto";
import { describe, expect, test } from "vitest";
import { SealError, sealJobResult, type ResultBucket } from "../src/jobs/seal.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice } from "./helpers/signing.ts";

export const bucketFits: (bucket: R2Bucket) => ResultBucket = (bucket) => bucket;

type Put = { key: string; value: Uint8Array; options: { customMetadata: Record<string, string> } };

// An in-memory ResultBucket that records every put.
function recordingBucket(): { bucket: ResultBucket; puts: Put[] } {
  const puts: Put[] = [];
  const bucket: ResultBucket = {
    async put(key, value, options) {
      puts.push({ key, value, options });
      return undefined;
    },
  };
  return { bucket, puts };
}

async function setup() {
  const db = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind(id, `clerk_${id}`, 1, `bill_${id}`)
      .run();
  }
  return db;
}

async function insertJob(db: ReturnType<typeof createTestDb>, id: string, userId: string, deviceId: string | null) {
  await db
    .prepare("INSERT INTO jobs (id, user_id, type, state, quoted, created_at, device_id) VALUES (?, ?, 'research', 'running', 0, 1, ?)")
    .bind(id, userId, deviceId)
    .run();
}

function isZeroed(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0);
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((b, j) => haystack[i + j] === b)) return true;
  }
  return false;
}

describe("sealJobResult", () => {
  test("seals to an approved device, stores once at results/{job} and records the key", async () => {
    const db = await setup();
    const device = await makeTestDevice("d1");
    await insertDevice(db, device, { userId: "u1" });
    await insertJob(db, "j1", "u1", "d1");
    const { bucket, puts } = recordingBucket();
    const plaintext = new TextEncoder().encode("the sealed note text");
    const expected = new TextEncoder().encode("the sealed note text");

    const result = await sealJobResult({ db, bucket }, { jobId: "j1", plaintext });

    expect(result.result_key).toBe("results/j1");
    expect(result.bytes).toBe(puts[0]?.value.length);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toBe("results/j1");
    expect(puts[0]?.options.customMetadata).toEqual({ format: "sealed-result-v1", device_id: "d1" });
    const row = await db.prepare("SELECT result_key FROM jobs WHERE id = ?").bind("j1").first<{ result_key: string | null }>();
    expect(row?.result_key).toBe("results/j1");
    const stored = puts[0]?.value ?? new Uint8Array();
    const opened = await openResult(stored, "j1", "d1", device.boxPrivate);
    expect(opened).toEqual(expected);
    expect(contains(stored, expected)).toBe(false);
    expect(isZeroed(plaintext)).toBe(true);
  });

  test("no such job throws no_job, puts nothing and zeroes the plaintext", async () => {
    const db = await setup();
    const { bucket, puts } = recordingBucket();
    const plaintext = new TextEncoder().encode("orphan");

    const error = await sealJobResult({ db, bucket }, { jobId: "missing", plaintext }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SealError);
    expect((error as SealError).reason).toBe("no_job");
    expect(puts).toHaveLength(0);
    expect(isZeroed(plaintext)).toBe(true);
  });

  test("a job without a device, a removed device, a waiting device or another user's device throws no_device", async () => {
    const db = await setup();
    const removed = await makeTestDevice("d-removed");
    await insertDevice(db, removed, { userId: "u1", removedAt: 2 });
    const waiting = await makeTestDevice("d-waiting");
    await insertDevice(db, waiting, { userId: "u1", approvedAt: null });
    const others = await makeTestDevice("d-other");
    await insertDevice(db, others, { userId: "u2" });
    const cases: { jobId: string; deviceId: string | null }[] = [
      { jobId: "j-null", deviceId: null },
      { jobId: "j-removed", deviceId: "d-removed" },
      { jobId: "j-waiting", deviceId: "d-waiting" },
      { jobId: "j-other", deviceId: "d-other" },
    ];
    for (const c of cases) {
      await insertJob(db, c.jobId, "u1", c.deviceId);
    }

    for (const c of cases) {
      const { bucket, puts } = recordingBucket();
      const plaintext = new TextEncoder().encode("nope");

      const error = await sealJobResult({ db, bucket }, { jobId: c.jobId, plaintext }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SealError);
      expect((error as SealError).reason).toBe("no_device");
      expect(puts).toHaveLength(0);
      expect(isZeroed(plaintext)).toBe(true);
      const row = await db.prepare("SELECT result_key FROM jobs WHERE id = ?").bind(c.jobId).first<{ result_key: string | null }>();
      expect(row?.result_key).toBeNull();
    }
  });

  test("exactly 4 MiB is sealed; 4 MiB plus one byte throws too_large and puts nothing", async () => {
    const db = await setup();
    const device = await makeTestDevice("d1");
    await insertDevice(db, device, { userId: "u1" });
    await insertJob(db, "j-max", "u1", "d1");
    await insertJob(db, "j-big", "u1", "d1");
    const { bucket, puts } = recordingBucket();
    const max = new Uint8Array(4 * 1024 * 1024).fill(7);

    const result = await sealJobResult({ db, bucket }, { jobId: "j-max", plaintext: max });
    expect(result.result_key).toBe("results/j-max");
    expect(puts).toHaveLength(1);
    expect(isZeroed(max)).toBe(true);

    const tooBig = new Uint8Array(4 * 1024 * 1024 + 1).fill(7);
    const error = await sealJobResult({ db, bucket }, { jobId: "j-big", plaintext: tooBig }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SealError);
    expect((error as SealError).reason).toBe("too_large");
    expect(puts).toHaveLength(1);
    expect(isZeroed(tooBig)).toBe(true);
  });

  test("if put rejects, the error propagates and result_key stays null", async () => {
    const db = await setup();
    const device = await makeTestDevice("d1");
    await insertDevice(db, device, { userId: "u1" });
    await insertJob(db, "j1", "u1", "d1");
    const bucket: ResultBucket = {
      put: () => Promise.reject(new Error("r2 down")),
    };
    const plaintext = new TextEncoder().encode("will not be stored");

    await expect(sealJobResult({ db, bucket }, { jobId: "j1", plaintext })).rejects.toThrow("r2 down");

    const row = await db.prepare("SELECT result_key FROM jobs WHERE id = ?").bind("j1").first<{ result_key: string | null }>();
    expect(row?.result_key).toBeNull();
    expect(isZeroed(plaintext)).toBe(true);
  });
});
