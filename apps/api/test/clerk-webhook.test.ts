import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Command } from "@waypoint/ledger";
import { loadOrCreateUser } from "../src/auth/users.ts";
import type { AppEnv } from "../src/env.ts";
import { handleError } from "../src/errors.ts";
import { clerkWebhookRoute } from "../src/webhooks/clerk.ts";
import { createWalletStore } from "../src/wallet/store.ts";
import { createTestDb } from "./helpers/d1.ts";
import { createTestStore } from "./helpers/sql.ts";
import type { Db } from "../src/storage.ts";

const NOW = 1_800_000_000_000;
const SECRET = "whsec_" + btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const OTHER_SECRET = "whsec_" + btoa("another secret that is long enough");

let db: Db;
let wallets: Map<string, ReturnType<typeof createWalletStore>>;
let n = 0;

function walletFor(name: string): ReturnType<typeof createWalletStore> {
  let store = wallets.get(name);
  if (store === undefined) {
    store = createWalletStore(createTestStore());
    wallets.set(name, store);
  }
  return store;
}

const WALLET = {
  idFromName: (name: string) => name,
  get: (id: string) => ({ apply: async (command: Command) => walletFor(id).apply(command, NOW) }),
};

function makeEnv(overrides: Record<string, unknown> = {}) {
  return { DB: db, WALLET, CLERK_WEBHOOK_SIGNING_SECRET: SECRET, ...overrides };
}

function route() {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.route("/", clerkWebhookRoute({ now: () => NOW, newId: () => "id-" + ++n }));
  return app;
}

async function sign(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const raw = Uint8Array.from(atob(secret.slice("whsec_".length)), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

async function signedHeaders(
  body: string,
  id = "msg_1",
  timestamp = String(NOW / 1000),
  secret = SECRET,
): Promise<Record<string, string>> {
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": await sign(secret, id, timestamp, body),
  };
}

async function send(
  body: string,
  options: { headers?: Record<string, string>; env?: Record<string, unknown> } = {},
) {
  return route().request(
    "/webhooks/clerk",
    { method: "POST", headers: options.headers ?? (await signedHeaders(body)), body },
    makeEnv(options.env),
  );
}

const userCreated = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "user.created", data: { id, ...extra } });

beforeEach(() => {
  db = createTestDb();
  wallets = new Map();
  n = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("user.created", () => {
  test("creates the user, grants 25 purchased credits and writes one starter ledger entry", async () => {
    const res = await send(userCreated("user_abc"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const rows = await db.prepare("SELECT clerk_id, billing_account_id FROM users").all<{
      clerk_id: string;
      billing_account_id: string;
    }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.clerk_id).toBe("user_abc");

    const billing = rows.results[0]?.billing_account_id ?? "";
    const view = walletFor(billing).read();
    expect(view.purchased).toBe(25);
    expect(view.monthly).toBe(0);

    const ledger = walletFor(billing).ledger(0, 500);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.kind).toBe("grant");
    expect(ledger.entries[0]?.ref).toBe("starter");
  });

  test("the same event sent twice still gives one row and purchased 25", async () => {
    const body = userCreated("user_abc");
    await send(body);
    const res = await send(body);
    expect(res.status).toBe(200);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(count).toEqual({ n: 1 });
    const billing = await db.prepare("SELECT billing_account_id FROM users").first<{ billing_account_id: string }>();
    expect(walletFor(billing?.billing_account_id ?? "").read().purchased).toBe(25);
  });

  test("the same payload with a new svix-id still gives one row and purchased 25", async () => {
    const body = userCreated("user_abc");
    await send(body);
    const res = await send(body, { headers: await signedHeaders(body, "msg_2") });
    expect(res.status).toBe(200);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(count).toEqual({ n: 1 });
    const billing = await db.prepare("SELECT billing_account_id FROM users").first<{ billing_account_id: string }>();
    expect(walletFor(billing?.billing_account_id ?? "").read().purchased).toBe(25);
  });

  test("when the person signed in first, the grant goes to their wallet and no second row is added", async () => {
    await loadOrCreateUser(db, "user_abc", NOW, () => "first");
    const res = await send(userCreated("user_abc"));
    expect(res.status).toBe(200);
    expect(walletFor("first").read().purchased).toBe(25);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(count).toEqual({ n: 1 });
  });

  test("balance owed is paid off first: owed 0 and purchased 15 after the grant", async () => {
    await loadOrCreateUser(db, "user_abc", NOW, () => "first");
    walletFor("first").apply({ type: "clawback", id: "c1", credits: 10, ref: "r" }, NOW);
    const res = await send(userCreated("user_abc"));
    expect(res.status).toBe(200);
    const view = walletFor("first").read();
    expect(view.owed).toBe(0);
    expect(view.purchased).toBe(15);
  });
});

describe("user.deleted", () => {
  test("a known user is removed with its entitlements and idempotency rows, and the wallet is unchanged", async () => {
    await send(userCreated("user_abc"));
    const user = await db.prepare("SELECT id, billing_account_id FROM users").first<{
      id: string;
      billing_account_id: string;
    }>();
    const userId = user?.id ?? "";
    const billing = user?.billing_account_id ?? "";
    await db
      .prepare("INSERT INTO entitlements (user_id, product, source, granted_at) VALUES (?, 'plus', 'purchase', ?)")
      .bind(userId, NOW)
      .run();
    await db
      .prepare(
        "INSERT INTO idempotency (user_id, key, request_hash, state, created_at) VALUES (?, 'k1', 'h', 'done', ?)",
      )
      .bind(userId, NOW)
      .run();

    const res = await send(JSON.stringify({ type: "user.deleted", data: { id: "user_abc" } }));
    expect(res.status).toBe(200);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM entitlements").first()).toEqual({ n: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM idempotency").first()).toEqual({ n: 0 });
    expect(walletFor(billing).read().purchased).toBe(25);
  });

  test("an unknown Clerk id gives 200 and changes nothing", async () => {
    await send(userCreated("user_abc"));
    const res = await send(JSON.stringify({ type: "user.deleted", data: { id: "user_zzz" } }));
    expect(res.status).toBe(200);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 1 });
  });
});

