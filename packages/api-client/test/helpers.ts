import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bodySha256, requestSigningInput, toBase64Url, utf8 } from "@waypoint/crypto";
import { createApiClient, type ApiClientOptions, type DeviceSigner, type FetchInit } from "../src/index.ts";

export const BASE = "https://api.test";

export function readVectors<T>(name: string): T {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../crypto/test/vectors");
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
}

// A software P-256 key standing in for the Secure Enclave. Signs exactly what the server checks.
export function softwareSigner(id: string, key: KeyObject = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey): DeviceSigner & { publicKey: Uint8Array } {
  const publicKey = new Uint8Array(createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-65));
  let counter = 0;
  return {
    id,
    publicKey,
    sign: async (input) => {
      counter += 1;
      const nonce = toBase64Url(new Uint8Array(16).fill(counter));
      const message = requestSigningInput({ ...input, nonce, bodySha256: await bodySha256(utf8(input.body)) });
      return { nonce, signature: toBase64Url(new Uint8Array(sign("sha256", message, { key, dsaEncoding: "ieee-p1363" }))) };
    },
  };
}

// The 32-byte private scalar from the vectors as a Node key.
export function keyFromScalar(hex: string, publicKey: Uint8Array): KeyObject {
  const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
  return createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: b64(Buffer.from(hex, "hex")), x: b64(publicKey.subarray(1, 33)), y: b64(publicKey.subarray(33, 65)) },
    format: "jwk",
  });
}

export type Sent = { url: string; init: FetchInit };

// A fake fetch that answers from a list of replies, one per call, and records every request.
export function fakeApi(replies: (Response | Error)[], overrides: Partial<ApiClientOptions> = {}) {
  const sent: Sent[] = [];
  const slept: number[] = [];
  let keys = 0;
  const client = createApiClient({
    baseUrl: BASE,
    fetch: async (url, init) => {
      sent.push({ url, init });
      const next = replies.shift();
      if (next === undefined) throw new Error("no more replies");
      if (next instanceof Error) throw next;
      return next;
    },
    getToken: async () => "tok_1",
    device: () => null,
    now: () => 1_763_560_000_000,
    newKey: () => `key_${String(++keys).padStart(12, "0")}`,
    sleep: async (ms) => {
      slept.push(ms);
    },
    ...overrides,
  });
  return { client, sent, slept };
}

export function jsonReply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export function sseReply(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
