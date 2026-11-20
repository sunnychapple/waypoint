import { Hono, type Context } from "hono";
import { describe, expect, test } from "vitest";
import type { ApiError } from "@waypoint/contracts";
import type { SessionUser } from "../src/auth/users.ts";
import { ApiFailure, handleError } from "../src/errors.ts";
import {
  IDEMPOTENCY_KEEP_MS,
  IDEMPOTENCY_MAX_BODY_BYTES,
  IDEMPOTENCY_PENDING_MS,
  idempotent,
} from "../src/idempotency.ts";
import type { AppEnv } from "../src/env.ts";
import type { Db, DbStatement } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";

const NOW = 1_800_000_000_000;
const KEY = "abcdefghijklmnop";
const PATH = "/v1/things";
const USER: SessionUser = {
  id: "u1",
  clerk_id: "clerk_1",
  plan: "free",
  billing_account_id: "u1",
  zero_retention: false,
};

type Handler = (c: Context<AppEnv>) => Response | Promise<Response>;

function seedUser(db: Db, id: string, clerkId: string): Promise<{ changes: number }> {
  return db
    .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, 1, ?)")
    .bind(id, clerkId, id)
    .run()
    .then((r) => r.meta);
}

// The app shape from the card: a fixed user, the middleware under test, then the route under test.
function makeApp(db: Db, handler: Handler, options: { now?: () => number; user?: SessionUser } = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", options.user ?? USER);
    await next();
  });
  app.use("/v1/*", idempotent({ now: options.now ?? (() => NOW) }));
  app.post("/v1/*", handler);
  return app;
}

function post(app: Hono<AppEnv>, db: Db, path: string, body: unknown, key: string | null = KEY): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key !== null) headers["Idempotency-Key"] = key;
  return Promise.resolve(app.request(path, { method: "POST", headers, body: JSON.stringify(body) }, { DB: db }));
}

async function rowCount(db: Db): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM idempotency").first<{ n: number }>();
  return row?.n ?? -1;
}

async function requestHash(method: string, target: string, body: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${method}\n${target}\n${body}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function insertRow(
  db: Db,
  row: { userId?: string; key?: string; hash: string; state: "pending" | "done"; status?: number; body?: string; createdAt: number },
): Promise<void> {
  await db
    .prepare("INSERT INTO idempotency (user_id, key, request_hash, state, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(row.userId ?? "u1", row.key ?? KEY, row.hash, row.state, row.status ?? null, row.body ?? null, row.createdAt)
    .run();
}

function failingUpdate(db: Db): Db {
  return {
    prepare: (query) => {
      const statement = db.prepare(query);
      if (!query.startsWith("UPDATE")) return statement;
      const failing: DbStatement = {
        bind: () => failing,
        first: () => Promise.reject(new Error("D1 unavailable")),
        all: () => Promise.reject(new Error("D1 unavailable")),
        run: () => Promise.reject(new Error("D1 unavailable")),
      };
      return failing;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Another request takes the row over (rewrites its created_at) just before this request's takeover delete runs.
function takenOverBeforeDelete(db: Db, userId: string, newCreatedAt: number): Db {
  const racing = (statement: DbStatement): DbStatement => ({
    bind: (...values) => racing(statement.bind(...values)),
    first: <T = Record<string, unknown>>() => statement.first<T>(),
    all: <T = Record<string, unknown>>() => statement.all<T>(),
    run: async () => {
      await db.prepare("UPDATE idempotency SET created_at = ? WHERE user_id = ? AND key = ?").bind(newCreatedAt, userId, KEY).run();
      return statement.run();
    },
  });
  return {
    prepare: (query) => {
      const statement = db.prepare(query);
      return query.startsWith("DELETE FROM idempotency") ? racing(statement) : statement;
    },
  };
}

describe("idempotent: replay", () => {
  test("the first POST runs the handler; the same key and body replays the same reply", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ made: runs }, 201);
    });
    const first = await post(app, db, PATH, { name: "a" });
    expect(first.status).toBe(201);
    expect(first.headers.get("Idempotent-Replayed")).toBeNull();
    const firstBody = await first.text();

    const second = await post(app, db, PATH, { name: "a" });
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await second.text()).toBe(firstBody);
    expect(runs).toBe(1);
  });

  test("the handler can still read the JSON body after the middleware hashed it", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const app = makeApp(db, async (c) => c.json({ got: await c.req.json() }));
    const res = await post(app, db, PATH, { name: "hello" });
    expect(await res.json()).toEqual({ got: { name: "hello" } });
  });
});