describe("other events and rejected requests", () => {
  test("session.created gives 200 and changes no row and no wallet", async () => {
    const body = JSON.stringify({ type: "session.created", data: { id: "sess_1" } });
    const res = await send(body);
    expect(res.status).toBe(200);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 0 });
    expect(wallets.size).toBe(0);
  });

  test("a bad signature gives 401 unauthorized and changes nothing", async () => {
    const body = userCreated("user_abc");
    const res = await send(body, { headers: await signedHeaders(body, "msg_1", String(NOW / 1000), OTHER_SECRET) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "unauthorized", message: "invalid signature", retry_after: null });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM users").first()).toEqual({ n: 0 });
    expect(wallets.size).toBe(0);
  });

  test("no svix-* headers gives 401", async () => {
    const res = await send(userCreated("user_abc"), { headers: {} });
    expect(res.status).toBe(401);
  });

  test("a signed timestamp 301 seconds old gives 401", async () => {
    const body = userCreated("user_abc");
    const timestamp = String(NOW / 1000 - 301);
    const res = await send(body, { headers: await signedHeaders(body, "msg_1", timestamp) });
    expect(res.status).toBe(401);
  });

  test("a body changed after signing gives 401", async () => {
    const headers = await signedHeaders(userCreated("user_abc"));
    const res = await send(userCreated("user_xyz"), { headers });
    expect(res.status).toBe(401);
  });

  test("signed but not JSON gives 400 bad_request", async () => {
    const body = "not json";
    const res = await send(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_request", message: "invalid request", retry_after: null });
  });

  test("signed JSON without data.id gives 400", async () => {
    const body = JSON.stringify({ type: "user.created", data: {} });
    const res = await send(body);
    expect(res.status).toBe(400);
  });

  test("a missing CLERK_WEBHOOK_SIGNING_SECRET gives 500 internal 'webhook not configured'", async () => {
    const res = await route().request(
      "/webhooks/clerk",
      { method: "POST", headers: await signedHeaders(userCreated("user_abc")), body: userCreated("user_abc") },
      { DB: db, WALLET },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "webhook not configured", retry_after: null });
  });

  test("a secret that is not whsec_ gives 500 internal 'webhook not configured'", async () => {
    const res = await send(userCreated("user_abc"), { env: { CLERK_WEBHOOK_SIGNING_SECRET: "plain-secret" } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "internal", message: "webhook not configured", retry_after: null });
  });

  test("the payload's email and first name are not stored or logged, and no console method is called", async () => {
    const logs = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    };
    const res = await send(
      userCreated("user_abc", {
        email_addresses: [{ email_address: "kid@example.com" }],
        first_name: "Sam",
      }),
    );
    expect(res.status).toBe(200);

    const users = JSON.stringify(await db.prepare("SELECT * FROM users").all());
    expect(users).not.toContain("kid@example.com");
    expect(users).not.toContain("Sam");

    const billing = await db.prepare("SELECT billing_account_id FROM users").first<{ billing_account_id: string }>();
    const ledger = JSON.stringify(walletFor(billing?.billing_account_id ?? "").ledger(0, 500).entries);
    expect(ledger).not.toContain("kid@example.com");
    expect(ledger).not.toContain("Sam");

    for (const spy of Object.values(logs)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
