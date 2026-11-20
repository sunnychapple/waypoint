// Decisions for the sync platform code (M29b), kept pure so they are tested in Node. The platform code does the I/O.

// The server's 409 messages for an Idempotency-Key (apps/api/src/idempotency.ts and the key version check).
export const KEY_STALE_MESSAGE = "key version is not current";
export const KEY_REUSED_MESSAGE = "Idempotency-Key reused with a different request";

// The Idempotency-Key for one locking of an outbox entry. Retries of the same locked bytes reuse it; a new key
// version or a new locking gets a new key, so the server never sees one key with two different bodies.
export function idempotencyKeyFor(entryId: string, keyVersion: number, locking: number): string {
  return `${entryId}-v${keyVersion}-${locking}`;
}

export const RECONNECT_MS = [2_000, 5_000, 15_000, 30_000] as const;
// A socket that stayed open this long counts as healthy: its next retry starts the backoff again.
export const STABLE_MS = 30_000;

// When the socket tries again after it could not connect (openedAt null) or closed (openedAt when it opened).
export function retryPlan(attempts: number, openedAt: number | null, closedAt: number): { waitMs: number; attempts: number } {
  const base = openedAt !== null && closedAt - openedAt >= STABLE_MS ? 0 : attempts;
  return { waitMs: RECONNECT_MS[Math.min(base, RECONNECT_MS.length - 1)] ?? STABLE_MS, attempts: base + 1 };
}

// The key versions a page needs that this iPhone does not hold. A pull waits for them and moves no last seq.
export function missingKeyVersions(needed: readonly number[], held: readonly number[]): number[] {
  return [...new Set(needed)].filter((version) => !held.includes(version));
}

const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;

// A capture id from the group's log becomes a file name, so it must be plain, and never the name of a local recording
// (audio-N.m4a, page-*.jpg). Session ids are checked the same way.
export function isSafeMediaIds(sessionId: string, captureId: string): boolean {
  return PLAIN_ID.test(sessionId) && PLAIN_ID.test(captureId) && !/^(audio|page)-/.test(captureId);
}

// Where a synced capture's file goes: its own folder under the session, apart from the recordings made on this iPhone.
// null when an id is unsafe (the file is then not downloaded).
export function syncedMediaPath(sessionId: string, captureId: string, kind: string): string | null {
  if (!isSafeMediaIds(sessionId, captureId)) return null;
  return `sessions/${sessionId}/synced/${captureId}.${kind === "audio" ? "m4a" : "jpg"}`;
}
