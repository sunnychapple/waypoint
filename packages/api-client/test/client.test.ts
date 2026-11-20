import { bodySha256, fromBase64Url, requestSigningInput, utf8, verifyP256 } from "@waypoint/crypto";
import { describe, expect, it } from "vitest";
import { ApiCallError, BadReplyError, NetworkError, NotRegisteredError } from "../src/index.ts";
import { BASE, fakeApi, jsonReply, keyFromScalar, readVectors, softwareSigner, sseReply } from "./helpers.ts";

const QUOTE = { credits: 1, price_table: "2026-11-16.2", retention: "standard", balance_after: 24, expires_in: 300 };
const PURCHASE = { transaction_id: "2000000000000001", product: "pack", credits: 1000, plan: "free" };
const DONE = { credits: 1, tier: "light", retention: "standard", offer_research: false };
const header = (sent: { init: { headers: Record<string, string> } }, name: string): string | undefined => sent.init.headers[name];

async function verifySent(sent: { url: string; init: { method: string; headers: Record<string, string>; body?: string | Uint8Array } }, publicKey: Uint8Array): Promise<boolean> {
  const h = sent.init.headers;
  const input = requestSigningInput({
    method: sent.init.method,
    target: sent.url.slice(BASE.length),
    deviceId: h["Waypoint-Device"] ?? "",
    timestamp: Number(h["Waypoint-Timestamp"]),
    nonce: h["Waypoint-Nonce"] ?? "",
    bodySha256: await bodySha256(utf8(typeof sent.init.body === "string" ? sent.init.body : "")),
  });
  return verifyP256(publicKey, fromBase64Url(h["Waypoint-Signature"] ?? ""), input);
}

describe("plain calls", () => {
  it("GET /v1/config sends no token and no Idempotency-Key", async () => {
    const config = { prices: { version: "v", credits: { explain: 1 } }, routes_version: "r", flags: {}, min_native: { ios: "0.1.0" }, voice_pack: { version: "1", url: "https://x.test/p", sha256: "a".repeat(64), size: 1 } };
    const { client, sent } = fakeApi([jsonReply(200, config)]);
    expect(await client.config()).toEqual(config);
    expect(sent[0]?.url).toBe(`${BASE}/v1/config`);
    expect(header(sent[0]!, "Authorization")).toBeUndefined();
    expect(header(sent[0]!, "Idempotency-Key")).toBeUndefined();
  });

  it("a write carries the Clerk token, JSON body and a new Idempotency-Key", async () => {
    const { client, sent } = fakeApi([jsonReply(200, QUOTE)]);
    await client.quote({ task: "explain" });
    expect(header(sent[0]!, "Authorization")).toBe("Bearer tok_1");
    expect(header(sent[0]!, "Idempotency-Key")).toBe("key_000000000001");
    expect(header(sent[0]!, "Content-Type")).toBe("application/json");
    expect(sent[0]?.init.body).toBe('{"task":"explain"}');
    expect(header(sent[0]!, "Waypoint-Signature")).toBeUndefined();
  });

  it("signed out: 401 without calling the server", async () => {
    const { client, sent } = fakeApi([], { getToken: async () => null });
    await expect(client.wallet()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
    expect(sent).toHaveLength(0);
  });

  it("GET /v1/devices returns the user id with the list", async () => {
    const { client } = fakeApi([jsonReply(200, { user_id: "usr_1", devices: [] })]);
    expect(await client.devices()).toEqual({ user_id: "usr_1", devices: [] });
  });

  it("a reply that breaks the contract is BadReplyError", async () => {
    const { client } = fakeApi([jsonReply(200, { ...QUOTE, extra: 1 })]);
    await expect(client.quote({ task: "explain" })).rejects.toBeInstanceOf(BadReplyError);
  });
});

describe("errors and retries", () => {
  it("402 carries the shortfall and is not retried", async () => {
    const { client, sent } = fakeApi([jsonReply(402, { code: "insufficient_credits", message: "not enough credits", retry_after: null, shortfall: 15 })]);
    const error = await client.quote({ task: "research", depth: "quick" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiCallError);
    expect(error).toMatchObject({ status: 402, code: "insufficient_credits", shortfall: 15 });
    expect(sent).toHaveLength(1);
  });

  it("409 in progress waits retry_after and retries with the same key", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent, slept } = fakeApi(
      [jsonReply(409, { code: "conflict", message: "request in progress", retry_after: 1 }), jsonReply(200, PURCHASE)],
      { device: () => signer },
    );
    expect(await client.applePurchase("jws", "key_purchase_0001")).toEqual(PURCHASE);
    expect(slept).toEqual([1000]);
    expect(sent.map((s) => header(s, "Idempotency-Key"))).toEqual(["key_purchase_0001", "key_purchase_0001"]);
    // Signed again, with a new nonce.
    expect(header(sent[0]!, "Waypoint-Nonce")).not.toBe(header(sent[1]!, "Waypoint-Nonce"));
    expect(await verifySent(sent[1]!, signer.publicKey)).toBe(true);
  });

  it("409 without retry_after (another request with this key) is thrown at once", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent } = fakeApi([jsonReply(409, { code: "conflict", message: "Idempotency-Key reused with a different request", retry_after: null })], { device: () => signer });
    await expect(client.setZeroRetention(true)).rejects.toMatchObject({ status: 409 });
    expect(sent).toHaveLength(1);
  });

  it("network errors and 5xx retry up to 3 attempts with backoff, same key", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent, slept } = fakeApi([new TypeError("offline"), new Response("bad gateway", { status: 502 }), jsonReply(200, { zero_retention: true })], { device: () => signer });
    expect(await client.setZeroRetention(true)).toEqual({ zero_retention: true });
    expect(slept).toEqual([500, 2000]);
    expect(new Set(sent.map((s) => header(s, "Idempotency-Key"))).size).toBe(1);
  });

  it("gives up after 3 attempts", async () => {
    const { client, sent } = fakeApi([new TypeError("x"), new TypeError("x"), new TypeError("x")]);
    await expect(client.wallet()).rejects.toBeInstanceOf(NetworkError);
    expect(sent).toHaveLength(3);
  });

  it("a non-JSON error body becomes internal", async () => {
    const { client } = fakeApi([new Response("<html>", { status: 400 })]);
    await expect(client.wallet()).rejects.toMatchObject({ status: 400, code: "internal" });
  });

  it("paid tasks are never retried automatically", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent } = fakeApi([new Response("x", { status: 503 })], { device: () => signer });
    await expect(client.doubleCheck({ word: "w", transcript: "t", answer: "a" }, { key: "key_task_00000001" })).rejects.toMatchObject({ status: 503 });
    expect(sent).toHaveLength(1);
  });
});

