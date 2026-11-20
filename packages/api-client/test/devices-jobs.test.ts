import { bodySha256, fromBase64Url, requestSigningInput, utf8, verifyP256 } from "@waypoint/crypto";
import { describe, expect, it } from "vitest";
import { ApiCallError, BadReplyError, NetworkError, NotRegisteredError } from "../src/index.ts";
import { BASE, fakeApi, jsonReply, softwareSigner, sseReply } from "./helpers.ts";

const KEY = "A".repeat(87);
const N32 = "B".repeat(43);
const JOB = {
  id: "job_000000000000000000000001",
  type: "research",
  state: "queued",
  quoted: 15,
  spent: null,
  tier: "standard",
  retention: "standard",
  result_ready: false,
  created_at: 1,
  finished_at: null,
  expires_at: null,
};
const PAIRING = { device_id: "dev_new", commitment: N32, expires_at: 9, approver: null, approver_nonce: null, device_nonce: null };
const DEVICE = { id: "dev_new", kind: "device", name: "iPhone", platform: "ios", sign_pub: KEY, box_pub: KEY, cert: null, account_envelope: null, added_at: 1, approved_at: 2, approved_by: "acct_1" };
const h = (sent: { init: { headers: Record<string, string> } }, name: string): string | undefined => sent.init.headers[name];

async function signedBy(sent: { url: string; init: { method: string; headers: Record<string, string>; body?: string | Uint8Array } }, publicKey: Uint8Array): Promise<boolean> {
  const head = sent.init.headers;
  const input = requestSigningInput({
    method: sent.init.method,
    target: sent.url.slice(BASE.length),
    deviceId: head["Waypoint-Device"] ?? "",
    timestamp: Number(head["Waypoint-Timestamp"]),
    nonce: head["Waypoint-Nonce"] ?? "",
    bodySha256: await bodySha256(utf8(typeof sent.init.body === "string" ? sent.init.body : "")),
  });
  return verifyP256(publicKey, fromBase64Url(head["Waypoint-Signature"] ?? ""), input);
}

