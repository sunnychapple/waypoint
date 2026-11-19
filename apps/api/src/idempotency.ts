import { IDEMPOTENCY_KEY_HEADER, isValidIdempotencyKey } from "@waypoint/contracts";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env.ts";
import { ApiFailure } from "./errors.ts";
import type { Db } from "./storage.ts";

const CHECKED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const requireIdempotencyKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (CHECKED_METHODS.has(c.req.method) && !isValidIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER))) {
    throw new ApiFailure("bad_request", "Idempotency-Key header required");
  }
  await next();
};

export const IDEMPOTENCY_KEEP_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_PENDING_MS = 60 * 1000;
export const IDEMPOTENCY_MAX_BODY_BYTES = 16384;

type StoredRow = {
  request_hash: string;
  state: "pending" | "done";
  status: number | null;
  body: string | null;
  created_at: number;
};

async function hashRequest(method: string, target: string, body: ArrayBuffer): Promise<string> {
  const head = new TextEncoder().encode(`${method}\n${target}\n`);
  const bytes = new Uint8Array(head.byteLength + body.byteLength);
  bytes.set(head, 0);
  bytes.set(new Uint8Array(body), head.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function isStorable(reply: Response): boolean {
  const status = reply.status;
  const statusOk = (status >= 200 && status <= 299) || status === 400 || status === 404 || status === 409;
  return statusOk && (reply.headers.get("Content-Type") ?? "").startsWith("application/json");
}

export function idempotent(deps: { now: () => number }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (key === undefined || !isValidIdempotencyKey(key)) {
      throw new ApiFailure("bad_request", "Idempotency-Key header required");
    }
    const db: Db = c.env.DB;
    const userId = c.get("user").id;
    const { pathname, search } = new URL(c.req.url);
    const requestHash = await hashRequest(c.req.method, pathname + search, await c.req.arrayBuffer());

    const insertPending = async (now: number): Promise<boolean> => {
      const result = await db
        .prepare(
          "INSERT INTO idempotency (user_id, key, request_hash, state, status, body, created_at) VALUES (?, ?, ?, 'pending', NULL, NULL, ?) ON CONFLICT (user_id, key) DO NOTHING",
        )
        .bind(userId, key, requestHash, now)
        .run();
      return result.meta.changes === 1;
    };

    const now = deps.now();
    if (!(await insertPending(now))) {
      const row = await db
        .prepare("SELECT request_hash, state, status, body, created_at FROM idempotency WHERE user_id = ? AND key = ?")
        .bind(userId, key)
        .first<StoredRow>();
      // A row that vanished between the insert and this read is treated as in progress; the client retries.
      if (row === null) throw new ApiFailure("conflict", "request in progress", 1);
      const stale = now - row.created_at > IDEMPOTENCY_KEEP_MS || (row.state === "pending" && now - row.created_at > IDEMPOTENCY_PENDING_MS);
      if (stale) {
        await db
          .prepare("DELETE FROM idempotency WHERE user_id = ? AND key = ? AND created_at = ?")
          .bind(userId, key, row.created_at)
          .run();
        if (!(await insertPending(now))) throw new ApiFailure("conflict", "request in progress", 1);
      } else {
        if (row.request_hash !== requestHash) {
          throw new ApiFailure("conflict", "Idempotency-Key reused with a different request");
        }
        if (row.state === "pending") throw new ApiFailure("conflict", "request in progress", 1);
        if (row.status === null || row.body === null) throw new ApiFailure("internal", "something went wrong");
        return new Response(row.body, {
          status: row.status,
          headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" },
        });
      }
    }

    await next();

    // Storing the reply must never change it: any failure here still returns the handler's reply.
    try {
      const reply = c.res;
      if (isStorable(reply)) {
        const bytes = await reply.clone().arrayBuffer();
        if (bytes.byteLength <= IDEMPOTENCY_MAX_BODY_BYTES) {
          await db
            .prepare("UPDATE idempotency SET state = 'done', status = ?, body = ? WHERE user_id = ? AND key = ?")
            .bind(reply.status, new TextDecoder().decode(bytes), userId, key)
            .run();
          return;
        }
      }
      await db.prepare("DELETE FROM idempotency WHERE user_id = ? AND key = ?").bind(userId, key).run();
    } catch {
      // The row stays as it is; the reply is still returned below.
    }
  };
}