describe("idempotent: conflicts", () => {
  test("the same key with a different body is 409 conflict and the handler does not run", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ ok: true });
    });
    await post(app, db, PATH, { name: "a" });
    const res = await post(app, db, PATH, { name: "b" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "conflict",
      message: "Idempotency-Key reused with a different request",
      retry_after: null,
    });
    expect(runs).toBe(1);
  });

  test("the same key with a different path is 409", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ ok: true });
    });
    await post(app, db, "/v1/things", { name: "a" });
    const res = await post(app, db, "/v1/other", { name: "a" });
    expect(res.status).toBe(409);
    expect((await res.json()) as ApiError).toMatchObject({ code: "conflict" });
    expect(runs).toBe(1);
  });

  test("the same key with a different query string is 409", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ ok: true });
    });
    await post(app, db, "/v1/things?x=1", { name: "a" });
    const res = await post(app, db, "/v1/things?x=2", { name: "a" });
    expect(res.status).toBe(409);
    expect((await res.json()) as ApiError).toMatchObject({ code: "conflict" });
    expect(runs).toBe(1);
  });

  test("the same key from a different user runs normally", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    await seedUser(db, "u2", "clerk_2");
    let runs = 0;
    const handler: Handler = (c) => {
      runs += 1;
      return c.json({ run: runs });
    };
    const first = makeApp(db, handler);
    const second = makeApp(db, handler, { user: { ...USER, id: "u2", clerk_id: "clerk_2", billing_account_id: "u2" } });
    await post(first, db, PATH, { name: "a" });
    const res = await post(second, db, PATH, { name: "a" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Idempotent-Replayed")).toBeNull();
    expect(await res.json()).toEqual({ run: 2 });
    expect(runs).toBe(2);
  });

  test("a second request while the first is still pending is 409 with retry_after 1 and Retry-After", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ ok: true });
    });
    await insertRow(db, { hash: await requestHash("POST", PATH, '{"name":"a"}'), state: "pending", createdAt: NOW });
    const res = await post(app, db, PATH, { name: "a" });
    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect(await res.json()).toEqual({ code: "conflict", message: "request in progress", retry_after: 1 });
    expect(runs).toBe(0);
  });

  test("a pending row older than 60 seconds is taken over: the handler runs and the reply is stored", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ ok: true, run: runs });
    });
    await insertRow(db, {
      hash: await requestHash("POST", PATH, '{"name":"a"}'),
      state: "pending",
      createdAt: NOW - IDEMPOTENCY_PENDING_MS - 1,
    });
    const first = await post(app, db, PATH, { name: "a" });
    expect(await first.json()).toEqual({ ok: true, run: 1 });
    const second = await post(app, db, PATH, { name: "a" });
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(runs).toBe(1);
  });

  test("a done row older than 24 hours is ignored and the handler runs again", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let now = NOW;
    let runs = 0;
    const app = makeApp(
      db,
      (c) => {
        runs += 1;
        return c.json({ run: runs });
      },
      { now: () => now },
    );
    await post(app, db, PATH, { name: "a" });
    now = NOW + IDEMPOTENCY_KEEP_MS + 1;
    const res = await post(app, db, PATH, { name: "a" });
    expect(res.headers.get("Idempotent-Replayed")).toBeNull();
    expect(await res.json()).toEqual({ run: 2 });
    expect(runs).toBe(2);
  });
});

