import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { Command } from "@waypoint/ledger";
import type { AppEnv } from "../src/env.ts";
import { handleError, handleNotFound } from "../src/errors.ts";
import { adminCreditsRoute } from "../src/admin/credits.ts";
import { createWalletStore } from "../src/wallet/store.ts";
import { createTestDb } from "./helpers/d1.ts";
import { createTestStore } from "./helpers/sql.ts";
import type { Db } from "../src/storage.ts";

const NOW = 1_800_000_000_000;
const TOKEN = "t".repeat(40);
const CLERK_ID = "user_admin_1";

async function fixture() {
  const db: Db = createTestDb();
  await db
    .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
    .bind("u1", CLERK_ID, NOW, "billing-1")
    .run();
  const wallet = createWalletStore(createTestStore());
  const applied: Command[] = [];
  const WALLET = {
    idFromName: (name: string) => name,
    get: (id: string) => {
      expect(id).toBe("billing-1");
      return {
        apply: async (command: Command) => {
          applied.push(command);
          return wallet.apply(command, NOW);
        },
        read: async () => wallet.read(),
      };
    },
  };
  return { db, wallet, applied, WALLET };
}

function app() {
  const hono = new Hono<AppEnv>();
  hono.onError(handleError);
  hono.notFound(handleNotFound);
  hono.route("/", adminCreditsRoute());
  return hono;
}

type Overrides = { token?: string | undefined; env?: Record<string, unknown>; auth?: string | null };

async function post(body: unknown, options: Overrides & { db?: Db; WALLET?: unknown } = {}) {
  const f = await fixture();
  const env = {
    DB: options.db ?? f.db,
    WALLET: options.WALLET ?? f.WALLET,
    ADMIN_TOKEN: "token" in options ? options.token : TOKEN,
    ...options.env,
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.auth !== null) headers.Authorization = options.auth ?? `Bearer ${TOKEN}`;
  const res = await app().request(
    "/admin/credits",
    { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) },
    env,
  );
  return { res, f };
}

const GOOD = { clerkId: CLERK_ID, credits: 500, reason: "TestFlight", key: "grant-0001" };

describe("POST /admin/credits: refusals look like a missing route", () => {
  const missing = { status: 404, body: { code: "not_found", message: "no such endpoint", retry_after: null } };

  test("unset ADMIN_TOKEN is 404", async () => {
    const { res } = await post(GOOD, { token: undefined });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(missing.body);
  });

  test("a token shorter than 32 characters is 404, even when presented", async () => {
    const short = "s".repeat(31);
    const { res } = await post(GOOD, { token: short, auth: `Bearer ${short}` });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(missing.body);
  });

  test("a wrong token is 404", async () => {
    const { res } = await post(GOOD, { auth: `Bearer ${"x".repeat(40)}` });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(missing.body);
  });

  test("a token that is a prefix of the real one is 404", async () => {
    const { res } = await post(GOOD, { auth: `Bearer ${TOKEN.slice(0, 39)}` });
    expect(res.status).toBe(404);
  });

  test("no Authorization header, or not Bearer, is 404", async () => {
    expect((await post(GOOD, { auth: null })).res.status).toBe(404);
    expect((await post(GOOD, { auth: TOKEN })).res.status).toBe(404);
  });

  test("the route is not reachable under /v1", async () => {
    const f = await fixture();
    const res = await app().request(
      "/v1/admin/credits",
      { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: "{}" },
      { DB: f.db, WALLET: f.WALLET, ADMIN_TOKEN: TOKEN },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /admin/credits: body", () => {
  test("a bad body is 400", async () => {
    expect((await post({ ...GOOD, credits: 0 })).res.status).toBe(400);
    expect((await post({ ...GOOD, credits: 1.5 })).res.status).toBe(400);
    expect((await post({ ...GOOD, reason: "" })).res.status).toBe(400);
    expect((await post({ ...GOOD, key: "short" })).res.status).toBe(400);
    expect((await post({ ...GOOD, clerkId: undefined })).res.status).toBe(400);
    expect((await post({ ...GOOD, email: "someone@example.com" })).res.status).toBe(400);
    expect((await post("not json")).res.status).toBe(400);
  });

  test("credits over 5000 are 400 and nothing is granted", async () => {
    const { res, f } = await post({ ...GOOD, credits: 5001 });
    expect(res.status).toBe(400);
    expect(f.applied).toHaveLength(0);
  });

  test("an unknown user is 404 no_such_user and nothing is granted", async () => {
    const { res, f } = await post({ ...GOOD, clerkId: "user_nobody" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_such_user" });
    expect(f.applied).toHaveLength(0);
  });
});

describe("POST /admin/credits: grant", () => {
  test("a good request grants once to the purchased bucket and returns granted and balance", async () => {
    const f = await fixture();
    const res = await app().request(
      "/admin/credits",
      {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(GOOD),
      },
      { DB: f.db, WALLET: f.WALLET, ADMIN_TOKEN: TOKEN },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ granted: 500, balance: 500 });
    expect(f.applied).toEqual([
      { type: "grant", id: "admin:grant-0001", bucket: "purchased", credits: 500, ref: "admin", user_id: "u1" },
    ]);
    expect(f.wallet.read().purchased).toBe(500);
  });

  test("the same key sent twice grants once", async () => {
    const f = await fixture();
    const send = () =>
      app().request(
        "/admin/credits",
        {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(GOOD),
        },
        { DB: f.db, WALLET: f.WALLET, ADMIN_TOKEN: TOKEN },
      );
    expect((await send()).status).toBe(200);
    const second = await send();
    expect(second.status).toBe(200);
    expect(f.wallet.read().purchased).toBe(500);
    expect(f.wallet.ledger(0, 100).entries).toHaveLength(1);
  });

  test("a different key grants again", async () => {
    const f = await fixture();
    const send = (key: string) =>
      app().request(
        "/admin/credits",
        {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ ...GOOD, key }),
        },
        { DB: f.db, WALLET: f.WALLET, ADMIN_TOKEN: TOKEN },
      );
    await send("grant-0001");
    await send("grant-0002");
    expect(f.wallet.read().purchased).toBe(1000);
  });
});
