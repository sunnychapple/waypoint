import { ActivityResponseSchema, type ActivityResponse } from "@waypoint/contracts";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { privacyRoutes } from "../src/privacy/routes.ts";
import { createTestDb } from "./helpers/d1.ts";

const NOW = 1_800_000_000_000;
const PLUS: SessionUser = { id: "u1", clerk_id: "user_1", plan: "plus", billing_account_id: "u1", zero_retention: false };
const FREE: SessionUser = { id: "u1", clerk_id: "user_1", plan: "free", billing_account_id: "u1", zero_retention: false };
const OWN: SessionUser = { id: "u1", clerk_id: "user_1", plan: "own", billing_account_id: "u1", zero_retention: false };

// A DB with users u1 and u2 (both free unless said), and the given activity rows for each.
async function fixture(rows: { user: string; id: string; at: number }[] = []) {
  const db = createTestDb();
  await db
    .prepare("INSERT INTO users (id, clerk_id, created_at, plan, billing_account_id) VALUES (?, ?, ?, ?, ?)")
    .bind("u1", "user_1", NOW, "plus", "u1")
    .run();
  await db
    .prepare("INSERT INTO users (id, clerk_id, created_at, plan, billing_account_id) VALUES (?, ?, ?, ?, ?)")
    .bind("u2", "user_2", NOW, "plus", "u2")
    .run();
  for (const row of rows) {
    await db
      .prepare(
        "INSERT INTO activity (id, user_id, task, bytes_sent, credits, route, retention, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(row.id, row.user, "explain", 10, 1, "clef/fast", "standard", row.at)
      .run();
  }
  return db;
}

function setup(user: SessionUser) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", privacyRoutes({ now: () => NOW }));
  return app;
}