describe("idempotent: what is stored", () => {
  test("a 402 is not stored: the row is deleted and the same request runs the handler again", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, () => {
      runs += 1;
      if (runs === 1) throw new ApiFailure("insufficient_credits", "not enough credits");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const first = await post(app, db, PATH, { name: "a" });
    expect(first.status).toBe(402);
    expect(await rowCount(db)).toBe(0);
    const second = await post(app, db, PATH, { name: "a" });
    expect(second.status).toBe(200);
    expect(runs).toBe(2);
  });

  test("a 409 with Retry-After from the handler (a hold still in progress) is not stored: the same request runs again", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, () => {
      runs += 1;
      if (runs === 1) throw new ApiFailure("conflict", "request in progress", 1);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const first = await post(app, db, PATH, { name: "a" });
    expect(first.status).toBe(409);
    expect(first.headers.get("Retry-After")).toBe("1");
    expect(await rowCount(db)).toBe(0);
    const second = await post(app, db, PATH, { name: "a" });
    expect(second.status).toBe(200);
    expect(runs).toBe(2);
  });

  test("a plain Error (500) is not stored: the row is deleted", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const app = makeApp(db, () => {
      throw new Error("boom");
    });
    const res = await post(app, db, PATH, { name: "a" });
    expect(res.status).toBe(500);
    expect(await rowCount(db)).toBe(0);
  });

  test("a 403 is not stored: the row is deleted", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const app = makeApp(db, (c) => c.json({ code: "forbidden", message: "no", retry_after: null }, 403));
    const res = await post(app, db, PATH, { name: "a" });
    expect(res.status).toBe(403);
    expect(await rowCount(db)).toBe(0);
  });

  test.each([400, 404, 409])("a handler that returns %i is stored and replayed", async (status) => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ status }, status as 400 | 404 | 409);
    });
    const first = await post(app, db, PATH, { name: "a" });
    expect(first.status).toBe(status);
    const second = await post(app, db, PATH, { name: "a" });
    expect(second.status).toBe(status);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await second.json()).toEqual({ status });
    expect(runs).toBe(1);
  });

  test("a plain text reply is not stored: the row is deleted", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const app = makeApp(db, (c) => c.text("ok"));
    const res = await post(app, db, PATH, { name: "a" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(await rowCount(db)).toBe(0);
  });

  // The envelope {"pad":""} is 10 bytes, so this pad gives a reply of exactly `size` bytes.
  const replyOfSize = (size: number) => JSON.stringify({ pad: "x".repeat(size - JSON.stringify({ pad: "" }).length) });

  test("a JSON reply over 16,384 bytes is not stored: the row is deleted", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const reply = replyOfSize(IDEMPOTENCY_MAX_BODY_BYTES + 1);
    const app = makeApp(db, () => new Response(reply, { headers: { "Content-Type": "application/json" } }));
    const res = await post(app, db, PATH, { name: "a" });
    expect(await res.text()).toBe(reply);
    expect(await rowCount(db)).toBe(0);
  });

  test("a JSON reply of exactly 16,384 bytes is stored", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const reply = replyOfSize(IDEMPOTENCY_MAX_BODY_BYTES);
    expect(new TextEncoder().encode(reply).byteLength).toBe(IDEMPOTENCY_MAX_BODY_BYTES);
    let runs = 0;
    const app = makeApp(db, () => {
      runs += 1;
      return new Response(reply, { headers: { "Content-Type": "application/json" } });
    });
    await post(app, db, PATH, { name: "a" });
    const row = await db.prepare("SELECT state FROM idempotency").first<{ state: string }>();
    expect(row).toEqual({ state: "done" });
    const second = await post(app, db, PATH, { name: "a" });
    expect(await second.text()).toBe(reply);
    expect(runs).toBe(1);
  });

  test("if the D1 update fails, the handler's reply is still returned", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const app = makeApp(db, (c) => c.json({ made: true }, 201), {});
    const res = await post(app, failingUpdate(db), PATH, { name: "a" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ made: true });
  });
});

describe("idempotent: key and storage shape", () => {
  test("a missing key is 400 bad_request and the handler does not run", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ ok: true });
    });
    const res = await post(app, db, PATH, { name: "a" }, null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "Idempotency-Key header required", retry_after: null });
    expect(runs).toBe(0);
  });

  test("a 15-character key is 400 bad_request and the handler does not run", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ ok: true });
    });
    const res = await post(app, db, PATH, { name: "a" }, "abcdefghijklmno");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "bad_request" });
    expect(runs).toBe(0);
  });

  test("the stored request_hash is 64 lowercase hex characters", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const app = makeApp(db, (c) => c.json({ ok: true }));
    await post(app, db, PATH, { name: "a" });
    const row = await db.prepare("SELECT request_hash FROM idempotency").first<{ request_hash: string }>();
    expect(row?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.request_hash).toBe(await requestHash("POST", PATH, '{"name":"a"}'));
  });

  test("the request body is never stored: no column of the row holds the body", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const marker = "PRIVATE-MARKER-4f2a9c";
    const app = makeApp(db, (c) => c.json({ ok: true }));
    await post(app, db, PATH, { name: marker });
    const rows = await db.prepare("SELECT * FROM idempotency").all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    expect(JSON.stringify(rows.results)).not.toContain(marker);
  });
});

