import { beforeAll, describe, expect, test, vi } from "vitest";
import {
  apnsJwtSource,
  pemToPkcs8,
  sendApns,
  signApnsJwt,
  type ApnsConfig,
  type ApnsDevice,
  type FetchLike,
} from "../src/push/apns.ts";
import { APNS_KEY_ID_PLACEHOLDER, handlePushBatch, PUSH_QUEUE_NAME, type PushEnv } from "../src/push/consumer.ts";
import { notificationFor, PushMessageSchema, sendPush, type PushMessage, type PushQueue } from "../src/push/messages.ts";
import type { QueueBatch, QueueMessage } from "../src/queue.ts";
import type { Db } from "../src/storage.ts";
import { createTestDb } from "./helpers/d1.ts";

// Compile-time check: a Queues batch is accepted where the consumers expect QueueBatch.
export const batchFits: (batch: MessageBatch<unknown>) => QueueBatch = (batch) => batch;

const NOW = 1_800_000_000_000;
const CONFIG: ApnsConfig = { keyId: "KEYID12345", teamId: "TEAMID1234", privateKeyPem: "", topic: "app.waypoint.ios" };
const T1 = "ab".repeat(32);
const T2 = "cd".repeat(32);

// A stand-in .p8 key made by the test itself; set in beforeAll.
let PEM = "";
let PAIR: CryptoKeyPair;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  if (!("publicKey" in pair)) throw new Error("expected a key pair");
  PAIR = pair;
  const der = await crypto.subtle.exportKey("pkcs8", PAIR.privateKey);
  if (!(der instanceof ArrayBuffer)) throw new Error("expected PKCS#8 bytes");
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  PEM = `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END PRIVATE KEY-----\n`;
});

function config(): ApnsConfig {
  return { ...CONFIG, privateKeyPem: PEM };
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

function decodePart(text: string): unknown {
  return JSON.parse(new TextDecoder().decode(fromBase64Url(text)));
}

// A fetch stub that records each call and answers with the given response.
function stubFetch(answer: (url: string) => Response = () => new Response(null, { status: 200 })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    calls.push({ url: input, init });
    return answer(input);
  };
  return { fetch: fetchFn, calls };
}

// A queue message that records ack and retry calls.
function queued(body: unknown) {
  const state = { acked: false, retries: [] as (number | undefined)[] };
  const message: QueueMessage = {
    id: crypto.randomUUID(),
    body,
    attempts: 1,
    ack: () => {
      state.acked = true;
    },
    retry: (options) => {
      state.retries.push(options?.delaySeconds);
    },
  };
  return { message, state };
}

function batchOf(...messages: QueueMessage[]): QueueBatch {
  return { queue: PUSH_QUEUE_NAME, messages };
}

// A DB with users u1 and u2 and the given push tokens.
async function dbWithTokens(
  rows: { user: string; device: string; token: string; environment: "sandbox" | "production" }[],
): Promise<Db> {
  const db = createTestDb();
  for (const id of ["u1", "u2"]) {
    await db
      .prepare("INSERT INTO users (id, clerk_id, created_at, billing_account_id) VALUES (?, ?, ?, ?)")
      .bind(id, `clerk_${id}`, NOW, `ba_${id}`)
      .run();
  }
  for (const row of rows) {
    await db
      .prepare("INSERT INTO push_tokens (user_id, device_id, token, environment, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(row.user, row.device, row.token, row.environment, NOW)
      .run();
  }
  return db;
}

function envOf(db: Db): PushEnv {
  return { DB: db, APNS_KEY_ID: CONFIG.keyId, APNS_TEAM_ID: CONFIG.teamId, APNS_TOPIC: CONFIG.topic, APNS_PRIVATE_KEY: PEM };
}

function depsOf(fetchFn: FetchLike) {
  return { fetch: fetchFn, now: () => NOW, jwt: apnsJwtSource(() => NOW) };
}

const SAMPLE: PushMessage = { user_id: "u1", kind: "job_ready", ref: "job_1", device_id: null };

describe("APNs signing", () => {
  test("signApnsJwt makes an ES256 token with the expected header and claims that verifies with the public key", async () => {
    const jwt = await signApnsJwt(config(), 1800);
    const [header, claims, signature] = jwt.split(".");
    expect(decodePart(header ?? "")).toEqual({ alg: "ES256", kid: CONFIG.keyId });
    expect(decodePart(claims ?? "")).toEqual({ iss: CONFIG.teamId, iat: 1800 });
    const signed = new TextEncoder().encode(`${header}.${claims}`);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      PAIR.publicKey,
      fromBase64Url(signature ?? ""),
      signed,
    );
    expect(ok).toBe(true);
  });

  test("apnsJwtSource reuses the token inside one 30-minute step and signs a new one with the boundary iat after it", async () => {
    const BOUNDARY_MS = 1_800_000_000; // 1,800,000 seconds, a multiple of 1,800
    let now = BOUNDARY_MS + 10_000;
    const source = apnsJwtSource(() => now);
    const first = await source(config());
    now += 60_000;
    expect(await source(config())).toBe(first);
    now = BOUNDARY_MS + 1_800_000;
    const next = await source(config());
    expect(next).not.toBe(first);
    expect(decodePart(next.split(".")[1] ?? "")).toEqual({ iss: CONFIG.teamId, iat: 1_801_800 });
  });

  test("pemToPkcs8 rejects text that is not a PKCS#8 PEM", () => {
    expect(() => pemToPkcs8("nope")).toThrow();
  });
});

