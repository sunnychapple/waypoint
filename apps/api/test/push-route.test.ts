import { PushTokenResponseSchema, type ApiError } from "@waypoint/contracts";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import type { Db } from "../src/storage.ts";
import { pushTokenRoute } from "../src/push/route.ts";
import { createTestDb } from "./helpers/d1.ts";

const NOW = 1_800_000_000_000;
const TOKEN = "ab".repeat(32);
const OTHER_TOKEN = "cd".repeat(32);
const DEVICE = "device_1234";

function userOf(id: string): SessionUser {
  return { id, clerk_id: `clerk_${id}`, plan: "free", billing_account_id: `ba_${id}`, zero_retention: false };
}

// A DB with users u1 and u2.
async function fixture(): Promise<Db> {
  const db = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind(id, `clerk_${id}`, NOW, `ba_${id}`)
      .run();
  }
  return db;
}

function setup(db: Db, user: SessionUser) {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/", pushTokenRoute({ now: () => NOW }));
  return app;
}

async function post(db: Db, user: SessionUser, body: unknown, key = crypto.randomUUID()) {
  return setup(db, user).request(
    "/v1/push-tokens",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    { DB: db },
  );
}

type Row = { user_id: string; device_id: string; token: string; environment: string; updated_at: number };

async function rowsFor(db: Db, sql: string, ...values: string[]): Promise<Row[]> {
  return (await db.prepare(sql).bind(...values).all<Row>()).results;
}

describe("POST /v1/push-tokens", () => {
  test("a good request gives 200 with the device id and stores the row", async () => {
    const db = await fixture();
    const res = await post(db, userOf("u1"), { device_id: DEVICE, token: TOKEN, environment: "production" });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(PushTokenResponseSchema.parse(body)).toEqual({ device_id: DEVICE });
    const rows = await rowsFor(db, "SELECT * FROM push_tokens WHERE user_id = ?", "u1");
    expect(rows).toEqual([
      { user_id: "u1", device_id: DEVICE, token: TOKEN, environment: "production", updated_at: NOW },
    ]);
  });

  test("the same device with a new token leaves one row, with the new token", async () => {
    const db = await fixture();
    await post(db, userOf("u1"), { device_id: DEVICE, token: TOKEN, environment: "sandbox" });
    const res = await post(db, userOf("u1"), { device_id: DEVICE, token: OTHER_TOKEN, environment: "sandbox" });
    expect(res.status).toBe(200);
    const rows = await rowsFor(db, "SELECT * FROM push_tokens WHERE user_id = ?", "u1");
    expect(rows.map((r) => r.token)).toEqual([OTHER_TOKEN]);
  });

  test("the same token sent by u2 for its own device removes u1's row and u2 has it", async () => {
    const db = await fixture();
    await post(db, userOf("u1"), { device_id: DEVICE, token: TOKEN, environment: "production" });
    const res = await post(db, userOf("u2"), { device_id: "device_5678", token: TOKEN, environment: "production" });
    expect(res.status).toBe(200);
    expect(await rowsFor(db, "SELECT * FROM push_tokens WHERE user_id = ?", "u1")).toEqual([]);
    const mine = await rowsFor(db, "SELECT * FROM push_tokens WHERE user_id = ?", "u2");
    expect(mine.map((r) => [r.device_id, r.token])).toEqual([["device_5678", TOKEN]]);
  });

  test("the same token from the same user under a new device_id leaves only the new row", async () => {
    const db = await fixture();
    await post(db, userOf("u1"), { device_id: DEVICE, token: TOKEN, environment: "production" });
    const res = await post(db, userOf("u1"), { device_id: "device_5678", token: TOKEN, environment: "production" });
    expect(res.status).toBe(200);
    const rows = await rowsFor(db, "SELECT * FROM push_tokens WHERE user_id = ?", "u1");
    expect(rows.map((r) => r.device_id)).toEqual(["device_5678"]);
  });

  test("an 11th device gives 409 conflict, and updating one of the first 10 still works", async () => {
    const db = await fixture();
    const user = userOf("u1");
    const tokenFor = (i: number) => i.toString(16).padStart(64, "0");
    for (let i = 0; i < 10; i++) {
      const res = await post(db, user, { device_id: `device_${i.toString().padStart(2, "0")}`, token: tokenFor(i), environment: "production" });
      expect(res.status).toBe(200);
    }
    const eleventh = await post(db, user, { device_id: "device_10", token: tokenFor(10), environment: "production" });
    expect(eleventh.status).toBe(409);
    expect(await eleventh.json()).toEqual({ code: "conflict", message: "too many devices", retry_after: null } satisfies ApiError);
    const update = await post(db, user, { device_id: "device_00", token: tokenFor(11), environment: "production" });
    expect(update.status).toBe(200);
  });

  test.each([
    ["bad JSON", "{not json"],
    ["an uppercase token", { device_id: DEVICE, token: "AB".repeat(32), environment: "production" }],
    ["an extra key", { device_id: DEVICE, token: TOKEN, environment: "production", extra: true }],
  ])("%s gives 400 bad_request and stores nothing", async (_label, body) => {
    const db = await fixture();
    const res = await post(db, userOf("u1"), body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
    expect(await rowsFor(db, "SELECT * FROM push_tokens")).toEqual([]);
  });

  test("the same key and body twice gives the second reply Idempotent-Replayed: true", async () => {
    const db = await fixture();
    const key = "abcdefghijklmnop";
    const body = { device_id: DEVICE, token: TOKEN, environment: "production" };
    const first = await post(db, userOf("u1"), body, key);
    expect(first.status).toBe(200);
    const second = await post(db, userOf("u1"), body, key);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotent-Replayed")).toBe("true");
  });
});