describe("device signatures", () => {
  it("a signed call without a registered device throws before sending", async () => {
    const { client, sent } = fakeApi([]);
    await expect(client.applePurchase("jws")).rejects.toBeInstanceOf(NotRegisteredError);
    expect(sent).toHaveLength(0);
  });

  it("the zero-retention switch is signed by the device", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent } = fakeApi([jsonReply(200, { zero_retention: false })], { device: () => signer });
    await client.setZeroRetention(false);
    expect(header(sent[0]!, "Waypoint-Device")).toBe("dev_phone");
    expect(await verifySent(sent[0]!, signer.publicKey)).toBe(true);
  });

  it("signs method, path, device, timestamp, nonce and body hash", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent } = fakeApi([jsonReply(200, PURCHASE)], { device: () => signer });
    await client.applePurchase("jws");
    expect(header(sent[0]!, "Waypoint-Device")).toBe("dev_phone");
    expect(header(sent[0]!, "Waypoint-Timestamp")).toBe("1763560000000");
    expect(await verifySent(sent[0]!, signer.publicKey)).toBe(true);
  });

  it("registration signs with the device id \"new\"", async () => {
    const signer = softwareSigner("dev_phone");
    const device = { id: "dev_phone", kind: "device", name: "iPhone", platform: "ios", sign_pub: "A".repeat(87), box_pub: "A".repeat(87), cert: null, account_envelope: null, added_at: 1, approved_at: 1, approved_by: null };
    const { client, sent } = fakeApi([jsonReply(201, { device })]);
    expect(await client.registerDevice({ id: "dev_phone", name: "iPhone", platform: "ios", sign_pub: "A".repeat(87), box_pub: "A".repeat(87), commitment: "A".repeat(43) }, signer)).toEqual(device);
    expect(header(sent[0]!, "Waypoint-Device")).toBe("new");
    expect(await verifySent(sent[0]!, signer.publicKey)).toBe(true);
  });

  it("uses the server's clock from the Date header", async () => {
    const signer = softwareSigner("dev_phone");
    const server = new Date(1_763_560_000_000 + 600_000).toUTCString();
    const { client, sent } = fakeApi([jsonReply(200, QUOTE, { Date: server }), jsonReply(200, PURCHASE)], { device: () => signer });
    await client.quote({ task: "explain" });
    expect(client.clockOffset()).toBe(600_000);
    await client.applePurchase("jws");
    expect(header(sent[1]!, "Waypoint-Timestamp")).toBe("1763560600000");
  });

  it("a 401 that shows a clock off by more than a minute is signed again once", async () => {
    const signer = softwareSigner("dev_phone");
    const server = new Date(1_763_560_000_000 + 400_000).toUTCString();
    const unauthorized = jsonReply(401, { code: "unauthorized", message: "device signature required", retry_after: null }, { Date: server });
    const { client, sent } = fakeApi([unauthorized, jsonReply(200, PURCHASE)], { device: () => signer });
    await client.applePurchase("jws");
    expect(sent.map((s) => header(s, "Waypoint-Timestamp"))).toEqual(["1763560000000", "1763560400000"]);
  });

  it("matches the waypoint-v1 request vector", async () => {
    type RequestVector = { method: string; target: string; deviceId: string; timestamp: number; nonce: string; bodySha256: string; body_utf8: string; signing_input: string; signature: string; device_private_key: string; device_sign_pub: string };
    const r = readVectors<{ request: RequestVector }>("waypoint-v1.json").request;
    const publicKey = fromBase64Url(r.device_sign_pub);
    const signer = softwareSigner(r.deviceId, keyFromScalar(r.device_private_key, publicKey));
    const signed = await signer.sign({ method: r.method, target: r.target, deviceId: r.deviceId, timestamp: r.timestamp, body: r.body_utf8 });
    expect(await bodySha256(utf8(r.body_utf8))).toBe(r.bodySha256);
    const input = requestSigningInput({ ...r, nonce: signed.nonce });
    expect(await verifyP256(publicKey, fromBase64Url(signed.signature), input)).toBe(true);
    // The published bytes: the canonical input (with the vector's own nonce) and its signature.
    const published = requestSigningInput(r);
    expect(Buffer.from(published).toString("hex")).toBe(r.signing_input);
    expect(await verifyP256(publicKey, fromBase64Url(r.signature), published)).toBe(true);
  });
});