describe("notifications", () => {
  test("job_ready, device_request and device_approved are alerts at priority 10 with fixed text and only aps, kind and ref", () => {
    const texts: Record<"job_ready" | "device_request" | "device_approved", string> = {
      job_ready: "Your result is ready.",
      device_request: "A new device wants to sign in. Open NotePath to compare the code.",
      device_approved: "Your new device was approved.",
    };
    for (const kind of ["job_ready", "device_request", "device_approved"] as const) {
      const notification = notificationFor({ ...SAMPLE, kind });
      expect(notification.pushType).toBe("alert");
      expect(notification.priority).toBe(10);
      expect(Object.keys(notification.payload).sort()).toEqual(["aps", "kind", "ref"]);
      expect(notification.payload.aps).toEqual({ alert: { title: "NotePath", body: texts[kind] }, sound: "default" });
    }
  });

  test("sync is a background push at priority 5 with content-available 1", () => {
    const notification = notificationFor({ ...SAMPLE, kind: "sync" });
    expect(notification.pushType).toBe("background");
    expect(notification.priority).toBe(5);
    expect(notification.payload.aps).toEqual({ "content-available": 1 });
  });

  test("collapseId is kind:ref, or kind:none when ref is null", () => {
    expect(notificationFor({ ...SAMPLE, ref: "job_1" }).collapseId).toBe("job_ready:job_1");
    expect(notificationFor({ ...SAMPLE, ref: null }).collapseId).toBe("job_ready:none");
  });

  test("PushMessageSchema rejects an extra key, a ref of 49 characters and an unknown kind", () => {
    expect(PushMessageSchema.safeParse(SAMPLE).success).toBe(true);
    expect(PushMessageSchema.safeParse({ ...SAMPLE, text: "note" }).success).toBe(false);
    expect(PushMessageSchema.safeParse({ ...SAMPLE, ref: "a".repeat(49) }).success).toBe(false);
    expect(PushMessageSchema.safeParse({ ...SAMPLE, kind: "marketing" }).success).toBe(false);
  });
});

describe("sendApns", () => {
  test("a sandbox device goes to the sandbox host and a production device to the production host, with the APNs headers and the JSON payload", async () => {
    const notification = notificationFor(SAMPLE);
    const stub = stubFetch();
    const devices: ApnsDevice[] = [
      { token: T1, environment: "sandbox" },
      { token: T2, environment: "production" },
    ];
    for (const device of devices) {
      await sendApns(stub.fetch, "jwt.value.sig", config(), device, notification, 1_900_000_000);
    }
    const [sandbox, production] = stub.calls;
    expect(sandbox?.url).toBe(`https://api.sandbox.push.apple.com/3/device/${T1}`);
    expect(production?.url).toBe(`https://api.push.apple.com/3/device/${T2}`);
    const headers = new Headers(sandbox?.init.headers);
    expect(headers.get("authorization")).toBe("bearer jwt.value.sig");
    expect(headers.get("apns-topic")).toBe(CONFIG.topic);
    expect(headers.get("apns-push-type")).toBe("alert");
    expect(headers.get("apns-priority")).toBe("10");
    expect(headers.get("apns-expiration")).toBe("1900000000");
    expect(headers.get("apns-collapse-id")).toBe("job_ready:job_1");
    expect(JSON.parse(String(sandbox?.init.body))).toEqual(notification.payload);
  });

  test("sendApns maps each APNs answer to sent, drop_token, retry or failed", async () => {
    const notification = notificationFor(SAMPLE);
    const device: ApnsDevice = { token: T1, environment: "sandbox" };
    const reply = (status: number, body: string | null = null) => () => new Response(body, { status });
    const cases: [string, () => Response, unknown][] = [
      ["200", reply(200), "sent"],
      ["410", reply(410), "drop_token"],
      ["400 BadDeviceToken", reply(400, '{"reason":"BadDeviceToken"}'), "drop_token"],
      ["400 DeviceTokenNotForTopic", reply(400, '{"reason":"DeviceTokenNotForTopic"}'), "drop_token"],
      ["400 BadPriority", reply(400, '{"reason":"BadPriority"}'), "failed"],
      ["403 ExpiredProviderToken", reply(403, '{"reason":"ExpiredProviderToken"}'), "retry"],
      ["429", reply(429), "retry"],
      ["500", reply(500), "retry"],
      ["503", reply(503), "retry"],
      ["400 with a body that is not JSON", reply(400, "not json"), "failed"],
    ];
    for (const [name, answer, expected] of cases) {
      const stub = stubFetch(answer);
      expect(await sendApns(stub.fetch, "jwt", config(), device, notification, 1), name).toBe(expected);
    }
    const throwing: FetchLike = async () => {
      throw new Error("network down");
    };
    expect(await sendApns(throwing, "jwt", config(), device, notification, 1)).toBe("retry");
  });
});