describe("idempotent: races", () => {
  test("five concurrent POSTs with the same key run the handler once", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, async (c) => {
      runs += 1;
      await sleep(20);
      return c.json({ made: runs }, 201);
    });
    const replies = await Promise.all(Array.from({ length: 5 }, () => post(app, db, PATH, { name: "a" })));
    expect(runs).toBe(1);
    for (const reply of replies) expect([201, 409]).toContain(reply.status);
    const bodies = await Promise.all(replies.filter((r) => r.status === 201).map((r) => r.text()));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).toBe('{"made":1}');
    expect(await rowCount(db)).toBe(1);
  });

  test("two requests racing to take over the same abandoned pending row run the handler once", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    await insertRow(db, {
      hash: await requestHash("POST", PATH, '{"name":"a"}'),
      state: "pending",
      createdAt: NOW - IDEMPOTENCY_PENDING_MS - 1,
    });
    let runs = 0;
    const app = makeApp(db, async (c) => {
      runs += 1;
      await sleep(20);
      return c.json({ run: runs }, 201);
    });
    const replies = await Promise.all([post(app, db, PATH, { name: "a" }), post(app, db, PATH, { name: "a" })]);
    expect(runs).toBe(1);
    for (const reply of replies) expect([201, 409]).toContain(reply.status);
    expect(await rowCount(db)).toBe(1);
  });
});

describe("idempotent: check order", () => {
  test("a pending row with a different request_hash is the reused-key 409, not request in progress", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ ok: true });
    });
    await insertRow(db, { hash: await requestHash("POST", PATH, '{"name":"other"}'), state: "pending", createdAt: NOW });
    const res = await post(app, db, PATH, { name: "a" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      code: "conflict",
      message: "Idempotency-Key reused with a different request",
      retry_after: null,
    });
    expect(runs).toBe(0);
  });
});

describe("idempotent: byte limit counts UTF-8 bytes", () => {
  // "é" is 2 bytes in UTF-8 but one UTF-16 unit, and the envelope {"pad":""} is 10 bytes.
  test("a JSON reply of 2-byte characters that is exactly 16,384 bytes is stored", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const reply = JSON.stringify({ pad: "é".repeat(8187) });
    expect(new TextEncoder().encode(reply).byteLength).toBe(IDEMPOTENCY_MAX_BODY_BYTES);
    let runs = 0;
    const app = makeApp(db, () => {
      runs += 1;
      return new Response(reply, { headers: { "Content-Type": "application/json" } });
    });
    await post(app, db, PATH, { name: "a" });
    expect(await db.prepare("SELECT state FROM idempotency").first()).toEqual({ state: "done" });
    const second = await post(app, db, PATH, { name: "a" });
    expect(await second.text()).toBe(reply);
    expect(runs).toBe(1);
  });

  test("a JSON reply of 2-byte characters that is 16,385 bytes is not stored", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const reply = JSON.stringify({ pad: "é".repeat(8187) + "x" });
    expect(new TextEncoder().encode(reply).byteLength).toBe(IDEMPOTENCY_MAX_BODY_BYTES + 1);
    const app = makeApp(db, () => new Response(reply, { headers: { "Content-Type": "application/json" } }));
    const res = await post(app, db, PATH, { name: "a" });
    expect(await res.text()).toBe(reply);
    expect(await rowCount(db)).toBe(0);
  });
});

describe("idempotent: takeover delete is compare-and-delete", () => {
  test("if another request takes the row over before the delete, nothing is deleted and the request is 409 request in progress", async () => {
    const db = createTestDb();
    await seedUser(db, "u1", "clerk_1");
    const takenOverAt = NOW - 1_000;
    await insertRow(db, {
      hash: await requestHash("POST", PATH, '{"name":"a"}'),
      state: "pending",
      createdAt: NOW - IDEMPOTENCY_PENDING_MS - 1,
    });
    let runs = 0;
    const app = makeApp(db, (c) => {
      runs += 1;
      return c.json({ ok: true });
    });
    const res = await post(app, takenOverBeforeDelete(db, "u1", takenOverAt), PATH, { name: "a" });
    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect(await res.json()).toEqual({ code: "conflict", message: "request in progress", retry_after: 1 });
    expect(runs).toBe(0);
    expect(await rowCount(db)).toBe(1);
    expect(await db.prepare("SELECT created_at FROM idempotency").first()).toEqual({ created_at: takenOverAt });
  });
});
