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
async function world(purchased: number, failSettles = 0) {
  const db = createTestDb();
  await db.prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES ('u1', 'clerk_u1', 0, 'ba_u1')").run();
  const phone: TestDevice = await makeTestDevice("dev_phone");
  await insertDevice(db, phone, { userId: "u1" });
  const store = createWalletStore(createTestStore());
  if (purchased > 0) store.apply({ type: "grant", id: "seed", bucket: "purchased", credits: purchased, ref: "test" }, NOW);
  const commands: Command[] = [];
  let settlesToFail = failSettles;
  const env = {
    DB: db,
    WALLET: {
      idFromName: (name: string) => name,
      get: (_name: string) => ({
        apply: async (command: Command) => {
          commands.push(command);
          if (command.type === "settle" && settlesToFail > 0) {
            settlesToFail -= 1;
            throw new Error("wallet unavailable");
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
  app.route("/", syncExtraRoute({ now: () => NOW }));
  const buy = async (body: unknown, key = "key-extra-0123456789") =>
    app.request(PATH, await signedInit(phone, { method: "POST", path: PATH, body, now: NOW, idempotencyKey: key }), env);
  return { db, store, commands, app, env, buy };
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
    expect(await w.db.prepare("SELECT COUNT(*) AS n FROM sync_days").first<{ n: number }>()).toEqual({ n: 0 });
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
});