function put(app: ReturnType<typeof setup>, env: { DB: ReturnType<typeof createTestDb> }, body: string, key: string) {
  return app.request(
    "/v1/settings/zero-retention",
    { method: "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body },
    env,
  );
}

async function zeroRetentionColumn(db: ReturnType<typeof createTestDb>, id: string): Promise<number> {
  const row = await db.prepare("SELECT zero_retention FROM users WHERE id = ?").bind(id).first<{ zero_retention: number }>();
  return row?.zero_retention ?? -1;
}

function activityGet(app: ReturnType<typeof setup>, env: { DB: ReturnType<typeof createTestDb> }, query: string) {
  return app.request(`/v1/activity${query}`, {}, env);
}

describe("PUT /v1/settings/zero-retention", () => {
  test("a Plus user turning it on gets 200 and the column is 1", async () => {
    const db = await fixture();
    const res = await put(setup(PLUS), { DB: db }, '{"enabled":true}', "key-on-plus-0001");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ zero_retention: true });
    expect(await zeroRetentionColumn(db, "u1")).toBe(1);
  });

  test("turning it on for u1 leaves another user's column at 0", async () => {
    const db = await fixture();
    const res = await put(setup(PLUS), { DB: db }, '{"enabled":true}', "key-on-only-u1-0001");
    expect(res.status).toBe(200);
    expect(await zeroRetentionColumn(db, "u1")).toBe(1);
    expect(await zeroRetentionColumn(db, "u2")).toBe(0);
  });

  test("a Plus user turning it off gets 200 and the column is 0", async () => {
    const db = await fixture();
    await db.prepare("UPDATE users SET zero_retention = 1 WHERE id = ?").bind("u1").run();
    const res = await put(setup(PLUS), { DB: db }, '{"enabled":false}', "key-off-plus-0001");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ zero_retention: false });
    expect(await zeroRetentionColumn(db, "u1")).toBe(0);
  });

  test("a free user turning it on gets 403 plan_required and the column stays 0", async () => {
    const db = await fixture();
    const res = await put(setup(FREE), { DB: db }, '{"enabled":true}', "key-on-free-0001");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "plan_required", message: "zero retention needs Plus", retry_after: null });
    expect(await zeroRetentionColumn(db, "u1")).toBe(0);
  });

  test("an own user turning it on gets 403 plan_required", async () => {
    const db = await fixture();
    const res = await put(setup(OWN), { DB: db }, '{"enabled":true}', "key-on-own-00001");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "plan_required", message: "zero retention needs Plus", retry_after: null });
    expect(await zeroRetentionColumn(db, "u1")).toBe(0);
  });

  test("a free user turning it off gets 200", async () => {
    const db = await fixture();
    const res = await put(setup(FREE), { DB: db }, '{"enabled":false}', "key-off-free-0001");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ zero_retention: false });
  });

  test("a bad value, bad JSON or an extra key gives 400 bad_request", async () => {
    const db = await fixture();
    const app = setup(PLUS);
    const bodies = ['{"enabled":"yes"}', "not json", '{"enabled":true,"extra":1}'];
    for (const [index, body] of bodies.entries()) {
      const res = await put(app, { DB: db }, body, `key-bad-input-000${index}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
    }
    expect(await zeroRetentionColumn(db, "u1")).toBe(0);
  });

  test("the same key and body twice gives the stored reply with Idempotent-Replayed: true", async () => {
    const db = await fixture();
    const app = setup(PLUS);
    const first = await put(app, { DB: db }, '{"enabled":false}', "key-replay-0000001");
    expect(first.status).toBe(200);
    const second = await put(app, { DB: db }, '{"enabled":false}', "key-replay-0000001");
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await second.json()).toEqual({ zero_retention: false });
  });
});

describe("GET /v1/activity", () => {
  const u1Rows = [1000, 1001, 1002, 1003, 1004].map((at, index) => ({ user: "u1", id: `a${index + 1}`, at }));
  const u2Rows = [
    { user: "u2", id: "b1", at: 1002 },
    { user: "u2", id: "b2", at: 1004 },
  ];

  test("limit 2 gives the two newest of u1 with a next cursor, and following next pages through all of them", async () => {
    const db = await fixture([...u1Rows, ...u2Rows]);
    const app = setup(PLUS);
    const env = { DB: db };

    const first = (await (await activityGet(app, env, "?limit=2")).json()) as ActivityResponse;
    expect(ActivityResponseSchema.safeParse(first).success).toBe(true);
    expect(first.items.map((item) => item.id)).toEqual(["a5", "a4"]);
    expect(first.next).toBe("1003_a4");

    const second = (await (await activityGet(app, env, `?limit=2&before=${first.next}`)).json()) as ActivityResponse;
    expect(ActivityResponseSchema.safeParse(second).success).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(["a3", "a2"]);
    expect(second.next).toBe("1001_a2");

    const last = (await (await activityGet(app, env, `?limit=2&before=${second.next}`)).json()) as ActivityResponse;
    expect(ActivityResponseSchema.safeParse(last).success).toBe(true);
    expect(last.items.map((item) => item.id)).toEqual(["a1"]);
    expect(last.next).toBeNull();
  });

  test("two rows with the same at are ordered by id descending and paging neither skips nor repeats them", async () => {
    const db = await fixture([
      { user: "u1", id: "x1", at: 5000 },
      { user: "u1", id: "x2", at: 5000 },
      { user: "u1", id: "x3", at: 5000 },
    ]);
    const app = setup(PLUS);
    const env = { DB: db };
    const seen: string[] = [];
    let query = "?limit=1";
    for (let page = 0; page < 5; page++) {
      const body = (await (await activityGet(app, env, query)).json()) as ActivityResponse;
      expect(ActivityResponseSchema.safeParse(body).success).toBe(true);
      seen.push(...body.items.map((item) => item.id));
      if (body.next === null) break;
      query = `?limit=1&before=${body.next}`;
    }
    expect(seen).toEqual(["x3", "x2", "x1"]);
  });

  test("two rows with the same at, the smaller id inserted first, come back larger id first", async () => {
    const db = await fixture([
      { user: "u1", id: "y1", at: 6000 },
      { user: "u1", id: "y2", at: 6000 },
    ]);
    const body = (await (await activityGet(setup(PLUS), { DB: db }, "?limit=10")).json()) as ActivityResponse;
    expect(body.items.map((item) => item.id)).toEqual(["y2", "y1"]);
  });

  test("a user with no rows gets an empty page with next null", async () => {
    const db = await fixture();
    const res = await activityGet(setup(PLUS), { DB: db }, "");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], next: null });
  });

  test("limit 0, limit 101, limit abc and a nonsense before gives 400 bad_request", async () => {
    const db = await fixture(u1Rows);
    const app = setup(PLUS);
    for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?before=nonsense"]) {
      const res = await activityGet(app, { DB: db }, query);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
    }
  });

  test("each reply item has exactly the keys id, task, bytes_sent, credits, route, retention and at", async () => {
    const db = await fixture(u1Rows);
    const body = (await (await activityGet(setup(PLUS), { DB: db }, "")).json()) as ActivityResponse;
    expect(body.items.length).toBe(5);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(["at", "bytes_sent", "credits", "id", "retention", "route", "task"]);
    }
  });
});
