import { describe, expect, it } from "vitest";
import { BASE, fakeApi, jsonReply, softwareSigner } from "./helpers.ts";

const GROUP = { id: "grp_0123456789abcdef", kind: "shared", name_locked: "N".repeat(60), key_version: 1, created_by: "usr_1", role: "owner", members: [] };
const h = (sent: { init: { headers: Record<string, string> } }, name: string): string | undefined => sent.init.headers[name];

describe("groups and keys", () => {
  it("createGroup, createInvite, acceptInvite and removeMember are signed", async () => {
    const me = softwareSigner("dev_me");
    const ended = { group_id: GROUP.id, user_id: "usr_2", key_version: 2 };
    const invite = { group_id: GROUP.id, role: "editor", history_from: 0, ends_at: null, expires_at: 9 };
    const { client, sent } = fakeApi([jsonReply(201, GROUP), jsonReply(201, invite), jsonReply(200, GROUP), jsonReply(200, ended)], { device: () => me });
    expect(await client.createGroup({ id: GROUP.id, kind: "shared", name_locked: GROUP.name_locked })).toEqual(GROUP);
    expect(await client.createInvite(GROUP.id, { token_hash: "a".repeat(64), role: "editor", history_from: 0, ends_at: null })).toEqual(invite);
    expect(await client.acceptInvite("T".repeat(43))).toEqual(GROUP);
    expect(await client.removeMember(GROUP.id, "usr_2")).toEqual(ended);
    expect(sent.map((s) => [s.init.method, s.url.slice(BASE.length), h(s, "Waypoint-Device")])).toEqual([
      ["POST", "/v1/groups", "dev_me"],
      ["POST", `/v1/groups/${GROUP.id}/invites`, "dev_me"],
      ["POST", `/v1/invites/${"T".repeat(43)}/accept`, "dev_me"],
      ["DELETE", `/v1/groups/${GROUP.id}/members/usr_2`, "dev_me"],
    ]);
  });
  it("groupKeys asks for one device's envelopes", async () => {
    const { client, sent } = fakeApi([jsonReply(200, { key_version: 1, envelopes: [], signers: [] })]);
    await client.groupKeys(GROUP.id, "dev_me");
    expect(sent[0]?.url).toBe(`${BASE}/v1/groups/${GROUP.id}/keys?device=dev_me`);
  });
  it("postGroupKeys: 409 when another device's first set won", async () => {
    const me = softwareSigner("dev_me");
    const { client } = fakeApi([jsonReply(409, { code: "conflict", message: "a device already has a key for this version", retry_after: null })], { device: () => me });
    await expect(client.postGroupKeys(GROUP.id, { key_version: 1, envelopes: [{ device_id: "dev_me", wrapped_key: "E".repeat(200) }] })).rejects.toMatchObject({ status: 409 });
  });
});

describe("sync, media, links", () => {
  it("postChange is session only and uses the change id as its key", async () => {
    const { client, sent } = fakeApi([jsonReply(201, { seq: 7 })]);
    expect(await client.postChange(GROUP.id, { device_id: "dev_me", key_version: 1, kind: "session", locked_bytes: "L".repeat(44), blob_key: null }, "chg_0000000000000001")).toBe(7);
    expect(h(sent[0]!, "Idempotency-Key")).toBe("chg_0000000000000001");
    expect(h(sent[0]!, "Waypoint-Signature")).toBeUndefined();
  });
  it("changes pages after a seq", async () => {
    const { client, sent } = fakeApi([jsonReply(200, { key_version: 1, last_seq: 0, changes: [] })]);
    await client.changes(GROUP.id, 12, 100);
    expect(sent[0]?.url).toBe(`${BASE}/v1/groups/${GROUP.id}/changes?after=12&limit=100`);
  });
  it("uploadBlob sends raw octets; blob returns bytes", async () => {
    const { client, sent } = fakeApi([jsonReply(201, { id: "b".repeat(16), group_id: GROUP.id, bytes: 40 }), new Response(new Uint8Array([4, 2]))]);
    await client.uploadBlob(GROUP.id, "b".repeat(16), new Uint8Array(40));
    expect(sent[0]?.url).toBe(`${BASE}/v1/blobs?group=${GROUP.id}&id=${"b".repeat(16)}`);
    expect(h(sent[0]!, "Content-Type")).toBe("application/octet-stream");
    expect(await client.blob("b".repeat(16))).toEqual(new Uint8Array([4, 2]));
  });
  it("links are signed; the socket URL is wss", async () => {
    const me = softwareSigner("dev_me");
    const view = { id: "l".repeat(22), group_id: GROUP.id, has_passcode: false, expires_at: null, created_at: 1 };
    const { client, sent } = fakeApi([jsonReply(201, view), jsonReply(200, { id: view.id, revoked_at: 2 })], { device: () => me });
    expect(await client.createLink({ id: view.id, group_id: GROUP.id, data: "D".repeat(44), passcode: null, expires_at: null })).toEqual(view);
    expect((await client.revokeLink(view.id)).revoked_at).toBe(2);
    expect(h(sent[1]!, "Waypoint-Device")).toBe("dev_me");
    expect(client.syncSocketUrl(GROUP.id, "dev_me")).toBe(`wss://api.test/v1/groups/${GROUP.id}/sync?device=dev_me`);
  });
});