describe("devices and recovery", () => {
  it("reveal is signed by the given signer under its own id", async () => {
    const pending = softwareSigner("dev_new");
    const { client, sent } = fakeApi([jsonReply(200, { ...PAIRING, device_nonce: N32 })]);
    await client.revealPairing("dev_new", N32, pending);
    expect(sent[0]?.url).toBe(`${BASE}/v1/devices/dev_new/pairing/reveal`);
    expect(h(sent[0]!, "Waypoint-Device")).toBe("dev_new");
    expect(await signedBy(sent[0]!, pending.publicKey)).toBe(true);
  });
  it("approve signs with this device, or with the account key during recovery", async () => {
    const me = softwareSigner("dev_me");
    const account = softwareSigner("acct_1");
    const { client, sent } = fakeApi([jsonReply(200, { device: DEVICE }), jsonReply(200, { device: DEVICE })], { device: () => me });
    const body = { cert: "C".repeat(86), account_envelope: "E".repeat(200), envelopes: [] };
    await client.approveDevice("dev_new", body);
    await client.approveDevice("dev_new", body, account);
    expect(h(sent[0]!, "Waypoint-Device")).toBe("dev_me");
    expect(h(sent[1]!, "Waypoint-Device")).toBe("acct_1");
    expect(await signedBy(sent[1]!, account.publicKey)).toBe(true);
  });
  it("remove is a signed DELETE with a JSON body; 409 is not retried", async () => {
    const me = softwareSigner("dev_me");
    const { client, sent } = fakeApi([jsonReply(409, { code: "conflict", message: "devices changed, try again", retry_after: null })], { device: () => me });
    await expect(client.removeDevice("dev_old", {})).rejects.toMatchObject({ status: 409, message: "devices changed, try again" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.init.method).toBe("DELETE");
    expect(sent[0]?.init.body).toBe("{}");
    expect(await signedBy(sent[0]!, me.publicKey)).toBe(true);
  });
  it("signed calls need an approved device", async () => {
    const { client, sent } = fakeApi([]);
    await expect(client.sendPairingNonce("dev_new", N32)).rejects.toBeInstanceOf(NotRegisteredError);
    await expect(client.putRecovery({ account_device_id: "acct_1", wrapped_account_key: "R".repeat(124), verified: true })).rejects.toBeInstanceOf(NotRegisteredError);
    expect(sent).toHaveLength(0);
  });
  it("recovery: 404 when there is none", async () => {
    const { client } = fakeApi([jsonReply(404, { code: "not_found", message: "no recovery key", retry_after: null })]);
    await expect(client.recovery()).rejects.toBeInstanceOf(ApiCallError);
  });
});

describe("jobs", () => {
  it("createJob sends the given key and is signed", async () => {
    const me = softwareSigner("dev_me");
    const { client, sent } = fakeApi([jsonReply(201, { job: JOB })], { device: () => me });
    expect(await client.createJob({ type: "research", depth: "quick", question: "why?" }, "key_job_00000001")).toEqual(JOB);
    expect(h(sent[0]!, "Idempotency-Key")).toBe("key_job_00000001");
    expect(await signedBy(sent[0]!, me.publicKey)).toBe(true);
  });
  it("jobResult is a signed GET that returns bytes", async () => {
    const me = softwareSigner("dev_me");
    const { client, sent } = fakeApi([new Response(new Uint8Array([1, 3, 9]), { status: 200 })], { device: () => me });
    expect(await client.jobResult(JOB.id)).toEqual(new Uint8Array([1, 3, 9]));
    expect(h(sent[0]!, "Accept")).toBe("application/octet-stream");
    expect(h(sent[0]!, "Idempotency-Key")).toBeUndefined();
    expect(await signedBy(sent[0]!, me.publicKey)).toBe(true);
  });
  it("uploadAudio sends raw bytes with audio/mp4, unsigned", async () => {
    const { client, sent } = fakeApi([jsonReply(200, { chunk: 2, bytes: 3 })]);
    expect(await client.uploadAudio(JOB.id, 2, new Uint8Array([7, 7, 7]))).toEqual({ chunk: 2, bytes: 3 });
    expect(sent[0]?.init.method).toBe("PUT");
    expect(sent[0]?.url).toBe(`${BASE}/v1/jobs/${JOB.id}/audio/2`);
    expect(sent[0]?.init.body).toEqual(new Uint8Array([7, 7, 7]));
    expect(h(sent[0]!, "Content-Type")).toBe("audio/mp4");
    expect(h(sent[0]!, "Waypoint-Signature")).toBeUndefined();
  });
  it("jobEvents calls onState per state event and skips keep-alives", async () => {
    const seen: string[] = [];
    const { client } = fakeApi([
      sseReply([`event: state\nid: 1\ndata: ${JSON.stringify(JOB)}\n\n`, ": keep-alive\n\n", `event: state\nid: 2\ndata: ${JSON.stringify({ ...JOB, state: "succeeded", result_ready: true })}\n\n`]),
    ]);
    await client.jobEvents(JOB.id, (job) => seen.push(job.state));
    expect(seen).toEqual(["queued", "succeeded"]);
  });
  it("jobEvents: a bad event is BadReplyError", async () => {
    const { client } = fakeApi([sseReply([`event: state\ndata: {"id":1}\n\n`])]);
    await expect(client.jobEvents(JOB.id, () => undefined)).rejects.toBeInstanceOf(BadReplyError);
  });
  it("deleteJob is a signed DELETE with no body", async () => {
    const me = softwareSigner("dev_me");
    const { client, sent } = fakeApi([jsonReply(200, { job: { ...JOB, state: "cancelled" } })], { device: () => me });
    expect((await client.deleteJob(JOB.id)).state).toBe("cancelled");
    expect(sent[0]?.init.body).toBeUndefined();
    expect(h(sent[0]!, "Idempotency-Key")).toBeDefined();
  });
  it("a body cut off part way is NetworkError", async () => {
    const me = softwareSigner("dev_me");
    const broken = new Response(new ReadableStream({ start(c) { c.error(new Error("cut")); } }), { status: 200 });
    const { client } = fakeApi([broken], { device: () => me });
    await expect(client.jobResult(JOB.id)).rejects.toBeInstanceOf(NetworkError);
  });
});