describe("push consumer", () => {
  test("a user with two tokens gets two sends and the message is acked; a device_id sends to that device only", async () => {
    const db = await dbWithTokens([
      { user: "u1", device: "device_a1", token: T1, environment: "sandbox" },
      { user: "u1", device: "device_b2", token: T2, environment: "production" },
    ]);
    const stub = stubFetch();
    const all = queued(SAMPLE);
    await handlePushBatch(batchOf(all.message), envOf(db), depsOf(stub.fetch));
    expect(stub.calls.map((call) => call.url).sort()).toEqual(
      [`https://api.sandbox.push.apple.com/3/device/${T1}`, `https://api.push.apple.com/3/device/${T2}`].sort(),
    );
    expect(all.state.acked).toBe(true);

    const one = stubFetch();
    const single = queued({ ...SAMPLE, device_id: "device_b2" });
    await handlePushBatch(batchOf(single.message), envOf(db), depsOf(one.fetch));
    expect(one.calls.map((call) => call.url)).toEqual([`https://api.push.apple.com/3/device/${T2}`]);
    expect(single.state.acked).toBe(true);
  });

  test("a user with no tokens is acked with no fetch", async () => {
    const db = await dbWithTokens([]);
    const stub = stubFetch();
    const { message, state } = queued(SAMPLE);
    await handlePushBatch(batchOf(message), envOf(db), depsOf(stub.fetch));
    expect(stub.calls).toHaveLength(0);
    expect(state.acked).toBe(true);
  });

  test("a 410 deletes that token's row and the message is acked", async () => {
    const db = await dbWithTokens([{ user: "u1", device: "device_a1", token: T1, environment: "sandbox" }]);
    const stub = stubFetch(() => new Response(null, { status: 410 }));
    const { message, state } = queued(SAMPLE);
    await handlePushBatch(batchOf(message), envOf(db), depsOf(stub.fetch));
    const left = await db.prepare("SELECT COUNT(*) AS n FROM push_tokens").first<{ n: number }>();
    expect(left?.n).toBe(0);
    expect(state.acked).toBe(true);
  });

  test("one send that asks for a retry and one that succeeds retries the message after 60 seconds and is not acked", async () => {
    const db = await dbWithTokens([
      { user: "u1", device: "device_a1", token: T1, environment: "sandbox" },
      { user: "u1", device: "device_b2", token: T2, environment: "production" },
    ]);
    const stub = stubFetch((url) => new Response(null, { status: url.includes("sandbox") ? 500 : 200 }));
    const { message, state } = queued(SAMPLE);
    await handlePushBatch(batchOf(message), envOf(db), depsOf(stub.fetch));
    expect(state.retries).toEqual([60]);
    expect(state.acked).toBe(false);
  });

  test("an invalid message body is acked with no fetch and no D1 read", async () => {
    const inner = createTestDb();
    let reads = 0;
    const db: Db = {
      prepare: (query) => {
        reads += 1;
        return inner.prepare(query);
      },
    };
    const stub = stubFetch();
    const { message, state } = queued({ user_id: "u1", kind: "marketing", ref: null, device_id: null });
    await handlePushBatch(batchOf(message), envOf(db), depsOf(stub.fetch));
    expect(state.acked).toBe(true);
    expect(stub.calls).toHaveLength(0);
    expect(reads).toBe(0);
  });

  test("a D1 that throws on prepare retries the message after 60 seconds", async () => {
    const db: Db = {
      prepare: () => {
        throw new Error("D1 unavailable");
      },
    };
    const stub = stubFetch();
    const { message, state } = queued(SAMPLE);
    await handlePushBatch(batchOf(message), envOf(db), depsOf(stub.fetch));
    expect(state.retries).toEqual([60]);
    expect(state.acked).toBe(false);
  });

  test("no request body or URL the fetch stub saw contains the .p8 key text", async () => {
    const db = await dbWithTokens([{ user: "u1", device: "device_a1", token: T1, environment: "sandbox" }]);
    const stub = stubFetch();
    const { message } = queued(SAMPLE);
    await handlePushBatch(batchOf(message), envOf(db), depsOf(stub.fetch));
    expect(stub.calls).toHaveLength(1);
    const seen = JSON.stringify(stub.calls);
    expect(seen).not.toContain("BEGIN PRIVATE KEY");
    const keyLine = PEM.split("\n")[1] ?? "";
    expect(keyLine.length).toBeGreaterThan(0);
    expect(seen).not.toContain(keyLine);
  });
});

