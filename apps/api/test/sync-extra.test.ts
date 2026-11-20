import { SYNC_DAILY_BYTES, SYNC_EXTRA_BYTES, SYNC_EXTRA_CREDITS, SyncExtraResponseSchema } from "@waypoint/contracts";
import type { Command } from "@waypoint/ledger";
import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import type { SessionUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { spendSyncBytes } from "../src/sync/budget.ts";
import { syncExtraRoute } from "../src/sync/extra.ts";
import { createWalletStore } from "../src/wallet/store.ts";
import { createTestDb } from "./helpers/d1.ts";
import { insertDevice, makeTestDevice, signedInit, type TestDevice } from "./helpers/signing.ts";
import { createTestStore } from "./helpers/sql.ts";

const NOW = 1_763_560_000_000;
const DAY = Math.floor(NOW / 86_400_000);
const PATH = "/v1/sync/extra";
const U1: SessionUser = { id: "u1", clerk_id: "clerk_u1", plan: "free", billing_account_id: "ba_u1", zero_retention: false };

// u1 with an approved phone and a wallet holding `purchased` credits; every wallet command is recorded. failSettles:
// how many settles throw before they reach the wallet (a Durable Object call that fails).
// failSql: D1 statements containing this text throw. releaseBeforeSettle: how many settles find their hold already
// released (its alarm ran), so the wallet answers not ok. clock.now is the time the route sees.
async function world(purchased: number, failSettles = 0, options: { failSql?: string; landThenFail?: string; releaseBeforeSettle?: number } = {}) {
  const realDb = createTestDb();
  const db = realDb;
  const flaky = new Proxy(realDb, {
    get: (target, prop) =>
      prop === "prepare"
        ? (sql: string) => {
            // landThenFail: the statement runs and its effect stays, but the caller sees an error (a lost D1 reply).
            if (options.landThenFail !== undefined && sql.includes(options.landThenFail)) {
              const landed = async () => {
                await target.prepare(sql).bind(...args).run();
                throw new Error("d1 reply lost");
              };
              let args: unknown[] = [];
              return {
                bind: (...a: unknown[]) => {
                  args = a;
                  return { run: landed, first: landed, all: landed };
                },
              };
            }
            if (options.failSql !== undefined && sql.includes(options.failSql)) {
              const fail = async () => {
                throw new Error("d1 unavailable");
              };
              return { bind: () => ({ run: fail, first: fail, all: fail }) };
            }
            return target.prepare(sql);
          }
        : Reflect.get(target, prop),
  });
  const clock = { now: NOW };
  let releases = options.releaseBeforeSettle ?? 0;
  await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'ba_u1')").run();
  const phone: TestDevice = await makeTestDevice("dev_phone");
  await insertDevice(db, phone, { userId: "u1" });
  const store = createWalletStore(createTestStore());
  if (purchased > 0) store.apply({ type: "grant", id: "seed", bucket: "purchased", credits: purchased, ref: "test" }, NOW);
  const commands: Command[] = [];
  let settlesToFail = failSettles;
  const env = {
    DB: flaky,
    WALLET: {
      idFromName: (name: string) => name,
      get: (_name: string) => ({
        apply: async (command: Command) => {
          commands.push(command);
          if (command.type === "settle" && settlesToFail > 0) {
            settlesToFail -= 1;
            throw new Error("wallet unavailable");
          }
          if (command.type === "settle" && releases > 0) {
            releases -= 1;
            store.apply({ type: "release", id: `alarm:${releases}`, hold_id: command.hold_id }, NOW);
          }
          return store.apply(command, NOW);
        },
      }),
    },
  };
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use(async (c, next) => {
    c.set("user", U1);
    await next();
  });
  app.route("/", syncExtraRoute({ now: () => clock.now }));
  const buy = async (body: unknown, key = "key-extra-0123456789") =>
    app.request(PATH, await signedInit(phone, { method: "POST", path: PATH, body, now: clock.now, idempotencyKey: key }), env);
  return { db, store, commands, app, env, buy, clock };
}