describe("streamed tasks", () => {
  it("passes deltas and returns done", async () => {
    const signer = softwareSigner("dev_phone");
    const { client, sent } = fakeApi(
      [sseReply(['event: delta\ndata: {"text":"Photo"}\n\n', 'event: delta\ndata: {"text":"synthesis"}\n', `\nevent: done\ndata: ${JSON.stringify(DONE)}\n\n`])],
      { device: () => signer },
    );
    const parts: string[] = [];
    expect(await client.explain({ word: "photosynthesis", transcript: "plants make food" }, { key: "key_explain_00001", onDelta: (t) => parts.push(t) })).toEqual(DONE);
    expect(parts).toEqual(["Photo", "synthesis"]);
    expect(header(sent[0]!, "Accept")).toBe("text/event-stream");
    expect(header(sent[0]!, "Idempotency-Key")).toBe("key_explain_00001");
  });

  it("an error event throws ApiCallError with status 200", async () => {
    const signer = softwareSigner("dev_phone");
    const { client } = fakeApi([sseReply(['event: delta\ndata: {"text":"x"}\n\n', 'event: error\ndata: {"code":"internal","message":"model failed","retry_after":null}\n\n'])], { device: () => signer });
    await expect(client.moreDetail({ word: "w", transcript: "t", answer: "a" }, { key: "key_more_0000001", onDelta: () => undefined })).rejects.toMatchObject({ status: 200, code: "internal", message: "model failed" });
  });

  it("a stream cut off in the middle of its done event is a NetworkError, not a bad reply", async () => {
    const signer = softwareSigner("dev_phone");
    const { client } = fakeApi([sseReply(['event: delta\ndata: {"text":"x"}\n\n', 'event: done\ndata: {"credits":'])], { device: () => signer });
    await expect(client.explain({ word: "w", transcript: "t" }, { key: "key_explain_00004", onDelta: () => undefined })).rejects.toBeInstanceOf(NetworkError);
  });

  it("a stream that stops before done is a NetworkError", async () => {
    const signer = softwareSigner("dev_phone");
    const { client } = fakeApi([sseReply(['event: delta\ndata: {"text":"x"}\n\n'])], { device: () => signer });
    await expect(client.explain({ word: "w", transcript: "t" }, { key: "key_explain_00002", onDelta: () => undefined })).rejects.toBeInstanceOf(NetworkError);
  });

  it("a 402 before the stream starts carries the shortfall", async () => {
    const signer = softwareSigner("dev_phone");
    const { client } = fakeApi([jsonReply(402, { code: "insufficient_credits", message: "not enough credits", retry_after: null, shortfall: 1 })], { device: () => signer });
    await expect(client.explain({ word: "w", transcript: "t" }, { key: "key_explain_00003", onDelta: () => undefined })).rejects.toMatchObject({ shortfall: 1 });
  });
});