// Compile-time check: a Queue<PushMessage> is accepted as the PushQueue that sendPush takes.
export const pushQueueFits: (queue: Queue<PushMessage>) => PushQueue = (queue) => queue;

describe("sendPush", () => {
  const GOOD_PUSH: PushMessage = { user_id: "u1", kind: "job_ready", ref: "job_abcdefghijklmnopqrstuv", device_id: "device_a1" };

  test("sends a valid message once, unchanged", async () => {
    const sent: PushMessage[] = [];
    await sendPush({ send: async (message) => void sent.push(message) }, GOOD_PUSH);
    expect(sent).toEqual([GOOD_PUSH]);
  });

  test("sends nothing for a ref of 49 characters or a device_id of 7 characters", async () => {
    const sent: PushMessage[] = [];
    const queue = { send: async (message: PushMessage) => void sent.push(message) };
    await sendPush(queue, { ...GOOD_PUSH, ref: "r".repeat(49) });
    await sendPush(queue, { ...GOOD_PUSH, device_id: "d".repeat(7) });
    expect(sent).toEqual([]);
  });

  test("a queue whose send throws resolves without an error", async () => {
    await expect(
      sendPush(
        {
          send: async () => {
            throw new Error("queue down");
          },
        },
        GOOD_PUSH,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("push consumer without APNs configured", () => {
  // A jwt that fails the test if the consumer tries to sign with a missing key.
  const noSigning = { fetch: stubFetch().fetch, now: () => NOW, jwt: async () => { throw new Error("signed without APNs"); } };

  test("a user with no tokens is acked without signing, even when APNs is not set up", async () => {
    const db = await dbWithTokens([]);
    const { message, state } = queued(SAMPLE);
    await handlePushBatch(batchOf(message), { ...envOf(db), APNS_PRIVATE_KEY: "" }, noSigning);
    expect(state).toEqual({ acked: true, retries: [] });
  });

  test("an empty APNS_PRIVATE_KEY with a user who has tokens is acked once with a warning: no send, no sign, no retry", async () => {
    const db = await dbWithTokens([{ user: "u1", device: "d1", token: T1, environment: "sandbox" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const stub = stubFetch();
      const first = queued(SAMPLE);
      const second = queued({ ...SAMPLE, ref: "job_2" });
      await handlePushBatch(batchOf(first.message, second.message), { ...envOf(db), APNS_PRIVATE_KEY: "" }, { ...noSigning, fetch: stub.fetch });
      expect(first.state).toEqual({ acked: true, retries: [] });
      expect(second.state).toEqual({ acked: true, retries: [] });
      expect(stub.calls).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("the placeholder APNS_KEY_ID is treated as not configured: acked with a warning, no send", async () => {
    const db = await dbWithTokens([{ user: "u1", device: "d1", token: T1, environment: "production" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const stub = stubFetch();
      const { message, state } = queued(SAMPLE);
      await handlePushBatch(batchOf(message), { ...envOf(db), APNS_KEY_ID: APNS_KEY_ID_PLACEHOLDER }, { ...noSigning, fetch: stub.fetch });
      expect(state).toEqual({ acked: true, retries: [] });
      expect(stub.calls).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("with APNs configured, the same user's push is still sent and acked", async () => {
    const db = await dbWithTokens([{ user: "u1", device: "d1", token: T1, environment: "sandbox" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const stub = stubFetch();
      const { message, state } = queued(SAMPLE);
      await handlePushBatch(batchOf(message), envOf(db), depsOf(stub.fetch));
      expect(stub.calls).toHaveLength(1);
      expect(state).toEqual({ acked: true, retries: [] });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
