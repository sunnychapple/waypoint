import { isValidIdempotencyKey } from "@waypoint/contracts";
import { describe, expect, it } from "vitest";
import {
  KEY_REUSED_MESSAGE,
  KEY_STALE_MESSAGE,
  idempotencyKeyFor,
  isSafeMediaIds,
  missingKeyVersions,
  retryPlan,
  syncedMediaPath,
} from "../src/core/sync/rules.ts";

const ENTRY = "3f2c6a1e-0000-4000-8000-000000000001";

describe("sync rules", () => {
  it("the same locking keeps its key; a new key version or locking gets a new one", () => {
    expect(idempotencyKeyFor(ENTRY, 2, 0)).toBe(`${ENTRY}-v2-0`);
    expect(idempotencyKeyFor(ENTRY, 2, 0)).toBe(idempotencyKeyFor(ENTRY, 2, 0));
    expect(idempotencyKeyFor(ENTRY, 3, 0)).not.toBe(idempotencyKeyFor(ENTRY, 2, 0));
    expect(idempotencyKeyFor(ENTRY, 2, 1)).not.toBe(idempotencyKeyFor(ENTRY, 2, 0));
    for (const key of [idempotencyKeyFor(ENTRY, 12, 345), idempotencyKeyFor("abcdefghijklmnop", 1, 0)]) expect(isValidIdempotencyKey(key)).toBe(true);
  });
  it("the server's 409 messages are the ones the retry rules match", () => {
    expect(KEY_STALE_MESSAGE).toBe("key version is not current");
    expect(KEY_REUSED_MESSAGE).toBe("Idempotency-Key reused with a different request");
  });

  it("the socket backs off 2, 5, 15, then 30 seconds", () => {
    expect(retryPlan(0, null, 0)).toEqual({ waitMs: 2_000, attempts: 1 });
    expect(retryPlan(1, null, 0)).toEqual({ waitMs: 5_000, attempts: 2 });
    expect(retryPlan(2, null, 0)).toEqual({ waitMs: 15_000, attempts: 3 });
    expect(retryPlan(3, null, 0)).toEqual({ waitMs: 30_000, attempts: 4 });
    expect(retryPlan(9, null, 0)).toEqual({ waitMs: 30_000, attempts: 10 });
  });
  it("a socket that closes soon after it opened keeps counting up", () => {
    expect(retryPlan(2, 1_000, 1_000 + 29_999)).toEqual({ waitMs: 15_000, attempts: 3 });
  });
  it("a socket that stayed open 30 seconds starts the backoff again", () => {
    expect(retryPlan(3, 1_000, 1_000 + 30_000)).toEqual({ waitMs: 2_000, attempts: 1 });
  });

  it("missing key versions: none when all are held, the ones not held otherwise", () => {
    expect(missingKeyVersions([1, 2, 2], [1, 2, 3])).toEqual([]);
    expect(missingKeyVersions([1, 2, 3, 3], [1])).toEqual([2, 3]);
    expect(missingKeyVersions([], [])).toEqual([]);
  });

  it("capture ids: plain ids only, never a local recording's name", () => {
    expect(isSafeMediaIds("ses_1", "9b1f0c2e-0000-4000-8000-000000000002")).toBe(true);
    expect(isSafeMediaIds("ses_1", "audio-0")).toBe(false);
    expect(isSafeMediaIds("ses_1", "page-3")).toBe(false);
    expect(isSafeMediaIds("ses_1", "../../x")).toBe(false);
    expect(isSafeMediaIds("ses_1", "a/b")).toBe(false);
    expect(isSafeMediaIds("ses_1", "")).toBe(false);
    expect(isSafeMediaIds("ses_1", "a".repeat(65))).toBe(false);
    expect(isSafeMediaIds("../ses", "cap_1")).toBe(false);
  });
  it("a synced file goes under its session's synced folder", () => {
    expect(syncedMediaPath("ses_1", "cap_1", "audio")).toBe("sessions/ses_1/synced/cap_1.m4a");
    expect(syncedMediaPath("ses_1", "cap_1", "photo")).toBe("sessions/ses_1/synced/cap_1.jpg");
    expect(syncedMediaPath("ses_1", "audio-0", "audio")).toBeNull();
    expect(syncedMediaPath("..", "cap_1", "photo")).toBeNull();
  });
});