describe("POST /v1/sync/extra", () => {
  test("100 credits add 1 GB for today: hold then settle, and today's budget grows by that much", async () => {
    const w = await world(250);
    const res = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(res.status).toBe(200);
    expect(SyncExtraResponseSchema.parse(await res.json())).toEqual({ credits: SYNC_EXTRA_CREDITS, extra_bytes: SYNC_EXTRA_BYTES });
    expect(w.commands.map((c) => c.type)).toEqual(["hold", "settle"]);
    expect(w.commands[0]).toMatchObject({ id: "sync_extra:u1:key-extra-0123456789", task: "sync_extra", credits: SYNC_EXTRA_CREDITS });
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [] });
    await spendSyncBytes(w.db, "u1", SYNC_DAILY_BYTES + SYNC_EXTRA_BYTES, NOW);
    await expect(spendSyncBytes(w.db, "u1", 1, NOW)).rejects.toThrow("daily sync limit reached");
  });

  test("a second purchase the same day adds another 1 GB; the same request again replays and charges once", async () => {
    const w = await world(250);
    await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-aaaaaaaaaa");
    const replay = await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-aaaaaaaaaa");
    expect(SyncExtraResponseSchema.parse(await replay.json()).extra_bytes).toBe(SYNC_EXTRA_BYTES);
    const second = await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-bbbbbbbbbb");
    expect(SyncExtraResponseSchema.parse(await second.json()).extra_bytes).toBe(2 * SYNC_EXTRA_BYTES);
    expect(w.store.read().purchased).toBe(50);
    const row = await w.db.prepare("SELECT SUM(bytes) AS bytes FROM sync_extras WHERE user_id = 'u1' AND day = ?").bind(DAY).first<{ bytes: number }>();
    expect(row?.bytes).toBe(2 * SYNC_EXTRA_BYTES);
  });

  test("a settle that fails, then the same request again while its hold is open: 1 GB added once, 100 credits charged once", async () => {
    const w = await world(250, 1);
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS })).status).toBe(500);
    const retry = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(retry.status).toBe(200);
    expect(SyncExtraResponseSchema.parse(await retry.json()).extra_bytes).toBe(SYNC_EXTRA_BYTES);
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [] });
  });

  test("not enough credits: 402 with the shortfall, nothing added", async () => {
    const w = await world(40);
    const res = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "insufficient_credits", shortfall: 60 });
    expect(w.commands.map((c) => c.type)).toEqual(["hold"]);
    expect(await w.db.prepare("SELECT COUNT(*) AS n FROM sync_extras").first<{ n: number }>()).toEqual({ n: 0 });
    expect(w.store.read()).toMatchObject({ purchased: 40, holds: [] });
  });

  test("a price the server does not charge gets 409 'price changed' and no wallet command", async () => {
    const w = await world(250);
    const res = await w.buy({ credits: SYNC_EXTRA_CREDITS + 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "price changed", retry_after: null });
    expect(w.commands).toHaveLength(0);
  });

  test("a request signed by a device that is not this person's gets 401 and no wallet command", async () => {
    const w = await world(250);
    const stranger = await makeTestDevice("dev_stranger");
    const init = await signedInit(stranger, { method: "POST", path: PATH, body: { credits: SYNC_EXTRA_CREDITS }, now: NOW });
    const res = await w.app.request(PATH, init, w.env);
    expect(res.status).toBe(401);
    expect(w.commands).toHaveLength(0);
  });

  const rows = async (w: Awaited<ReturnType<typeof world>>) =>
    (await w.db.prepare("SELECT COUNT(*) AS n FROM sync_extras").first<{ n: number }>())?.n;

  test("the D1 write fails: hold released, nothing charged, no row; the same key never pays, a new key does", async () => {
    const w = await world(250, 0, { failSql: "INSERT INTO sync_extras" });
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS })).status).toBe(500);
    expect(w.commands.map((c) => c.type)).toEqual(["hold", "release"]);
    expect(w.store.read()).toMatchObject({ purchased: 250, holds: [] });
    // The same key again: the hold is closed and nothing was added. 500 (never stored), not a stored 409.
    const again = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(again.status).toBe(500);
    expect(await again.json()).toMatchObject({ code: "internal", message: expect.stringContaining("new Idempotency-Key") });
    expect(await rows(w)).toBe(0);
    expect(w.store.read()).toMatchObject({ purchased: 250 });
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-fresh-00000")).status).toBe(500);
  });

  test("the INSERT lands but its reply is lost: the row is removed and the hold released, nothing charged", async () => {
    const w = await world(250, 0, { landThenFail: "INSERT INTO sync_extras" });
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS })).status).toBe(500);
    expect(await rows(w)).toBe(0);
    expect(w.commands.map((c) => c.type)).toEqual(["hold", "release"]);
    expect(w.store.read()).toMatchObject({ purchased: 250, holds: [] });
  });

  test("the INSERT lands, its reply is lost and the DELETE fails: the hold is not released; the same key settles it once", async () => {
    const w = await world(250, 0, { landThenFail: "INSERT INTO sync_extras", failSql: "DELETE FROM sync_extras" });
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS })).status).toBe(500);
    expect(w.commands.map((c) => c.type)).toEqual(["hold"]);
    expect(await rows(w)).toBe(1);
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [{ id: "sync_extra:u1:key-extra-0123456789" }] });
    const again = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(again.status).toBe(200);
    expect(w.commands.map((c) => c.type)).toEqual(["hold", "hold", "settle"]);
    expect(await rows(w)).toBe(1);
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [] });
  });

  test("a hold settled earlier and no row left: 409 request already finished, no second charge", async () => {
    const w = await world(250);
    await w.buy({ credits: SYNC_EXTRA_CREDITS });
    await w.db.prepare("DELETE FROM idempotency").run();
    await w.db.prepare("DELETE FROM sync_extras").run();
    const again = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ message: "request already finished" });
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [] });
  });

  test("the sum read fails after the row was written and the settle ran: still charged once and granted once", async () => {
    const w = await world(250, 0, { failSql: "SELECT SUM" });
    const res = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(res.status).toBe(200);
    expect(SyncExtraResponseSchema.parse(await res.json()).extra_bytes).toBe(SYNC_EXTRA_BYTES);
    expect(w.commands.map((c) => c.type)).toEqual(["hold", "settle"]);
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [] });
    expect(await rows(w)).toBe(1);
  });

  test("the reply was lost after a settle, the stored reply is gone: the same key answers 200 and charges once", async () => {
    const w = await world(250);
    await w.buy({ credits: SYNC_EXTRA_CREDITS });
    await w.db.prepare("DELETE FROM idempotency").run();
    const again = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(again.status).toBe(200);
    expect(SyncExtraResponseSchema.parse(await again.json()).extra_bytes).toBe(SYNC_EXTRA_BYTES);
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [] });
    expect(await rows(w)).toBe(1);
  });

  test("a hold is open and no row exists (the first run is still going): 409 request in progress, retry_after 1, nothing added", async () => {
    const w = await world(250);
    w.store.apply({ type: "hold", id: "sync_extra:u1:key-extra-0123456789", hold_id: "sync_extra:u1:key-extra-0123456789", user_id: "u1", task: "sync_extra", credits: SYNC_EXTRA_CREDITS, expires_at: NOW + 60_000 }, NOW);
    const res = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "conflict", message: "request in progress", retry_after: 1 });
    expect(await rows(w)).toBe(0);
    expect(w.commands.map((c) => c.type)).toEqual(["hold"]);
  });

  test("a settle that finds its hold already released: row removed, nothing charged, 500; the same key stays free; a new key pays once", async () => {
    const w = await world(250, 0, { releaseBeforeSettle: 1 });
    const res = await w.buy({ credits: SYNC_EXTRA_CREDITS });
    expect(res.status).toBe(500);
    expect(await rows(w)).toBe(0);
    expect(w.store.read()).toMatchObject({ purchased: 250, holds: [] });
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS })).status).toBe(500);
    expect(await rows(w)).toBe(0);
    const fresh = await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-fresh-00000");
    expect(fresh.status).toBe(200);
    expect(w.store.read()).toMatchObject({ purchased: 150, holds: [] });
    expect(await rows(w)).toBe(1);
  });

  test("a settle fails, the hold's alarm releases it, the same key again: the free row is removed, no free gigabyte", async () => {
    const w = await world(250, 1);
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS })).status).toBe(500);
    expect(await rows(w)).toBe(1);
    w.store.apply({ type: "release", id: "alarm", hold_id: "sync_extra:u1:key-extra-0123456789" }, NOW);
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS })).status).toBe(500);
    expect(await rows(w)).toBe(0);
    expect(w.store.read()).toMatchObject({ purchased: 250, holds: [] });
  });

  test("a retry after midnight settles the purchase of the day it was made on, and reports that day's total", async () => {
    const w = await world(250, 1);
    const midnight = (DAY + 1) * 86_400_000;
    w.clock.now = midnight - 5_000;
    expect((await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-bbbbbbbbbb")).status).toBe(500);
    w.clock.now = midnight - 4_000;
    await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-aaaaaaaaaa");
    w.clock.now = midnight + 5_000;
    const retry = await w.buy({ credits: SYNC_EXTRA_CREDITS }, "key-extra-bbbbbbbbbb");
    expect(retry.status).toBe(200);
    expect(SyncExtraResponseSchema.parse(await retry.json()).extra_bytes).toBe(2 * SYNC_EXTRA_BYTES);
    const days = await w.db.prepare("SELECT day FROM sync_extras ORDER BY key").all<{ day: number }>();
    expect(days.results.map((r) => r.day)).toEqual([DAY, DAY]);
    expect(w.store.read()).toMatchObject({ purchased: 50, holds: [] });
  });
});
